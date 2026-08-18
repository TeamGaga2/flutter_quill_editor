// ignore_for_file: avoid_slow_async_io, cascade_invocations, curly_braces_in_flow_control_structures, leading_newlines_in_multiline_strings, unnecessary_brace_in_string_interps, unnecessary_raw_strings, prefer_const_constructors, use_raw_strings

import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';

import 'package:flutter_quill_editor/host/iframe_host_envelope.dart';
import 'package:flutter_quill_editor/protocol/protocol_version.dart';
import 'package:archive/archive.dart';
import 'package:crypto/crypto.dart';
import 'package:http/http.dart' as http;
import 'package:path/path.dart' as p;

const String kRuntimeArchiveName = 'webview-runtime.tar.gz';
const String kRuntimeMetadataName = 'runtime-release.json';
const String kRuntimeChecksumName = 'webview-runtime.tar.gz.sha256';
const int kRuntimeMaxReleasePages = 100;
const int kRuntimeMaxArchiveBytes = 100 * 1024 * 1024;
const int kRuntimeMaxArchiveFiles = 10 * 1000;
const int kRuntimeMaxArchiveFileBytes = 50 * 1024 * 1024;
const int kRuntimeMaxArchiveUncompressedBytes = 200 * 1024 * 1024;

String runtimeBranchIdentity(String branch) => sha256.convert(utf8.encode(branch)).toString();

Future<Directory> createRuntimePreparationDirectory(Directory outputParent) =>
    outputParent.createTemp('.richtext-runtime-');

class RuntimeChannelConfig {
  const RuntimeChannelConfig({required this.branch});

  factory RuntimeChannelConfig.fromJson(Object? json) {
    if (json is! Map<String, Object?> || json['branch'] is! String) {
      throw const FormatException('runtime channel config must contain a string branch');
    }
    final branch = (json['branch']! as String).trim();
    if (branch.isEmpty || branch.length > 255 || branch.contains('\n') || branch.contains('\r')) {
      throw const FormatException('runtime channel branch must be a non-empty single line');
    }
    return RuntimeChannelConfig(branch: branch);
  }

  final String branch;

  String get branchIdentity => runtimeBranchIdentity(branch);
}

class RuntimeReleaseMetadata {
  RuntimeReleaseMetadata({
    required this.branch,
    required this.branchIdentity,
    required this.sourceCommit,
    required this.pipelineId,
    required this.pipelineIid,
    required this.releaseTag,
    required this.archiveName,
    required this.archiveSha256,
    required this.protocolVersion,
    required this.hostEnvelopeVersion,
    this.runtimeBuildId,
    this.generatedAt,
  });

  factory RuntimeReleaseMetadata.fromJson(Object? value) {
    if (value is! Map<String, Object?>) {
      throw const FormatException('runtime-release.json must be an object');
    }
    String string(String key) {
      final result = value[key];
      if (result is! String || result.isEmpty)
        throw FormatException('runtime-release.json missing $key');
      return result;
    }

    int positiveInt(String key) {
      final result = value[key];
      if (result is! int || result <= 0) throw FormatException('runtime-release.json invalid $key');
      return result;
    }

    final metadata = RuntimeReleaseMetadata(
      branch: string('branch'),
      branchIdentity: string('branchIdentity'),
      sourceCommit: string('sourceCommit'),
      pipelineId: positiveInt('pipelineId'),
      pipelineIid: positiveInt('pipelineIid'),
      releaseTag: string('releaseTag'),
      archiveName: string('archiveName'),
      archiveSha256: string('archiveSha256'),
      protocolVersion: positiveInt('protocolVersion'),
      hostEnvelopeVersion: positiveInt('hostEnvelopeVersion'),
      runtimeBuildId: value['runtimeBuildId'] as String?,
      generatedAt: value['generatedAt'] as String?,
    );
    metadata.validate();
    return metadata;
  }

