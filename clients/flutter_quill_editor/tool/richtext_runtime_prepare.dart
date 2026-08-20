// ignore_for_file: avoid_slow_async_io, curly_braces_in_flow_control_structures

import 'dart:convert';
import 'dart:io';

import 'package:archive/archive.dart';
import 'package:crypto/crypto.dart';

import 'runtime_delivery.dart';
import 'package:path/path.dart' as p;

Future<void> main(List<String> arguments) async {
  final appRoot = Directory.current;
  final repoRoot = appRoot;
  final output = Directory(p.join(appRoot.path, 'assets', 'richtext_webview_runtime'));
  final manifestFile = File(
    p.join(appRoot.path, 'lib', 'host', 'runtime_manifest.dart'),
  );
  final channelFile = File(
    Platform.environment['TG_RICHTEXT_RUNTIME_CHANNEL_FILE'] ??
        p.join(appRoot.path, 'richtext-runtime-channel.json'),
  );

  if (arguments.length > 2 ||
      (arguments.isNotEmpty &&
          arguments.first != '--verify' &&
          arguments.first != '--clean' &&
          arguments.first != '--local' &&
          arguments.first != '--from-dist')) {
    throw ArgumentError('supported arguments are: --verify, --clean, --local, or --from-dist [distPath]');
  }
  final argument = arguments.isEmpty ? null : arguments.first;
  if (argument == '--verify') {
    await _verifyExisting(output);
    stdout.writeln('richtext runtime output verified');
    return;
  }
  if (argument == '--clean') {
    await _cleanGenerated(output, manifestFile);
    stdout.writeln('richtext runtime generated output cleaned');
    return;
  }
  if (argument == '--local' || argument == '--from-dist') {
    final distPath = arguments.length > 1
        ? arguments[1]
        : p.normalize(p.join(appRoot.path, '..', '..', 'apps', 'webview-runtime', 'dist'));
    final distDir = Directory(distPath);
    if (!await distDir.exists()) {
      throw StateError('dist directory does not exist: $distPath. Please build webview-runtime first.');
    }
    await _prepareFromLocalDist(
      distDir: distDir,
      output: output,
      manifestFile: manifestFile,
      channelFile: channelFile,
    );
    stdout.writeln('richtext runtime prepared from local dist: $distPath');
    return;
  }

  final config = RuntimeChannelConfig.fromJson(jsonDecode(await channelFile.readAsString()));
  final api = Uri.parse(
    Platform.environment['TG_RICHTEXT_GITHUB_API_URL'] ?? 'https://api.github.com',
  );
  final project =
      Platform.environment['TG_RICHTEXT_GITHUB_REPOSITORY'] ?? 'TeamGaga2/flutter_quill_editor';
  final token = Platform.environment['TG_RICHTEXT_GITHUB_TOKEN'] ?? '';
  if (project.trim().isEmpty) throw StateError('TG_RICHTEXT_GITHUB_REPOSITORY is required');

  final client = GitHubRuntimeReleaseClient(apiBase: api, project: project, token: token);
  final resolved = await client.resolveLatest(config);
  final cache = RuntimeArchiveCache(
    Directory(p.join(repoRoot.path, '.dart_tool', 'richtext-runtime')),
  );
  final archive = await cache.getOrStore(
    resolved.archiveSha256,
    () => client.downloadArchive(resolved),
  );

  // Keep extraction beside the final assets so the final rename remains atomic
  // on macOS, Linux, and Windows even when the repository is on another volume.
  final temporaryRoot = await createRuntimePreparationDirectory(output.parent);
  try {
    final extracted = Directory(p.join(temporaryRoot.path, 'runtime'));
    await extractRuntimeArchive(bytes: archive, destination: extracted);
    verifyRuntimeDirectory(extracted, resolved.metadata);
    await File(p.join(extracted.path, kRuntimeMetadataName)).writeAsString(
      '${jsonEncode(
        <String, Object?>{
          'schemaVersion': 1,
          'branch': resolved.metadata.branch,
          'branchIdentity': resolved.metadata.branchIdentity,
          'sourceCommit': resolved.metadata.sourceCommit,
          'pipelineId': resolved.metadata.pipelineId,
          'pipelineIid': resolved.metadata.pipelineIid,
          'releaseTag': resolved.metadata.releaseTag,
          'archiveName': resolved.metadata.archiveName,
          'archiveSha256': resolved.metadata.archiveSha256,
          'protocolVersion': resolved.metadata.protocolVersion,
          'hostEnvelopeVersion': resolved.metadata.hostEnvelopeVersion,
          'runtimeBuildId': resolved.metadata.runtimeBuildId,
          'generatedAt': resolved.metadata.generatedAt,
        },
      )}\n',
      flush: true,
    );
    final version =
        jsonDecode(await File(p.join(extracted.path, 'runtime-version.json')).readAsString())
            as Map<String, Object?>;
    final manifest = generateRuntimeManifest(resolved.metadata, version);
    await atomicallyMaterializeRuntime(prepared: extracted, destination: output);
    await replaceFileAtomically(manifestFile, manifest);
  } finally {
    if (await temporaryRoot.exists()) await temporaryRoot.delete(recursive: true);
  }
  stdout.writeln(
    'prepared richtext runtime: branch=${resolved.metadata.branch} release=${resolved.metadata.releaseTag} sourceCommit=${resolved.metadata.sourceCommit} pipelineIid=${resolved.metadata.pipelineIid} archiveSha256=${resolved.metadata.archiveSha256}',
  );
}

