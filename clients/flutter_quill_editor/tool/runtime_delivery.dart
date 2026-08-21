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
const String kRuntimeArtifactMetadataName = 'runtime-artifact.json';
const String kRuntimeChecksumName = 'webview-runtime.tar.gz.sha256';
const String kRuntimeLockName = 'richtext-runtime.lock.json';
const String kRuntimeArtifactTagPrefix = 'webview-runtime-artifact-';
const String kDefaultRuntimeRepository = 'TeamGaga2/flutter_quill_editor';
const int kRuntimeLockSchemaVersion = 1;
const int kRuntimeMaxReleasePages = 100;
const int kRuntimeMaxArchiveBytes = 100 * 1024 * 1024;
const int kRuntimeMaxArchiveFiles = 10 * 1000;
const int kRuntimeMaxArchiveFileBytes = 50 * 1024 * 1024;
const int kRuntimeMaxArchiveUncompressedBytes = 200 * 1024 * 1024;

String runtimeBranchIdentity(String branch) =>
    sha256.convert(utf8.encode(branch)).toString();

Future<Directory> createRuntimePreparationDirectory(Directory outputParent) =>
    outputParent.createTemp('.richtext-runtime-');

class RuntimeChannelConfig {
  const RuntimeChannelConfig({required this.branch});