  final String branch;
  final String branchIdentity;
  final String sourceCommit;
  final int pipelineId;
  final int pipelineIid;
  final String releaseTag;
  final String archiveName;
  final String archiveSha256;
  final int protocolVersion;
  final int hostEnvelopeVersion;
  final String? runtimeBuildId;
  final String? generatedAt;

  void validate({String? expectedBranch, String? expectedTag, int? expectedPipelineIid}) {
    if (expectedBranch != null && branch != expectedBranch) {
      throw StateError('runtime release branch does not match channel');
    }
    if (expectedTag != null && releaseTag != expectedTag) {
      throw StateError('runtime release tag does not match metadata');
    }
    if (expectedPipelineIid != null && pipelineIid != expectedPipelineIid) {
      throw StateError('runtime release pipeline IID does not match metadata');
    }
    if (branchIdentity != runtimeBranchIdentity(branch) || branchIdentity.length != 64) {
      throw StateError('runtime release branch identity is invalid');
    }
    if (!RegExp(r'^[0-9a-f]{40}$').hasMatch(sourceCommit)) {
      throw StateError('runtime release source commit must be a full lowercase SHA');
    }
    if (archiveName != kRuntimeArchiveName || !RegExp(r'^[0-9a-f]{64}$').hasMatch(archiveSha256)) {
      throw StateError('runtime release archive identity is invalid');
    }
    if (protocolVersion != kRichTextProtocolVersion ||
        hostEnvelopeVersion != kHostEnvelopeVersion) {
      throw StateError(
        'runtime release is incompatible with this client '
        '(protocol=$protocolVersion, hostEnvelope=$hostEnvelopeVersion)',
      );
    }
    if (!RegExp(
      r'^webview-runtime-channel-[a-z0-9-]+-[0-9a-f]{16}-[1-9][0-9]*$',
    ).hasMatch(releaseTag)) {
      throw StateError('runtime release tag is invalid');
    }
  }
}

class RuntimeReleaseCandidate {
  const RuntimeReleaseCandidate({
    required this.tag,
    required this.pipelineIid,
    required this.metadataUrl,
    required this.archiveUrl,
    required this.checksumUrl,
  });

  final String tag;
  final int pipelineIid;
  final Uri metadataUrl;
  final Uri archiveUrl;
  final Uri checksumUrl;
}

RuntimeReleaseCandidate? releaseCandidateFromGitHubJson(
  Object? value, {
  required String branchIdentity,
  required Uri expectedHost,
}) {
  if (value is! Map<String, Object?> || value['tag_name'] is! String) return null;
  if (value['draft'] == true || value['prerelease'] == true) return null;
  final tag = value['tag_name']! as String;
  final match = RegExp(
    r'^webview-runtime-channel-[a-z0-9-]+-([0-9a-f]{16})-([1-9][0-9]*)$',
  ).firstMatch(tag);
  if (match == null || match.group(1) != branchIdentity.substring(0, 16)) return null;
  final iid = int.tryParse(match.group(2)!);
  if (iid == null || iid <= 0) return null;
  final assets = value['assets'];
  if (assets is! List<Object?>) return null;
  final links = <String, Uri>{};
  for (final raw in assets) {
    if (raw is! Map<String, Object?> || raw['name'] is! String || raw['url'] is! String) continue;
    final uri = Uri.tryParse(raw['url']! as String);
    if (uri == null ||
        uri.scheme != expectedHost.scheme ||
        uri.host != expectedHost.host ||
        uri.port != expectedHost.port ||
        uri.userInfo.isNotEmpty ||
        uri.query.isNotEmpty ||
        uri.fragment.isNotEmpty) {
      continue;
    }
    links[raw['name']! as String] = uri;
  }
  final metadataUrl = links[kRuntimeMetadataName];
  final archiveUrl = links[kRuntimeArchiveName];
  final checksumUrl = links[kRuntimeChecksumName];
  if (metadataUrl == null || archiveUrl == null || checksumUrl == null) return null;
  return RuntimeReleaseCandidate(
    tag: tag,
    pipelineIid: iid,
    metadataUrl: metadataUrl,
    archiveUrl: archiveUrl,
    checksumUrl: checksumUrl,
  );
}

