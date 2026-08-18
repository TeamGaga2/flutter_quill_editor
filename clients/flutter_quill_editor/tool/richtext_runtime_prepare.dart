// ignore_for_file: avoid_slow_async_io, curly_braces_in_flow_control_structures

import 'dart:convert';
import 'dart:io';

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

  if (arguments.length > 1 ||
      (arguments.isNotEmpty && arguments.single != '--verify' && arguments.single != '--clean')) {
    throw ArgumentError('supported arguments are: --verify or --clean');
  }
  final argument = arguments.isEmpty ? null : arguments.single;
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