  factory RuntimeChannelConfig.fromJson(Object? json) {
    if (json is! Map<String, Object?> || json['branch'] is! String) {
      throw const FormatException(
        'runtime channel config must contain a string branch',
      );
    }
    final branch = (json['branch']! as String).trim();
    if (branch.isEmpty ||
        branch.length > 255 ||
        branch.contains('\n') ||
        branch.contains('\r')) {
      throw const FormatException(
        'runtime channel branch must be a non-empty single line',
      );
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
      if (result is! int || result <= 0)
        throw FormatException('runtime-release.json invalid $key');
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

  void validate({
    String? expectedBranch,
    String? expectedTag,
    int? expectedPipelineIid,
  }) {
    if (expectedBranch != null && branch != expectedBranch) {
      throw StateError('runtime release branch does not match channel');
    }
    if (expectedTag != null && releaseTag != expectedTag) {
      throw StateError('runtime release tag does not match metadata');
    }
    if (expectedPipelineIid != null && pipelineIid != expectedPipelineIid) {
      throw StateError('runtime release pipeline IID does not match metadata');
    }
    if (branchIdentity != runtimeBranchIdentity(branch) ||
        branchIdentity.length != 64) {
      throw StateError('runtime release branch identity is invalid');
    }
    if (!RegExp(r'^[0-9a-f]{40}$').hasMatch(sourceCommit)) {
      throw StateError(
        'runtime release source commit must be a full lowercase SHA',
      );
    }
    if (archiveName != kRuntimeArchiveName ||
        !RegExp(r'^[0-9a-f]{64}$').hasMatch(archiveSha256)) {
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
  if (value is! Map<String, Object?> || value['tag_name'] is! String)
    return null;
  if (value['draft'] == true || value['prerelease'] == true) return null;
  final tag = value['tag_name']! as String;
  final match = RegExp(
    r'^webview-runtime-channel-[a-z0-9-]+-([0-9a-f]{16})-([1-9][0-9]*)$',
  ).firstMatch(tag);
  if (match == null || match.group(1) != branchIdentity.substring(0, 16))
    return null;
  final iid = int.tryParse(match.group(2)!);
  if (iid == null || iid <= 0) return null;
  final assets = value['assets'];
  if (assets is! List<Object?>) return null;
  final links = <String, Uri>{};
  for (final raw in assets) {
    if (raw is! Map<String, Object?> ||
        raw['name'] is! String ||
        raw['url'] is! String)
      continue;
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
  if (metadataUrl == null || archiveUrl == null || checksumUrl == null)
    return null;
  return RuntimeReleaseCandidate(
    tag: tag,
    pipelineIid: iid,
    metadataUrl: metadataUrl,
    archiveUrl: archiveUrl,
    checksumUrl: checksumUrl,
  );
}

RuntimeReleaseCandidate selectLatestRuntimeRelease(
  Iterable<RuntimeReleaseCandidate> candidates,
) {
  final sorted = candidates.toList()
    ..sort((a, b) => b.pipelineIid.compareTo(a.pipelineIid));
  if (sorted.isEmpty)
    throw StateError(
      'no successful runtime Release exists for the configured branch',
    );
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
    if (apiBase.scheme != 'https' ||
        apiBase.host.isEmpty ||
        apiBase.userInfo.isNotEmpty ||
        apiBase.query.isNotEmpty ||
        apiBase.fragment.isNotEmpty) {
      throw ArgumentError.value(
        apiBase,
        'apiBase',
        'must be an HTTPS GitHub API URL',
      );
    }
    final parts = project.split('/');
    if (parts.length != 2 ||
        parts.any(
          (part) => part.isEmpty || part.contains(RegExp(r'[?#\\\s]')),
        )) {
      throw ArgumentError.value(
        project,
        'project',
        'must be an owner/name repository',
      );
    }
  }

  final Uri apiBase;
  final String project;
  final String token;
  final http.Client _httpClient;

  Uri _repositoryUri(List<String> suffix) {
    final parts = project.split('/');
    if (parts.length != 2 ||
        parts.any(
          (part) => part.isEmpty || part.contains(RegExp(r'[?#\\\s]')),
        )) {
      throw StateError('GitHub runtime repository must be owner/name');
    }
    return apiBase.replace(
      pathSegments: <String>[
        ...apiBase.pathSegments,
        'repos',
        ...parts,
        ...suffix,
      ],
      query: '',
      fragment: '',
    );
  }

  /// Fetch one promoted release by its exact immutable tag.
  ///
  /// This endpoint intentionally does not share the legacy `resolveLatest`
  /// implementation. A missing tag, draft release, extra asset, metadata
  /// mismatch, or checksum mismatch is a hard failure.
  Future<ExactRuntimeArtifact> fetchExactArtifact(String releaseTag) async {
    final sourceCommit = parseRuntimeArtifactTag(releaseTag);
    if (sourceCommit == null)
      throw StateError('invalid exact runtime artifact release tag');
    final releaseUri = _repositoryUri(<String>['releases', 'tags', releaseTag]);
    final response = await _get(releaseUri);
    final release = _runtimeObject(jsonDecode(response.body), 'GitHub release');
    if (release['draft'] == true || release['prerelease'] == true) {
      throw StateError('exact runtime artifact release must be published');
    }
    if (release['tag_name'] != releaseTag) {
      throw StateError('GitHub release tag does not match requested exact tag');
    }
    final rawAssets = release['assets'];
    if (rawAssets is! List)
      throw StateError('GitHub release assets are missing');
    final assets = <String, Uri>{};
    for (final raw in rawAssets) {
      final asset = _runtimeObject(raw, 'GitHub release asset');
      final name = asset['name'];
      final url = asset['url'];
      if (name is! String || url is! String || name.isEmpty) {
        throw StateError('GitHub release contains an invalid asset');
      }
      if (assets.containsKey(name))
        throw StateError('GitHub release contains duplicate asset: $name');
      final parsed = Uri.tryParse(url);
      if (parsed == null ||
          parsed.scheme != apiBase.scheme ||
          parsed.host != apiBase.host ||
          parsed.port != apiBase.port ||
          parsed.userInfo.isNotEmpty ||
          parsed.query.isNotEmpty ||
          parsed.fragment.isNotEmpty) {
        throw StateError(
          'GitHub release asset URL has an unexpected origin: $name',
        );
      }
      assets[name] = parsed;
    }
    final expectedNames = <String>{
      kRuntimeArtifactMetadataName,
      kRuntimeArchiveName,
      kRuntimeChecksumName,
    };
    if (assets.length != expectedNames.length ||
        !assets.keys.every(expectedNames.contains)) {
      throw StateError(
        'GitHub release must contain exactly the runtime artifact assets',
      );
    }
    final metadataResponse = await _get(
      assets[kRuntimeArtifactMetadataName]!,
      accept: 'application/octet-stream',
    );
    final metadata = RuntimeArtifactMetadata.fromJson(
      jsonDecode(metadataResponse.body),
    );
    if (metadata.sourceCommit != sourceCommit) {
      throw StateError(
        'runtime artifact metadata sourceCommit does not match exact tag',
      );
    }
    final tagCommit = await _fetchExactTagCommit(releaseTag);
    if (tagCommit != sourceCommit) {
      throw StateError(
        'runtime artifact tag ref does not point to metadata sourceCommit',
      );
    }
    final checksumResponse = await _get(
      assets[kRuntimeChecksumName]!,
      accept: 'application/octet-stream',
    );
    final checksum = parseArchiveChecksum(checksumResponse.body);
    if (checksum != metadata.archiveSha256) {
      throw StateError(
        'runtime artifact checksum asset disagrees with metadata',
      );
    }
    final archiveResponse = await _get(
      assets[kRuntimeArchiveName]!,
      accept: 'application/octet-stream',
    );
    final archive = Uint8List.fromList(archiveResponse.bodyBytes);
    final archiveSha = sha256.convert(archive).toString();
    if (archiveSha != metadata.archiveSha256) {
      throw StateError('runtime artifact archive does not match metadata');
    }
    return ExactRuntimeArtifact(
      releaseTag: releaseTag,
      bundle: RuntimeArtifactBundle(
        metadata: metadata,
        archiveBytes: archive,
        archiveSha256: archiveSha,
      ),
    );
  }

  Future<String> _fetchExactTagCommit(String releaseTag) async {
    final response = await _get(
      _repositoryUri(<String>['git', 'ref', 'tags', releaseTag]),
    );
    final ref = _runtimeObject(jsonDecode(response.body), 'GitHub tag ref');
    if (ref['ref'] != 'refs/tags/$releaseTag') {
      throw StateError('GitHub tag ref does not match requested exact tag');
    }
    final object = _runtimeObject(ref['object'], 'GitHub tag ref object');
    final type = object['type'];
    final sha = object['sha'];
    if (type == 'commit') {
      if (sha is! String) throw StateError('GitHub tag commit is invalid');
      _assertRuntimeCommit(sha, 'GitHub tag commit');
      return sha;
    }
    if (type != 'tag' || sha is! String) {
      throw StateError(
        'GitHub runtime artifact tag does not point to a commit',
      );
    }
    _assertRuntimeCommit(sha, 'GitHub annotated tag object');
    final tagResponse = await _get(
      _repositoryUri(<String>['git', 'tags', sha]),
    );
    final annotated = _runtimeObject(
      jsonDecode(tagResponse.body),
      'GitHub annotated tag',
    );
    final target = _runtimeObject(
      annotated['object'],
      'GitHub annotated target',
    );
    if (target['type'] != 'commit' || target['sha'] is! String) {
      throw StateError(
        'GitHub runtime artifact annotated tag does not point to a commit',
      );
    }
    final commit = target['sha']! as String;
    _assertRuntimeCommit(commit, 'GitHub annotated tag commit');
    return commit;
  }

  Future<ResolvedRuntimeRelease> resolveLatest(
    RuntimeChannelConfig channel,
  ) async {
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
      throw StateError(
        'GitHub runtime Release pagination exceeded the safety limit',
      );
    }
    final candidate = selectLatestRuntimeRelease(candidates);
    final metadataResponse = await _get(
      candidate.metadataUrl,
      accept: 'application/octet-stream',
    );
    final metadata = RuntimeReleaseMetadata.fromJson(
      jsonDecode(metadataResponse.body),
    );
    metadata.validate(
      expectedBranch: channel.branch,
      expectedTag: candidate.tag,
      expectedPipelineIid: candidate.pipelineIid,
    );
    final checksumResponse = await _get(
      candidate.checksumUrl,
      accept: 'application/octet-stream',
    );
    final checksum = parseArchiveChecksum(checksumResponse.body);
    if (checksum != metadata.archiveSha256)
      throw StateError(
        'archive checksum asset disagrees with runtime metadata',
      );
    return ResolvedRuntimeRelease(
      metadata: metadata,
      candidate: candidate,
      archiveSha256: checksum,
    );
  }

  Future<Uint8List> downloadArchive(ResolvedRuntimeRelease release) async {
    final response = await _get(
      release.candidate.archiveUrl,
      accept: 'application/octet-stream',
    );
    return Uint8List.fromList(response.bodyBytes);
  }

  Future<http.Response> _get(Uri uri, {String? accept}) async {
    final response = await _request(uri, accept: accept);
    _expectSuccess(response, uri);
    return response;
  }

  Future<http.Response> _request(Uri uri, {String? accept}) async {
    var current = uri;
    var crossedOrigin = false;
    for (var redirect = 0; ; redirect++) {
      if (!_allowedRuntimeOrigin(current)) {
        throw StateError(
          'GitHub runtime request has an untrusted origin: ${current.origin}',
        );
      }
      final request = http.Request('GET', current)
        ..followRedirects = false
        ..headers['Accept'] = accept ?? 'application/vnd.github+json';
      if (_sameOrigin(current, apiBase)) {
        request.headers['X-GitHub-Api-Version'] = '2022-11-28';
      }
      if (!crossedOrigin &&
          token.trim().isNotEmpty &&
          _sameOrigin(current, apiBase)) {
        request.headers['Authorization'] = 'Bearer ${token.trim()}';
      }
      final response = await http.Response.fromStream(
        await _httpClient.send(request),
      );
      if (!_isRedirect(response.statusCode)) return response;
      if (redirect >= 5)
        throw StateError('GitHub runtime request exceeded redirect limit');
      final location = response.headers['location'];
      if (location == null)
        throw StateError('GitHub runtime redirect did not include a location');
      current = current.resolve(location);
      if (current.scheme != 'https') {
        throw StateError('GitHub runtime redirect must use HTTPS');
      }
      if (!_allowedRuntimeOrigin(current)) {
        throw StateError(
          'GitHub runtime redirect has an untrusted origin: ${current.origin}',
        );
      }
      if (!_sameOrigin(current, uri)) crossedOrigin = true;
    }
  }

  bool _allowedRuntimeOrigin(Uri uri) {
    if (uri.scheme != 'https' || uri.userInfo.isNotEmpty) return false;
    if (_sameOrigin(uri, apiBase)) return true;
    return const <String>{
      'https://github.com',
      'https://objects.githubusercontent.com',
      'https://release-assets.githubusercontent.com',
      'https://uploads.github.com',
    }.contains(uri.origin);
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
  final match = RegExp(
    r'^([0-9a-f]{64})\s+webview-runtime\.tar\.gz\s*$',
  ).firstMatch(value.trim());
  if (match == null)
    throw const FormatException('invalid runtime archive checksum asset');
  return match.group(1)!;
}

class RuntimeArchiveCache {
  RuntimeArchiveCache(this.root);

  final Directory root;

  Future<Uint8List?> read(String sha256Hex) async {
    final cacheDirectory = Directory(p.join(root.path, sha256Hex));
    final file = File(p.join(cacheDirectory.path, kRuntimeArchiveName));
    if (await Link(cacheDirectory.path).exists() ||
        await Link(file.path).exists())
      return null;
    if (!await file.exists()) return null;
    final bytes = await file.readAsBytes();
    if (sha256.convert(bytes).toString() != sha256Hex) return null;
    return Uint8List.fromList(bytes);
  }

  Future<Uint8List> getOrStore(
    String sha256Hex,
    Future<Uint8List> Function() download,
  ) async {
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
    final temporary = File(
      p.join(destination.path, '.$kRuntimeArchiveName.tmp-${pid}'),
    );
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
  if (!_isPortableAsciiPath(name) || name.contains('\\')) {
    throw StateError(
      'runtime archive path must use portable printable ASCII: $name',
    );
  }
  var normalized = name;
  while (normalized.startsWith('./')) {
    normalized = normalized.substring(2);
  }
  normalized = normalized.replaceFirst(RegExp(r'/+$'), '');
  if (normalized.isEmpty) return '';
  if (normalized.startsWith('/') ||
      RegExp(r'^[a-zA-Z]:').hasMatch(normalized)) {
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
    if (fileCount > maxFiles)
      throw StateError('runtime archive contains too many entries');
    final size = entry.size > entry.content.length
        ? entry.size
        : entry.content.length;
    if (size > maxFileBytes)
      throw StateError('runtime archive contains an oversized file: $path');
    totalBytes += size;
    if (totalBytes > maxTotalBytes)
      throw StateError('runtime archive exceeds the uncompressed size limit');
    if (!seen.add(path))
      throw StateError('runtime archive contains duplicate entry: $path');
    if (entry.isSymbolicLink)
      throw StateError(
        'runtime archive must not contain symbolic links: $path',
      );
  }
}

Future<Directory> extractRuntimeArchive({
  required Uint8List bytes,
  required Directory destination,
}) async {
  if (bytes.length > kRuntimeMaxArchiveBytes) {
    throw StateError('runtime archive exceeds the compressed size limit');
  }
  final destinationType = FileSystemEntity.typeSync(
    destination.path,
    followLinks: false,
  );
  if (destinationType == FileSystemEntityType.link ||
      (destinationType != FileSystemEntityType.notFound &&
          destinationType != FileSystemEntityType.directory)) {
    throw StateError('runtime archive destination must be a real directory');
  }
  final archive = TarDecoder().decodeBytes(GZipDecoder().decodeBytes(bytes));
  validateArchiveEntries(archive.files);
  await destination.create(recursive: true);
  for (final entry in archive.files) {
    final path = normalizeArchivePath(entry.name);
    if (path.isEmpty) continue;
    final target = File(
      p.joinAll(<String>[destination.path, ...path.split('/')]),
    );
    if (entry.isFile) {
      await target.parent.create(recursive: true);
      await target.writeAsBytes(List<int>.from(entry.content as List<int>));
    } else {
      await Directory(target.path).create(recursive: true);
    }
  }
  return destination;
}

void verifyRuntimeDirectory(
  Directory runtimeDir,
  RuntimeReleaseMetadata metadata,
) {
  final versionFile = File(p.join(runtimeDir.path, 'runtime-version.json'));
  final indexFile = File(p.join(runtimeDir.path, 'index.html'));
  if (!versionFile.existsSync() || !indexFile.existsSync())
    throw StateError(
      'runtime archive is missing index.html or runtime-version.json',
    );
  final version = jsonDecode(versionFile.readAsStringSync());
  if (version is! Map<String, Object?> ||
      version['package'] != 'webview-runtime')
    throw StateError('runtime-version.json package is invalid');
  if (version['buildId'] is! String ||
      version['webEntrySha256'] is! String ||
      !RegExp(
        r'^[0-9a-f]{64}$',
      ).hasMatch(version['webEntrySha256']! as String)) {
    throw StateError('runtime-version.json integrity metadata is invalid');
  }
  if (version['sourceCommit'] != metadata.sourceCommit ||
      version['protocolVersion'] != metadata.protocolVersion ||
      version['hostEnvelopeVersion'] != metadata.hostEnvelopeVersion) {
    throw StateError(
      'runtime-version.json identity does not match runtime release metadata',
    );
  }
  final entryName = version['webEntry'];
  final entrySha = version['webEntrySha256'];
  if (entryName is! String || entrySha is! String)
    throw StateError('runtime-version.json entry metadata is invalid');
  final entryPath = File(
    p.joinAll(<String>[
      runtimeDir.path,
      ...normalizeArchivePath(entryName).split('/'),
    ]),
  );
  if (!entryPath.existsSync() ||
      sha256.convert(entryPath.readAsBytesSync()).toString() != entrySha)
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
          RegExp(
            r'^[a-z][a-z0-9+.-]*:',
            caseSensitive: false,
          ).hasMatch(reference))
        continue;
      final referencePath = normalizeArchivePath(reference);
      final target = File(
        p.joinAll(<String>[html.parent.path, ...referencePath.split('/')]),
      );
      if (!target.existsSync())
        throw StateError('runtime HTML references missing asset: $reference');
    }
  }
}

String generateRuntimeManifest(
  RuntimeReleaseMetadata metadata,
  Map<String, Object?> version,
) {
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
  final old = Directory(
    p.join(parent.path, '.${p.basename(destination.path)}.old-$pid'),
  );
  if (await old.exists()) await old.delete(recursive: true);
  final readme = File(p.join(destination.path, 'README.md'));
  final readmeBytes = await readme.exists() ? await readme.readAsBytes() : null;
  if (await destination.exists()) await destination.rename(old.path);
  try {
    if (readmeBytes != null) {
      await File(
        p.join(prepared.path, 'README.md'),
      ).writeAsBytes(readmeBytes, flush: true);
    }
    await prepared.rename(destination.path);
  } catch (_) {
    if (await old.exists() && !await destination.exists())
      await old.rename(destination.path);
    rethrow;
  }
  if (await old.exists()) await old.delete(recursive: true);
}

// ---------------------------------------------------------------------------
// Explicit artifact/lock delivery (PR-2).
//
// The branch/latest implementation above is intentionally kept during the
// migration window.  New callers must use the types and functions below.  In
// particular, none of these APIs enumerate releases or infer an artifact from
// a branch name.

final RegExp _runtimeCommitPattern = RegExp(r'^[0-9a-f]{40}$');
final RegExp _runtimeSha256Pattern = RegExp(r'^[0-9a-f]{64}$');
final RegExp _runtimeArtifactTagPattern = RegExp(
  r'^webview-runtime-artifact-([0-9a-f]{40})$',
);

String runtimeArtifactTag(String sourceCommit) {
  if (!_runtimeCommitPattern.hasMatch(sourceCommit)) {
    throw ArgumentError.value(
      sourceCommit,
      'sourceCommit',
      'must be a full lowercase SHA',
    );
  }
  return '$kRuntimeArtifactTagPrefix$sourceCommit';
}

String? parseRuntimeArtifactTag(String tag) {
  final match = _runtimeArtifactTagPattern.firstMatch(tag);
  return match?.group(1);
}

void _assertRuntimeSha256(String value, String label) {
  if (!_runtimeSha256Pattern.hasMatch(value)) {
    throw FormatException('$label must be a lowercase SHA-256');
  }
}

void _assertRuntimeCommit(String value, String label) {
  if (!_runtimeCommitPattern.hasMatch(value)) {
    throw FormatException('$label must be a full lowercase commit SHA');
  }
}

Map<String, Object?> _runtimeObject(Object? value, String label) {
  if (value is! Map) throw FormatException('$label must be an object');
  final result = <String, Object?>{};
  for (final entry in value.entries) {
    if (entry.key is! String)
      throw FormatException('$label keys must be strings');
    result[entry.key as String] = entry.value;
  }
  return result;
}

void _assertExactRuntimeKeys(
  Map<String, Object?> value,
  Set<String> keys,
  String label,
) {
  if (value.length != keys.length || !value.keys.every(keys.contains)) {
    throw FormatException('$label has an unexpected schema');
  }
}

String _runtimeString(Map<String, Object?> value, String key, String label) {
  final result = value[key];
  if (result is! String || result.isEmpty)
    throw FormatException('$label missing $key');
  return result;
}

int _runtimePositiveInt(Map<String, Object?> value, String key, String label) {
  final result = value[key];
  if (result is! int || result <= 0)
    throw FormatException('$label invalid $key');
  return result;
}

void _assertRuntimeRelativePath(String value, String label) {
  if (value.isEmpty ||
      !_isPortableAsciiPath(value) ||
      value.startsWith('/') ||
      value.contains('\\') ||
      RegExp(r'^[a-zA-Z]:').hasMatch(value) ||
      value
          .split('/')
          .any((part) => part.isEmpty || part == '..' || part == '.')) {
    throw FormatException('$label must be a safe relative path');
  }
}

void _assertRuntimeHtmlReference(String value) {
  if (value.isEmpty ||
      !_isPortableAsciiPath(value) ||
      value.startsWith('/') ||
      value.contains('\\') ||
      RegExp(r'^[a-zA-Z]:').hasMatch(value) ||
      value
          .split('/')
          .any((part) => part.isEmpty || part == '..' || part == '.')) {
    throw FormatException(
      'runtime HTML reference must be a safe relative path',
    );
  }
}

bool _isPortableAsciiPath(String value) =>
    value.codeUnits.every((unit) => unit >= 0x20 && unit <= 0x7e);

/// Metadata carried beside a promoted archive.  It deliberately contains no
/// release URL, branch, pipeline number, or credential.
class RuntimeArtifactMetadata {
  RuntimeArtifactMetadata({
    required this.schemaVersion,
    required this.package,
    required this.archiveName,
    required this.archiveSha256,
    required this.contentSha256,
    required this.sourceCommit,
    required this.buildId,
    required this.protocolVersion,
    required this.hostEnvelopeVersion,
    required this.webEntry,
    required this.webEntrySha256,
  });

  factory RuntimeArtifactMetadata.fromJson(Object? value) {
    final map = _runtimeObject(value, kRuntimeArtifactMetadataName);
    _assertExactRuntimeKeys(map, <String>{
      'schemaVersion',
      'package',
      'archiveName',
      'archiveSha256',
      'contentSha256',
      'sourceCommit',
      'buildId',
      'protocolVersion',
      'hostEnvelopeVersion',
      'webEntry',
      'webEntrySha256',
    }, kRuntimeArtifactMetadataName);
    final metadata = RuntimeArtifactMetadata(
      schemaVersion: map['schemaVersion'] is int
          ? map['schemaVersion']! as int
          : -1,
      package: _runtimeString(map, 'package', kRuntimeArtifactMetadataName),
      archiveName: _runtimeString(
        map,
        'archiveName',
        kRuntimeArtifactMetadataName,
      ),
      archiveSha256: _runtimeString(
        map,
        'archiveSha256',
        kRuntimeArtifactMetadataName,
      ),
      contentSha256: _runtimeString(
        map,
        'contentSha256',
        kRuntimeArtifactMetadataName,
      ),
      sourceCommit: _runtimeString(
        map,
        'sourceCommit',
        kRuntimeArtifactMetadataName,
      ),
      buildId: _runtimeString(map, 'buildId', kRuntimeArtifactMetadataName),
      protocolVersion: map['protocolVersion'] is int
          ? map['protocolVersion']! as int
          : -1,
      hostEnvelopeVersion: map['hostEnvelopeVersion'] is int
          ? map['hostEnvelopeVersion']! as int
          : -1,
      webEntry: _runtimeString(map, 'webEntry', kRuntimeArtifactMetadataName),
      webEntrySha256: _runtimeString(
        map,
        'webEntrySha256',
        kRuntimeArtifactMetadataName,
      ),
    );
    metadata.validate();
    return metadata;
  }

  final int schemaVersion;
  final String package;
  final String archiveName;
  final String archiveSha256;
  final String contentSha256;
  final String sourceCommit;
  final String buildId;
  final int protocolVersion;
  final int hostEnvelopeVersion;
  final String webEntry;
  final String webEntrySha256;

  void validate() {
    if (schemaVersion != 1 || package != 'webview-runtime') {
      throw StateError('runtime artifact schema or package is invalid');
    }
    if (archiveName != kRuntimeArchiveName) {
      throw StateError('runtime artifact archiveName is invalid');
    }
    _assertRuntimeSha256(archiveSha256, 'archiveSha256');
    _assertRuntimeSha256(contentSha256, 'contentSha256');
    _assertRuntimeCommit(sourceCommit, 'sourceCommit');
    if (buildId.isEmpty)
      throw StateError('runtime artifact buildId is invalid');
    if (protocolVersion <= 0 || hostEnvelopeVersion <= 0) {
      throw StateError('runtime artifact protocol versions are invalid');
    }
    if (protocolVersion != kRichTextProtocolVersion ||
        hostEnvelopeVersion != kHostEnvelopeVersion) {
      throw StateError(
        'runtime artifact is incompatible with this client '
        '(protocol=$protocolVersion, hostEnvelope=$hostEnvelopeVersion)',
      );
    }
    _assertRuntimeRelativePath(webEntry, 'webEntry');
    _assertRuntimeSha256(webEntrySha256, 'webEntrySha256');
  }

  Map<String, Object?> toJson() => <String, Object?>{
    'schemaVersion': schemaVersion,
    'package': package,
    'archiveName': archiveName,
    'archiveSha256': archiveSha256,
    'contentSha256': contentSha256,
    'sourceCommit': sourceCommit,
    'buildId': buildId,
    'protocolVersion': protocolVersion,
    'hostEnvelopeVersion': hostEnvelopeVersion,
    'webEntry': webEntry,
    'webEntrySha256': webEntrySha256,
  };
}

class RuntimeLock {
  RuntimeLock({
    required this.schemaVersion,
    required this.repository,
    required this.releaseTag,
    required this.archiveName,
    required this.archiveSha256,
    required this.contentSha256,
    required this.sourceCommit,
    required this.buildId,
    required this.protocolVersion,
    required this.hostEnvelopeVersion,
    required this.webEntry,
    required this.webEntrySha256,
  });

  factory RuntimeLock.fromJson(
    Object? value, {
    String expectedRepository = kDefaultRuntimeRepository,
  }) {
    if (expectedRepository != kDefaultRuntimeRepository) {
      throw ArgumentError.value(
        expectedRepository,
        'expectedRepository',
        'runtime lock schema v1 is fixed to $kDefaultRuntimeRepository',
      );
    }
    final map = _runtimeObject(value, kRuntimeLockName);
    _assertExactRuntimeKeys(map, <String>{
      'schemaVersion',
      'artifact',
      'runtime',
    }, kRuntimeLockName);
    final artifact = _runtimeObject(map['artifact'], 'lock.artifact');
    final runtime = _runtimeObject(map['runtime'], 'lock.runtime');
    _assertExactRuntimeKeys(artifact, <String>{
      'repository',
      'releaseTag',
      'archiveName',
      'archiveSha256',
      'contentSha256',
    }, 'lock.artifact');
    _assertExactRuntimeKeys(runtime, <String>{
      'sourceCommit',
      'buildId',
      'protocolVersion',
      'hostEnvelopeVersion',
      'webEntry',
      'webEntrySha256',
    }, 'lock.runtime');
    final lock = RuntimeLock(
      schemaVersion: map['schemaVersion'] is int
          ? map['schemaVersion']! as int
          : -1,
      repository: _runtimeString(artifact, 'repository', 'lock.artifact'),
      releaseTag: _runtimeString(artifact, 'releaseTag', 'lock.artifact'),
      archiveName: _runtimeString(artifact, 'archiveName', 'lock.artifact'),
      archiveSha256: _runtimeString(artifact, 'archiveSha256', 'lock.artifact'),
      contentSha256: _runtimeString(artifact, 'contentSha256', 'lock.artifact'),
      sourceCommit: _runtimeString(runtime, 'sourceCommit', 'lock.runtime'),
      buildId: _runtimeString(runtime, 'buildId', 'lock.runtime'),
      protocolVersion: runtime['protocolVersion'] is int
          ? runtime['protocolVersion']! as int
          : -1,
      hostEnvelopeVersion: runtime['hostEnvelopeVersion'] is int
          ? runtime['hostEnvelopeVersion']! as int
          : -1,
      webEntry: _runtimeString(runtime, 'webEntry', 'lock.runtime'),
      webEntrySha256: _runtimeString(runtime, 'webEntrySha256', 'lock.runtime'),
    );
    lock.validate(expectedRepository: expectedRepository);
    return lock;
  }

  final int schemaVersion;
  final String repository;
  final String releaseTag;
  final String archiveName;
  final String archiveSha256;
  final String contentSha256;
  final String sourceCommit;
  final String buildId;
  final int protocolVersion;
  final int hostEnvelopeVersion;
  final String webEntry;
  final String webEntrySha256;

  void validate({String expectedRepository = kDefaultRuntimeRepository}) {
    if (expectedRepository != kDefaultRuntimeRepository) {
      throw ArgumentError.value(
        expectedRepository,
        'expectedRepository',
        'runtime lock schema v1 is fixed to $kDefaultRuntimeRepository',
      );
    }
    if (schemaVersion != kRuntimeLockSchemaVersion) {
      throw StateError('unsupported runtime lock schema: $schemaVersion');
    }
    if (repository != kDefaultRuntimeRepository) {
      throw StateError('runtime lock repository is not allowed');
    }
    _assertRuntimeCommit(sourceCommit, 'lock.runtime.sourceCommit');
    if (releaseTag != runtimeArtifactTag(sourceCommit)) {
      throw StateError('runtime lock releaseTag does not match sourceCommit');
    }
    if (archiveName != kRuntimeArchiveName)
      throw StateError('runtime lock archiveName is invalid');
    _assertRuntimeSha256(archiveSha256, 'lock.artifact.archiveSha256');
    _assertRuntimeSha256(contentSha256, 'lock.artifact.contentSha256');
    if (buildId.isEmpty || protocolVersion <= 0 || hostEnvelopeVersion <= 0) {
      throw StateError('runtime lock runtime identity is invalid');
    }
    if (protocolVersion != kRichTextProtocolVersion ||
        hostEnvelopeVersion != kHostEnvelopeVersion) {
      throw StateError(
        'runtime lock is incompatible with this client '
        '(protocol=$protocolVersion, hostEnvelope=$hostEnvelopeVersion)',
      );
    }
    _assertRuntimeRelativePath(webEntry, 'lock.runtime.webEntry');
    _assertRuntimeSha256(webEntrySha256, 'lock.runtime.webEntrySha256');
  }

  Map<String, Object?> toJson() => <String, Object?>{
    'schemaVersion': schemaVersion,
    'artifact': <String, Object?>{
      'repository': repository,
      'releaseTag': releaseTag,
      'archiveName': archiveName,
      'archiveSha256': archiveSha256,
      'contentSha256': contentSha256,
    },
    'runtime': <String, Object?>{
      'sourceCommit': sourceCommit,
      'buildId': buildId,
      'protocolVersion': protocolVersion,
      'hostEnvelopeVersion': hostEnvelopeVersion,
      'webEntry': webEntry,
      'webEntrySha256': webEntrySha256,
    },
  };

  String toJsonString() =>
      '${const JsonEncoder.withIndent('  ').convert(toJson())}\n';

  static RuntimeLock fromArtifact(
    RuntimeArtifactMetadata metadata, {
    String repository = kDefaultRuntimeRepository,
    required String releaseTag,
  }) {
    if (releaseTag != runtimeArtifactTag(metadata.sourceCommit)) {
      throw StateError('release tag does not match artifact sourceCommit');
    }
    return RuntimeLock(
      schemaVersion: kRuntimeLockSchemaVersion,
      repository: repository,
      releaseTag: releaseTag,
      archiveName: metadata.archiveName,
      archiveSha256: metadata.archiveSha256,
      contentSha256: metadata.contentSha256,
      sourceCommit: metadata.sourceCommit,
      buildId: metadata.buildId,
      protocolVersion: metadata.protocolVersion,
      hostEnvelopeVersion: metadata.hostEnvelopeVersion,
      webEntry: metadata.webEntry,
      webEntrySha256: metadata.webEntrySha256,
    )..validate(expectedRepository: repository);
  }
}

class RuntimeArtifactBundle {
  const RuntimeArtifactBundle({
    required this.metadata,
    required this.archiveBytes,
    required this.archiveSha256,
  });

  final RuntimeArtifactMetadata metadata;
  final Uint8List archiveBytes;
  final String archiveSha256;
}

/// Calculate the cross-language canonical digest used by Node and Dart.
/// Records are ordered by UTF-8 path bytes and have the form
/// `path + NUL + fileSha256 + LF`.
String canonicalContentSha256(Directory root) {
  final rootType = FileSystemEntity.typeSync(root.path, followLinks: false);
  if (rootType != FileSystemEntityType.directory) {
    throw StateError('runtime content root must be a real directory');
  }
  final files = <MapEntry<String, File>>[];
  void walk(Directory directory) {
    for (final entity in directory.listSync(followLinks: false)) {
      final type = FileSystemEntity.typeSync(entity.path, followLinks: false);
      if (type == FileSystemEntityType.link) {
        throw StateError(
          'runtime content must not contain symlinks: ${p.relative(entity.path, from: root.path)}',
        );
      }
      if (type == FileSystemEntityType.directory) {
        walk(Directory(entity.path));
      } else if (type == FileSystemEntityType.file) {
        final relativePath = p
            .relative(entity.path, from: root.path)
            .replaceAll('\\', '/');
        _assertRuntimeRelativePath(relativePath, 'runtime content path');
        files.add(MapEntry(relativePath, File(entity.path)));
      } else {
        throw StateError('runtime content contains an unsupported entry');
      }
    }
  }

  walk(root);
  files.sort((left, right) {
    final a = utf8.encode(left.key);
    final b = utf8.encode(right.key);
    for (var index = 0; index < a.length && index < b.length; index++) {
      final comparison = a[index].compareTo(b[index]);
      if (comparison != 0) return comparison;
    }
    return a.length.compareTo(b.length);
  });
  final records = BytesBuilder(copy: false);
  for (final file in files) {
    final fileSha = sha256.convert(file.value.readAsBytesSync()).toString();
    records.add(utf8.encode('${file.key}\u0000$fileSha\n'));
  }
  return sha256.convert(records.takeBytes()).toString();
}

Map<String, Object?> readRuntimeVersion(File file) {
  if (!file.existsSync()) throw StateError('runtime-version.json is missing');
  final value = _runtimeObject(
    jsonDecode(file.readAsStringSync()),
    'runtime-version.json',
  );
  _assertExactRuntimeKeys(value, <String>{
    'protocolVersion',
    'hostEnvelopeVersion',
    'buildId',
    'builtAt',
    'package',
    'sourceCommit',
    'webEntry',
    'webEntrySha256',
  }, 'runtime-version.json');
  if (value['package'] != 'webview-runtime') {
    throw StateError('runtime-version.json package is invalid');
  }
  final protocolVersion = _runtimePositiveInt(
    value,
    'protocolVersion',
    'runtime-version.json',
  );
  final hostEnvelopeVersion = _runtimePositiveInt(
    value,
    'hostEnvelopeVersion',
    'runtime-version.json',
  );
  final buildId = _runtimeString(value, 'buildId', 'runtime-version.json');
  _runtimeString(value, 'builtAt', 'runtime-version.json');
  final sourceCommit = _runtimeString(
    value,
    'sourceCommit',
    'runtime-version.json',
  );
  _assertRuntimeCommit(sourceCommit, 'runtime-version.json.sourceCommit');
  final webEntry = _runtimeString(value, 'webEntry', 'runtime-version.json');
  _assertRuntimeRelativePath(webEntry, 'runtime-version.json.webEntry');
  final webEntrySha = _runtimeString(
    value,
    'webEntrySha256',
    'runtime-version.json',
  );
  _assertRuntimeSha256(webEntrySha, 'runtime-version.json.webEntrySha256');
  // Keep these local variables referenced so malformed numeric values cannot
  // be silently accepted through a loose JSON cast.
  if (protocolVersion <= 0 || hostEnvelopeVersion <= 0 || buildId.isEmpty) {
    throw StateError('runtime-version.json identity is invalid');
  }
  return value;
}

void _assertRuntimeVersionMatchesLock(
  Map<String, Object?> version,
  RuntimeLock lock,
) {
  final checks = <String, Object?>{
    'sourceCommit': lock.sourceCommit,
    'buildId': lock.buildId,
    'protocolVersion': lock.protocolVersion,
    'hostEnvelopeVersion': lock.hostEnvelopeVersion,
    'webEntry': lock.webEntry,
    'webEntrySha256': lock.webEntrySha256,
  };
  for (final entry in checks.entries) {
    if (version[entry.key] != entry.value) {
      throw StateError('runtime-version.json ${entry.key} does not match lock');
    }
  }
}

void _assertRuntimeVersionMatchesArtifact(
  Map<String, Object?> version,
  RuntimeArtifactMetadata metadata,
) {
  final checks = <String, Object?>{
    'sourceCommit': metadata.sourceCommit,
    'buildId': metadata.buildId,
    'protocolVersion': metadata.protocolVersion,
    'hostEnvelopeVersion': metadata.hostEnvelopeVersion,
    'webEntry': metadata.webEntry,
    'webEntrySha256': metadata.webEntrySha256,
  };
  for (final entry in checks.entries) {
    if (version[entry.key] != entry.value) {
      throw StateError(
        'runtime-version.json ${entry.key} does not match artifact metadata',
      );
    }
  }
}

void _assertRuntimeCompatibility(Map<String, Object?> version) {
  if (version['protocolVersion'] != kRichTextProtocolVersion ||
      version['hostEnvelopeVersion'] != kHostEnvelopeVersion) {
    throw StateError(
      'runtime is incompatible with this client '
      '(protocol=${version['protocolVersion']}, hostEnvelope=${version['hostEnvelopeVersion']})',
    );
  }
}

void _verifyRuntimeHtmlReferences(
  Directory root,
  Map<String, Object?> version,
) {
  final entryName = version['webEntry']! as String;
  final entry = File(p.joinAll(<String>[root.path, ...entryName.split('/')]));
  final index = File(p.join(root.path, 'index.html'));
  if (!index.existsSync() || !entry.existsSync()) {
    throw StateError('runtime is missing index.html or webEntry');
  }
  for (final html in <File>[index, entry]) {
    final text = html.readAsStringSync();
    for (final match in RegExp(
      r'''\b(?:src|href)\s*=\s*(['"])(.*?)\1''',
      caseSensitive: false,
    ).allMatches(text)) {
      final reference = match.group(2)!.split(RegExp(r'[?#]')).first;
      if (reference.isEmpty ||
          reference.startsWith('/') ||
          RegExp(
            r'^[a-z][a-z0-9+.-]*:',
            caseSensitive: false,
          ).hasMatch(reference)) {
        continue;
      }
      var normalizedReference = reference;
      while (normalizedReference.startsWith('./')) {
        normalizedReference = normalizedReference.substring(2);
      }
      if (normalizedReference.isEmpty) {
        throw StateError('runtime HTML reference must name a file');
      }
      _assertRuntimeHtmlReference(normalizedReference);
      final target = File(
        p.joinAll(<String>[
          html.parent.path,
          ...normalizedReference.split('/'),
        ]),
      );
      if (!target.existsSync() ||
          FileSystemEntity.typeSync(target.path, followLinks: false) !=
              FileSystemEntityType.file) {
        throw StateError('runtime HTML references missing asset: $reference');
      }
    }
  }
}

void _verifyRuntimeFilesystemTree(Directory root) {
  final rootType = FileSystemEntity.typeSync(root.path, followLinks: false);
  if (rootType != FileSystemEntityType.directory) {
    throw StateError('runtime root must be a real directory');
  }

  void walk(Directory directory) {
    for (final entity in directory.listSync(followLinks: false)) {
      final type = FileSystemEntity.typeSync(entity.path, followLinks: false);
      if (type == FileSystemEntityType.link) {
        throw StateError(
          'runtime tree must not contain symlinks: ${p.relative(entity.path, from: root.path)}',
        );
      }
      if (type == FileSystemEntityType.directory) {
        walk(Directory(entity.path));
      } else if (type != FileSystemEntityType.file) {
        throw StateError(
          'runtime tree contains a non-regular entry: ${p.relative(entity.path, from: root.path)}',
        );
      }
    }
  }

  walk(root);
}

/// Strictly verify a runtime tree without relying on any release metadata.
Map<String, Object?> verifyRuntimeTree(Directory root) {
  // Scan every directory entry before opening runtime-version.json or any HTML
  // file. A symlink must never be able to redirect validation outside root.
  _verifyRuntimeFilesystemTree(root);
  final version = readRuntimeVersion(
    File(p.join(root.path, 'runtime-version.json')),
  );
  _assertRuntimeCompatibility(version);
  _verifyRuntimeHtmlReferences(root, version);
  final entry = File(
    p.joinAll(<String>[
      root.path,
      ...(version['webEntry']! as String).split('/'),
    ]),
  );
  final actualEntrySha = sha256.convert(entry.readAsBytesSync()).toString();
  if (actualEntrySha != version['webEntrySha256']) {
    throw StateError('runtime iframe entry checksum mismatch');
  }
  // Recompute the same portable path/content digest before any directory is
  // made live.
  canonicalContentSha256(root);
  return version;
}

void verifyLockedRuntimeTree({
  required Directory root,
  required RuntimeLock lock,
  File? generatedManifest,
  String expectedRepository = kDefaultRuntimeRepository,
}) {
  lock.validate(expectedRepository: expectedRepository);
  if (File(p.join(root.path, kRuntimeMetadataName)).existsSync()) {
    throw StateError(
      'vendored runtime must not contain legacy runtime-release.json',
    );
  }
  final version = verifyRuntimeTree(root);
  _assertRuntimeVersionMatchesLock(version, lock);
  final contentSha = canonicalContentSha256(root);
  if (contentSha != lock.contentSha256) {
    throw StateError('vendored runtime content SHA-256 does not match lock');
  }
  if (generatedManifest != null) {
    if (!generatedManifest.existsSync())
      throw StateError('runtime_manifest.dart is missing');
    final expected = generateLockedRuntimeManifest(lock, version);
    if (generatedManifest.readAsStringSync() != expected) {
      throw StateError(
        'runtime_manifest.dart is not reproducible from lock and runtime-version',
      );
    }
  }
}

String _manifestQuote(Object? value) => jsonEncode(value);

String _generateRuntimeManifestSource({
  required Map<String, Object?> version,
  required String? sourceCommit,
  required String? releaseTag,
  required String? archiveSha256,
  required String? contentSha256,
}) {
  String nullable(Object? value) =>
      value == null ? 'null' : _manifestQuote(value);
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
    this.contentSha256,
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
  final String? contentSha256;

  String get webEntryAssetPath => 'assets/packages/flutter_quill_editor/assets/richtext_webview_runtime/\$webEntry';
}

const RichTextRuntimeManifest kRichTextRuntimeManifest = RichTextRuntimeManifest(
  protocolVersion: ${version['protocolVersion']},
  hostEnvelopeVersion: ${version['hostEnvelopeVersion']},
  buildId: ${_manifestQuote(version['buildId'])},
  webEntry: ${_manifestQuote(version['webEntry'])},
  webEntrySha256: ${_manifestQuote(version['webEntrySha256'])},
  sourceCommit: ${nullable(sourceCommit)},
  branch: null,
  branchIdentity: null,
  releaseTag: ${nullable(releaseTag)},
  pipelineId: null,
  pipelineIid: null,
  archiveSha256: ${nullable(archiveSha256)},
  contentSha256: ${nullable(contentSha256)},
);
''';
}

String generateLockedRuntimeManifest(
  RuntimeLock lock,
  Map<String, Object?> version,
) {
  _assertRuntimeVersionMatchesLock(version, lock);
  return _generateRuntimeManifestSource(
    version: version,
    sourceCommit: lock.sourceCommit,
    releaseTag: lock.releaseTag,
    archiveSha256: lock.archiveSha256,
    contentSha256: lock.contentSha256,
  );
}

String generateLocalRuntimeManifest(
  Map<String, Object?> version, {
  String? contentSha256,
}) {
  readRuntimeVersionFromMap(version);
  if (contentSha256 != null) {
    _assertRuntimeSha256(contentSha256, 'local contentSha256');
  }
  return _generateRuntimeManifestSource(
    version: version,
    sourceCommit: version['sourceCommit']! as String,
    releaseTag: null,
    archiveSha256: null,
    contentSha256: contentSha256,
  );
}

Map<String, Object?> readRuntimeVersionFromMap(Map<String, Object?> version) {
  // Reuse the same strict field checks as the file parser without introducing
  // a second, subtly different JSON schema.
  // This helper is only used with already decoded values; perform equivalent
  // checks directly and never write the temporary path.
  _assertExactRuntimeKeys(version, <String>{
    'protocolVersion',
    'hostEnvelopeVersion',
    'buildId',
    'builtAt',
    'package',
    'sourceCommit',
    'webEntry',
    'webEntrySha256',
  }, 'runtime-version.json');
  if (version['package'] != 'webview-runtime')
    throw StateError('runtime-version.json package is invalid');
  _runtimePositiveInt(version, 'protocolVersion', 'runtime-version.json');
  _runtimePositiveInt(version, 'hostEnvelopeVersion', 'runtime-version.json');
  _runtimeString(version, 'buildId', 'runtime-version.json');
  _runtimeString(version, 'builtAt', 'runtime-version.json');
  final sourceCommit = _runtimeString(
    version,
    'sourceCommit',
    'runtime-version.json',
  );
  _assertRuntimeCommit(sourceCommit, 'runtime-version.json.sourceCommit');
  final entry = _runtimeString(version, 'webEntry', 'runtime-version.json');
  _assertRuntimeRelativePath(entry, 'runtime-version.json.webEntry');
  _assertRuntimeSha256(
    _runtimeString(version, 'webEntrySha256', 'runtime-version.json'),
    'runtime-version.json.webEntrySha256',
  );
  return version;
}

void _assertArtifactFilesRegular(Directory root) {
  if (FileSystemEntity.typeSync(root.path, followLinks: false) !=
      FileSystemEntityType.directory) {
    throw StateError('runtime artifact directory must be a real directory');
  }
  final expected = <String>{
    kRuntimeArtifactMetadataName,
    kRuntimeArchiveName,
    kRuntimeChecksumName,
  };
  final entries = root.listSync(followLinks: false);
  if (entries.length != expected.length ||
      !entries.every((entry) => expected.contains(p.basename(entry.path)))) {
    throw StateError(
      'runtime artifact directory must contain exactly three files',
    );
  }
  for (final entry in entries) {
    if (FileSystemEntity.typeSync(entry.path, followLinks: false) !=
        FileSystemEntityType.file) {
      throw StateError(
        'runtime artifact contains a symlink or non-file: ${p.basename(entry.path)}',
      );
    }
  }
}

RuntimeArtifactBundle readRuntimeArtifactBundle(Directory root) {
  _assertArtifactFilesRegular(root);
  final metadata = RuntimeArtifactMetadata.fromJson(
    jsonDecode(
      File(p.join(root.path, kRuntimeArtifactMetadataName)).readAsStringSync(),
    ),
  );
  final checksumText = File(
    p.join(root.path, kRuntimeChecksumName),
  ).readAsStringSync();
  final checksum = parseArchiveChecksum(checksumText);
  if (checksum != metadata.archiveSha256) {
    throw StateError(
      'runtime artifact checksum sidecar does not match metadata',
    );
  }
  final archive = Uint8List.fromList(
    File(p.join(root.path, kRuntimeArchiveName)).readAsBytesSync(),
  );
  final actual = sha256.convert(archive).toString();
  if (actual != metadata.archiveSha256) {
    throw StateError('runtime artifact archive does not match metadata');
  }
  return RuntimeArtifactBundle(
    metadata: metadata,
    archiveBytes: archive,
    archiveSha256: actual,
  );
}

Future<Directory> extractAndVerifyRuntimeArtifact({
  required RuntimeArtifactBundle bundle,
  required Directory destination,
}) async {
  await extractRuntimeArchive(
    bytes: bundle.archiveBytes,
    destination: destination,
  );
  if (File(p.join(destination.path, kRuntimeMetadataName)).existsSync()) {
    throw StateError(
      'runtime artifact must not contain legacy runtime-release.json',
    );
  }
  final version = verifyRuntimeTree(destination);
  _assertRuntimeVersionMatchesArtifact(version, bundle.metadata);
  final content = canonicalContentSha256(destination);
  if (content != bundle.metadata.contentSha256) {
    throw StateError('runtime archive content SHA-256 does not match metadata');
  }
  return destination;
}

class ExactRuntimeArtifact {
  const ExactRuntimeArtifact({required this.releaseTag, required this.bundle});

  final String releaseTag;
  final RuntimeArtifactBundle bundle;
}