RuntimeReleaseCandidate selectLatestRuntimeRelease(Iterable<RuntimeReleaseCandidate> candidates) {
  final sorted = candidates.toList()..sort((a, b) => b.pipelineIid.compareTo(a.pipelineIid));
  if (sorted.isEmpty)
    throw StateError('no successful runtime Release exists for the configured branch');
  if (sorted.length > 1 && sorted[0].pipelineIid == sorted[1].pipelineIid) {
    throw StateError('runtime Releases have an ambiguous pipeline IID');
  }
  return sorted.first;
}

class ResolvedRuntimeRelease {
  const ResolvedRuntimeRelease({
    required this.metadata,
    required this.candidate,
    required this.archiveSha256,
  });

  final RuntimeReleaseMetadata metadata;
  final RuntimeReleaseCandidate candidate;
  final String archiveSha256;
}

class GitHubRuntimeReleaseClient {
  GitHubRuntimeReleaseClient({
    required this.apiBase,
    required this.project,
    this.token = '',
    http.Client? httpClient,
  }) : _httpClient = httpClient ?? http.Client() {
    if (apiBase.scheme != 'https' || apiBase.host.isEmpty) {
      throw ArgumentError.value(apiBase, 'apiBase', 'must be an HTTPS GitHub API URL');
    }
  }

  final Uri apiBase;
  final String project;
  final String token;
  final http.Client _httpClient;

  Future<ResolvedRuntimeRelease> resolveLatest(RuntimeChannelConfig channel) async {
    final candidates = <RuntimeReleaseCandidate>[];
    var page = 1;
    for (; page <= kRuntimeMaxReleasePages; page++) {
      final uri = apiBase.replace(
        pathSegments: <String>[
          ...apiBase.pathSegments,
          'repos',
          ...project.split('/'),
          'releases',
        ],
        queryParameters: <String, String>{'per_page': '100', 'page': '$page'},
      );
      final response = await _request(uri);
      _expectSuccess(response, uri);
      final decoded = jsonDecode(response.body);
      if (decoded is! List<Object?> || decoded.isEmpty) break;
      for (final raw in decoded) {
        final candidate = releaseCandidateFromGitHubJson(
          raw,
          branchIdentity: channel.branchIdentity,
          expectedHost: apiBase,
        );
        if (candidate != null) candidates.add(candidate);
      }
      if (decoded.length < 100) break;
    }
    if (page > kRuntimeMaxReleasePages) {
      throw StateError('GitHub runtime Release pagination exceeded the safety limit');
    }
    final candidate = selectLatestRuntimeRelease(candidates);
    final metadataResponse = await _get(candidate.metadataUrl, accept: 'application/octet-stream');
    final metadata = RuntimeReleaseMetadata.fromJson(jsonDecode(metadataResponse.body));
    metadata.validate(
      expectedBranch: channel.branch,
      expectedTag: candidate.tag,
      expectedPipelineIid: candidate.pipelineIid,
    );
    final checksumResponse = await _get(candidate.checksumUrl, accept: 'application/octet-stream');
    final checksum = parseArchiveChecksum(checksumResponse.body);
    if (checksum != metadata.archiveSha256)
      throw StateError('archive checksum asset disagrees with runtime metadata');
    return ResolvedRuntimeRelease(
      metadata: metadata,
      candidate: candidate,
      archiveSha256: checksum,
    );
  }

  Future<Uint8List> downloadArchive(ResolvedRuntimeRelease release) async {
    final response = await _get(release.candidate.archiveUrl, accept: 'application/octet-stream');
    return Uint8List.fromList(response.bodyBytes);
  }

  Future<http.Response> _get(Uri uri, {String? accept}) async {
    final response = await _request(uri, accept: accept);
    _expectSuccess(response, uri);
    return response;
  }