Future<void> _verifyExisting(Directory output) async {
  final metadataFile = File(p.join(output.path, kRuntimeMetadataName));
  if (!await metadataFile.exists())
    throw StateError('runtime-release.json is missing; run prepare first');
  final metadata = RuntimeReleaseMetadata.fromJson(
    jsonDecode(await metadataFile.readAsString()),
  );
  final versionFile = File(p.join(output.path, 'runtime-version.json'));
  if (!await versionFile.exists())
    throw StateError('runtime-version.json is missing; run prepare first');
  final version = jsonDecode(await versionFile.readAsString());
  if (version is! Map<String, Object?>)
    throw const FormatException('runtime-version.json must be an object');
  verifyRuntimeDirectory(output, metadata);
}

Future<void> _cleanGenerated(Directory output, File manifestFile) async {
  if (await output.exists()) {
    for (final entity in output.listSync()) {
      if (entity is File && p.basename(entity.path) == 'README.md') continue;
      await entity.delete(recursive: true);
    }
  }
  if (await manifestFile.exists()) await manifestFile.delete();
}

String _branchSlug(String branch) {
  final slug = branch
      .toLowerCase()
      .replaceAll(RegExp(r'[^a-z0-9]+'), '-')
      .replaceAll(RegExp(r'^-+|-+$'), '');
  final trimmed = slug.length > 48 ? slug.substring(0, 48) : slug;
  if (trimmed.isEmpty) throw ArgumentError('branch cannot produce a release slug: $branch');
  return trimmed;
}