  Future<http.Response> _request(Uri uri, {String? accept}) async {
    var current = uri;
    for (var redirect = 0; ; redirect++) {
      final request = http.Request('GET', current)
        ..followRedirects = false
        ..headers['Accept'] = accept ?? 'application/vnd.github+json'
        ..headers['X-GitHub-Api-Version'] = '2022-11-28';
      if (token.trim().isNotEmpty && _sameOrigin(current, apiBase)) {
        request.headers['Authorization'] = 'Bearer ${token.trim()}';
      }
      final response = await http.Response.fromStream(await _httpClient.send(request));
      if (!_isRedirect(response.statusCode)) return response;
      if (redirect >= 5) throw StateError('GitHub runtime request exceeded redirect limit');
      final location = response.headers['location'];
      if (location == null) throw StateError('GitHub runtime redirect did not include a location');
      current = current.resolve(location);
      if (current.scheme != 'https') {
        throw StateError('GitHub runtime redirect must use HTTPS');
      }
    }
  }

  static bool _isRedirect(int statusCode) =>
      statusCode == 301 ||
      statusCode == 302 ||
      statusCode == 303 ||
      statusCode == 307 ||
      statusCode == 308;

  static bool _sameOrigin(Uri a, Uri b) =>
      a.scheme == b.scheme && a.host == b.host && a.port == b.port;

  static void _expectSuccess(http.Response response, Uri uri) {
    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw StateError(
        'GitHub runtime request failed with HTTP ${response.statusCode}: ${uri.path}',
      );
    }
  }
}

String parseArchiveChecksum(String value) {
  final match = RegExp(r'^([0-9a-f]{64})\s+webview-runtime\.tar\.gz\s*$').firstMatch(value.trim());
  if (match == null) throw const FormatException('invalid runtime archive checksum asset');
  return match.group(1)!;
}

class RuntimeArchiveCache {
  RuntimeArchiveCache(this.root);

  final Directory root;

  Future<Uint8List?> read(String sha256Hex) async {
    final cacheDirectory = Directory(p.join(root.path, sha256Hex));
    final file = File(p.join(cacheDirectory.path, kRuntimeArchiveName));
    if (await Link(cacheDirectory.path).exists() || await Link(file.path).exists()) return null;
    if (!await file.exists()) return null;
    final bytes = await file.readAsBytes();
    if (sha256.convert(bytes).toString() != sha256Hex) return null;
    return Uint8List.fromList(bytes);
  }

  Future<Uint8List> getOrStore(String sha256Hex, Future<Uint8List> Function() download) async {
    final hit = await read(sha256Hex);
    if (hit != null) return hit;
    final bytes = await download();
    if (sha256.convert(bytes).toString() != sha256Hex)
      throw StateError('downloaded runtime archive SHA-256 mismatch');
    final destination = Directory(p.join(root.path, sha256Hex));
    if (await Link(destination.path).exists()) {
      throw StateError('runtime cache path must not be a symbolic link');
    }
    await destination.create(recursive: true);
    final temporary = File(p.join(destination.path, '.$kRuntimeArchiveName.tmp-${pid}'));
    await temporary.writeAsBytes(bytes, flush: true);
    final finalFile = File(p.join(destination.path, kRuntimeArchiveName));
    if (await Link(finalFile.path).exists())
      throw StateError('runtime cache file must not be a symbolic link');
    if (await finalFile.exists()) await finalFile.delete();
    await temporary.rename(finalFile.path);
    return bytes;
  }
}

String normalizeArchivePath(String name) {
  var normalized = name.replaceAll('\\', '/');
  while (normalized.startsWith('./')) {
    normalized = normalized.substring(2);
  }
  normalized = normalized.replaceFirst(RegExp(r'/+$'), '');
  if (normalized.isEmpty) return '';
  if (normalized.startsWith('/') || RegExp(r'^[a-zA-Z]:').hasMatch(normalized)) {
    throw StateError('runtime archive contains an absolute path');
  }
  final parts = normalized.split('/');
  if (parts.any((part) => part.isEmpty || part == '..')) {
    throw StateError('runtime archive contains an unsafe path: $name');
  }
  return parts.join('/');
}

void validateArchiveEntries(
  Iterable<ArchiveFile> entries, {
  int maxFiles = kRuntimeMaxArchiveFiles,
  int maxFileBytes = kRuntimeMaxArchiveFileBytes,
  int maxTotalBytes = kRuntimeMaxArchiveUncompressedBytes,
}) {
  final seen = <String>{};
  var totalBytes = 0;
  var fileCount = 0;
  for (final entry in entries) {
    final path = normalizeArchivePath(entry.name);
    if (path.isEmpty) continue;
    fileCount++;
    if (fileCount > maxFiles) throw StateError('runtime archive contains too many entries');
    final size = entry.size > entry.content.length ? entry.size : entry.content.length;
    if (size > maxFileBytes) throw StateError('runtime archive contains an oversized file: $path');
    totalBytes += size;
    if (totalBytes > maxTotalBytes)
      throw StateError('runtime archive exceeds the uncompressed size limit');
    if (!seen.add(path)) throw StateError('runtime archive contains duplicate entry: $path');
    if (entry.isSymbolicLink)
      throw StateError('runtime archive must not contain symbolic links: $path');
  }
}

Future<Directory> extractRuntimeArchive({
  required Uint8List bytes,
  required Directory destination,
}) async {
  if (bytes.length > kRuntimeMaxArchiveBytes) {
    throw StateError('runtime archive exceeds the compressed size limit');
  }
  final archive = TarDecoder().decodeBytes(GZipDecoder().decodeBytes(bytes));
  validateArchiveEntries(archive.files);
  await destination.create(recursive: true);
  for (final entry in archive.files) {
    final path = normalizeArchivePath(entry.name);
    if (path.isEmpty) continue;
    final target = File(p.joinAll(<String>[destination.path, ...path.split('/')]));
    if (entry.isFile) {
      await target.parent.create(recursive: true);
      await target.writeAsBytes(List<int>.from(entry.content as List<int>));
    } else {
      await Directory(target.path).create(recursive: true);
    }
  }
  return destination;
}

void verifyRuntimeDirectory(Directory runtimeDir, RuntimeReleaseMetadata metadata) {
  final versionFile = File(p.join(runtimeDir.path, 'runtime-version.json'));
  final indexFile = File(p.join(runtimeDir.path, 'index.html'));
  if (!versionFile.existsSync() || !indexFile.existsSync())
    throw StateError('runtime archive is missing index.html or runtime-version.json');
  final version = jsonDecode(versionFile.readAsStringSync());
  if (version is! Map<String, Object?> || version['package'] != 'webview-runtime')
    throw StateError('runtime-version.json package is invalid');
  if (version['buildId'] is! String ||
      version['webEntrySha256'] is! String ||
      !RegExp(r'^[0-9a-f]{64}$').hasMatch(version['webEntrySha256']! as String)) {
    throw StateError('runtime-version.json integrity metadata is invalid');
  }
  if (version['sourceCommit'] != metadata.sourceCommit ||
      version['protocolVersion'] != metadata.protocolVersion ||
      version['hostEnvelopeVersion'] != metadata.hostEnvelopeVersion) {
    throw StateError('runtime-version.json identity does not match runtime release metadata');
  }
  final entryName = version['webEntry'];
  final entrySha = version['webEntrySha256'];
  if (entryName is! String || entrySha is! String)
    throw StateError('runtime-version.json entry metadata is invalid');
  final entryPath = File(
    p.joinAll(<String>[runtimeDir.path, ...normalizeArchivePath(entryName).split('/')]),
  );
  if (!entryPath.existsSync() || sha256.convert(entryPath.readAsBytesSync()).toString() != entrySha)
    throw StateError('runtime iframe entry checksum mismatch');
  for (final html in <File>[indexFile, entryPath]) {
    final text = html.readAsStringSync();
    for (final match in RegExp(
      r'''\b(?:src|href)\s*=\s*(["'])(.*?)\1''',
      caseSensitive: false,
    ).allMatches(text)) {
      final reference = match.group(2)!.split(RegExp(r'[?#]')).first;
      if (reference.isEmpty ||
          reference.startsWith('/') ||
          RegExp(r'^[a-z][a-z0-9+.-]*:', caseSensitive: false).hasMatch(reference))
        continue;
      final referencePath = normalizeArchivePath(reference);
      final target = File(p.joinAll(<String>[html.parent.path, ...referencePath.split('/')]));
      if (!target.existsSync())
        throw StateError('runtime HTML references missing asset: $reference');
    }
  }
}