Future<void> _prepareFromLocalDist({
  required Directory distDir,
  required Directory output,
  required File manifestFile,
  required File channelFile,
}) async {
  final versionFile = File(p.join(distDir.path, 'runtime-version.json'));
  if (!await versionFile.exists()) {
    throw StateError('runtime-version.json is missing in dist directory: ${distDir.path}');
  }
  final version = jsonDecode(await versionFile.readAsString()) as Map<String, Object?>;
  final config = RuntimeChannelConfig.fromJson(jsonDecode(await channelFile.readAsString()));

  final tarArchive = Archive();
  for (final entity in distDir.listSync(recursive: true)) {
    if (entity is File) {
      final relativePath = p.relative(entity.path, from: distDir.path).replaceAll(r'\', '/');
      final bytes = await entity.readAsBytes();
      tarArchive.addFile(ArchiveFile(relativePath, bytes.length, bytes));
    }
  }
  final tarBytes = TarEncoder().encode(tarArchive);
  final tarGzBytes = GZipEncoder().encode(tarBytes);
  final archiveSha256 = sha256.convert(tarGzBytes).toString();

  final branch = config.branch;
  final branchId = config.branchIdentity;
  final sourceCommit = (version['sourceCommit'] as String? ?? '').toLowerCase();
  final releaseTag = 'webview-runtime-channel-${_branchSlug(branch)}-${branchId.substring(0, 16)}-1';

  final metadata = RuntimeReleaseMetadata(
    branch: branch,
    branchIdentity: branchId,
    sourceCommit: sourceCommit,
    pipelineId: 1,
    pipelineIid: 1,
    releaseTag: releaseTag,
    archiveName: kRuntimeArchiveName,
    archiveSha256: archiveSha256,
    protocolVersion: version['protocolVersion'] as int,
    hostEnvelopeVersion: version['hostEnvelopeVersion'] as int,
    runtimeBuildId: version['buildId'] as String?,
    generatedAt: version['builtAt'] as String?,
  );

  final temporaryRoot = await createRuntimePreparationDirectory(output.parent);
  try {
    final extracted = Directory(p.join(temporaryRoot.path, 'runtime'));
    await extracted.create(recursive: true);
    for (final entity in distDir.listSync(recursive: true)) {
      final relativePath = p.relative(entity.path, from: distDir.path);
      final destPath = p.join(extracted.path, relativePath);
      if (entity is Directory) {
        await Directory(destPath).create(recursive: true);
      } else if (entity is File) {
        await File(destPath).parent.create(recursive: true);
        await entity.copy(destPath);
      }
    }
    verifyRuntimeDirectory(extracted, metadata);
    await File(p.join(extracted.path, kRuntimeMetadataName)).writeAsString(
      '${jsonEncode(
        <String, Object?>{
          'schemaVersion': 1,
          'branch': metadata.branch,
          'branchIdentity': metadata.branchIdentity,
          'sourceCommit': metadata.sourceCommit,
          'pipelineId': metadata.pipelineId,
          'pipelineIid': metadata.pipelineIid,
          'releaseTag': metadata.releaseTag,
          'archiveName': metadata.archiveName,
          'archiveSha256': metadata.archiveSha256,
          'protocolVersion': metadata.protocolVersion,
          'hostEnvelopeVersion': metadata.hostEnvelopeVersion,
          'runtimeBuildId': metadata.runtimeBuildId,
          'generatedAt': metadata.generatedAt,
        },
      )}\n',
      flush: true,
    );
    final manifest = generateRuntimeManifest(metadata, version);
    await atomicallyMaterializeRuntime(prepared: extracted, destination: output);
    await replaceFileAtomically(manifestFile, manifest);
  } finally {
    if (await temporaryRoot.exists()) await temporaryRoot.delete(recursive: true);
  }
}

Future<void> replaceFileAtomically(File destination, String contents) async {
  final parent = destination.parent;
  await parent.create(recursive: true);
  final temporary = File(p.join(parent.path, '.${p.basename(destination.path)}.tmp-$pid'));
  final backup = File(p.join(parent.path, '.${p.basename(destination.path)}.old-$pid'));
  if (await temporary.exists()) await temporary.delete();
  if (await backup.exists()) await backup.delete();
  await temporary.writeAsString(contents, flush: true);
  if (await destination.exists()) await destination.rename(backup.path);
  try {
    await temporary.rename(destination.path);
  } catch (_) {
    if (await backup.exists() && !await destination.exists()) await backup.rename(destination.path);
    rethrow;
  }
  if (await backup.exists()) await backup.delete();
}