String generateRuntimeManifest(RuntimeReleaseMetadata metadata, Map<String, Object?> version) {
  String quote(Object? value) => jsonEncode(value);
  return '''/// Generated by tool/richtext_runtime_prepare.dart — do not hand-edit.
library;

const int kRichTextRuntimeProtocolVersion = ${version['protocolVersion']};
const int kRichTextHostEnvelopeVersion = ${version['hostEnvelopeVersion']};

class RichTextRuntimeManifest {
  const RichTextRuntimeManifest({
    required this.protocolVersion,
    required this.hostEnvelopeVersion,
    required this.buildId,
    required this.webEntry,
    required this.webEntrySha256,
    this.sourceCommit,
    this.branch,
    this.branchIdentity,
    this.releaseTag,
    this.pipelineId,
    this.pipelineIid,
    this.archiveSha256,
  });

  final int protocolVersion;
  final int hostEnvelopeVersion;
  final String buildId;
  final String webEntry;
  final String webEntrySha256;
  final String? sourceCommit;
  final String? branch;
  final String? branchIdentity;
  final String? releaseTag;
  final int? pipelineId;
  final int? pipelineIid;
  final String? archiveSha256;

  String get webEntryAssetPath => 'assets/packages/flutter_quill_editor/assets/richtext_webview_runtime/\$webEntry';
}

const RichTextRuntimeManifest kRichTextRuntimeManifest = RichTextRuntimeManifest(
  protocolVersion: ${version['protocolVersion']},
  hostEnvelopeVersion: ${version['hostEnvelopeVersion']},
  buildId: ${quote(version['buildId'])},
  webEntry: ${quote(version['webEntry'])},
  webEntrySha256: ${quote(version['webEntrySha256'])},
  sourceCommit: ${quote(metadata.sourceCommit)},
  branch: ${quote(metadata.branch)},
  branchIdentity: ${quote(metadata.branchIdentity)},
  releaseTag: ${quote(metadata.releaseTag)},
  pipelineId: ${metadata.pipelineId},
  pipelineIid: ${metadata.pipelineIid},
  archiveSha256: ${quote(metadata.archiveSha256)},
);
''';
}

Future<void> atomicallyMaterializeRuntime({
  required Directory prepared,
  required Directory destination,
}) async {
  final parent = destination.parent;
  await parent.create(recursive: true);
  final old = Directory(p.join(parent.path, '.${p.basename(destination.path)}.old-$pid'));
  if (await old.exists()) await old.delete(recursive: true);
  final readme = File(p.join(destination.path, 'README.md'));
  final readmeBytes = await readme.exists() ? await readme.readAsBytes() : null;
  if (await destination.exists()) await destination.rename(old.path);
  try {
    if (readmeBytes != null) {
      await File(p.join(prepared.path, 'README.md')).writeAsBytes(readmeBytes, flush: true);
    }
    await prepared.rename(destination.path);
  } catch (_) {
    if (await old.exists() && !await destination.exists()) await old.rename(destination.path);
    rethrow;
  }
  if (await old.exists()) await old.delete(recursive: true);
}
