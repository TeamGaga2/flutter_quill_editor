// ignore_for_file: avoid_slow_async_io, curly_braces_in_flow_control_structures

import 'dart:convert';
import 'dart:io';

import 'package:archive/archive.dart';
import 'package:crypto/crypto.dart';

import 'runtime_delivery.dart';
import 'package:path/path.dart' as p;

Directory _findPackageRoot() {
  final current = Directory.current;
  if (File(p.join(current.path, kRuntimeLockName)).existsSync() ||
      File(
        p.join(current.path, 'richtext-runtime-channel.json'),
      ).existsSync()) {
    return current;
  }
  final subPackage = Directory(
    p.join(current.path, 'clients', 'flutter_quill_editor'),
  );
  if (File(p.join(subPackage.path, kRuntimeLockName)).existsSync() ||
      File(
        p.join(subPackage.path, 'richtext-runtime-channel.json'),
      ).existsSync()) {
    return subPackage;
  }
  if (Platform.script.scheme == 'file') {
    final scriptFile = File.fromUri(Platform.script);
    final scriptDir = scriptFile.parent;
    final parent = scriptDir.parent;
    if (File(p.join(parent.path, kRuntimeLockName)).existsSync() ||
        File(
          p.join(parent.path, 'richtext-runtime-channel.json'),
        ).existsSync()) {
      return parent;
    }
  }
  return current;
}

Directory _findRepoRoot(Directory packageRoot) {
  var dir = packageRoot;
  while (dir.path != dir.parent.path) {
    if (File(p.join(dir.path, 'pnpm-workspace.yaml')).existsSync() ||
        Directory(p.join(dir.path, 'apps', 'webview-runtime')).existsSync()) {
      return dir;
    }
    dir = dir.parent;
  }
  final current = Directory.current;
  if (File(p.join(current.path, 'pnpm-workspace.yaml')).existsSync() ||
      Directory(p.join(current.path, 'apps', 'webview-runtime')).existsSync()) {
    return current;
  }
  return Directory(p.normalize(p.join(packageRoot.path, '..', '..')));
}

/// `--allow-unpublished` is a local migration/test escape hatch only. Keep
/// this policy as a pure helper so the CLI boundary can be tested without
/// mutating the process environment.
bool unpublishedArtifactAllowedInEnvironment(Map<String, String> environment) {
  bool enabled(String? value) {
    final normalized = value?.trim().toLowerCase();
    return normalized != null &&
        normalized.isNotEmpty &&
        normalized != '0' &&
        normalized != 'false';
  }

  return !enabled(environment['CI']) &&
      !enabled(environment['GITHUB_ACTIONS']) &&
      !environment.containsKey('GITHUB_RUN_ID');
}

Future<void> main(List<String> arguments) async {
  final appRoot = _findPackageRoot();
  final repoRoot = _findRepoRoot(appRoot);
  final output = Directory(
    p.join(appRoot.path, 'assets', 'richtext_webview_runtime'),
  );
  final manifestFile = File(
    p.join(appRoot.path, 'lib', 'host', 'runtime_manifest.dart'),
  );
  final lockFile = File(p.join(appRoot.path, kRuntimeLockName));
  // Lock schema v1 is bound to the canonical repository. Environment
  // configuration may select only the API base and token; it must not change
  // which repository a formal lock is allowed to name.
  const repository = kDefaultRuntimeRepository;

  if (arguments.isEmpty || arguments.first == '--verify') {
    if (arguments.length > 1)
      throw ArgumentError('--verify does not accept arguments');
    await _verifyLocked(
      output: output,
      manifestFile: manifestFile,
      lockFile: lockFile,
      repository: repository,
    );
    stdout.writeln('richtext runtime locked output verified (offline)');
    return;
  }
  if (arguments.first == '--clean') {
    if (arguments.length != 1)
      throw ArgumentError('--clean does not accept arguments');
    await cleanRuntimeGeneratedDebris(
      output: output,
      manifestFile: manifestFile,
      lockFile: lockFile,
    );
    stdout.writeln('richtext runtime generated output cleaned');
    return;
  }
  if (arguments.first == '--local' || arguments.first == '--from-dist') {
    if (arguments.length > 2)
      throw ArgumentError('--local accepts at most one dist path');
    final distPath = arguments.length == 2
        ? arguments[1]
        : p.normalize(p.join(repoRoot.path, 'apps', 'webview-runtime', 'dist'));
    await _prepareFromLocalRuntime(
      distDir: Directory(distPath),
      output: output,
      manifestFile: manifestFile,
    );
    stdout.writeln(
      'local runtime materialized from $distPath (ephemeral; no lock or Release provenance was read or written; do not publish)',
    );
    return;
  }
  if (arguments.first == '--update') {
    if (arguments.length != 3 || arguments[1] != '--release-tag') {
      throw ArgumentError(
        'supported arguments: --update --release-tag <exactTag>',
      );
    }
    final releaseTag = arguments[2];
    final api = Uri.parse(
      Platform.environment['TG_RICHTEXT_GITHUB_API_URL'] ??
          'https://api.github.com',
    );
    final token = Platform.environment['TG_RICHTEXT_GITHUB_TOKEN'] ?? '';
    final client = GitHubRuntimeReleaseClient(
      apiBase: api,
      project: repository,
      token: token,
    );
    final exact = await client.fetchExactArtifact(releaseTag);
    await _materializeFormalArtifact(
      bundle: exact.bundle,
      releaseTag: releaseTag,
      repository: repository,
      output: output,
      manifestFile: manifestFile,
      lockFile: lockFile,
    );
    stdout.writeln(
      'runtime updated from exact release $releaseTag (sourceCommit=${exact.bundle.metadata.sourceCommit}, contentSha256=${exact.bundle.metadata.contentSha256})',
    );
    return;
  }
  if (arguments.first == '--from-artifact') {
    if (arguments.length != 5 ||
        arguments[2] != '--release-tag' ||
        arguments[4] != '--allow-unpublished') {
      throw ArgumentError(
        'supported arguments: --from-artifact <artifactDirectory> --release-tag <exactTag> '
        '--allow-unpublished (local migration/test only)',
      );
    }
    if (!unpublishedArtifactAllowedInEnvironment(Platform.environment)) {
      throw StateError('--allow-unpublished is forbidden in CI/GitHub Actions');
    }
    final artifactDir = Directory(arguments[1]);
    final releaseTag = arguments[3];
    final bundle = readRuntimeArtifactBundle(artifactDir);
    await materializeUnpublishedRuntimeArtifact(
      bundle: bundle,
      releaseTag: releaseTag,
      output: output,
      manifestFile: manifestFile,
    );
    stdout.writeln(
      'runtime updated from controlled unpublished artifact $releaseTag '
      '(sourceCommit=${bundle.metadata.sourceCommit}, contentSha256=${bundle.metadata.contentSha256}); '
      'this is local migration/test evidence only and is not proof of a promoted Release',
    );
    return;
  }
  if (arguments.first == '--legacy') {
    await _legacyMain(
      arguments.sublist(1),
      repoRoot: repoRoot,
      output: output,
      manifestFile: manifestFile,
      appRoot: appRoot,
    );
    return;
  }
  throw ArgumentError(
    'supported arguments are: --verify, --local [distPath], --update --release-tag <exactTag>, '
    '--from-artifact <dir> --release-tag <exactTag> --allow-unpublished (local only), '
    '--clean, or explicit --legacy',
  );
}

Future<void> _verifyLocked({
  required Directory output,
  required File manifestFile,
  required File lockFile,
  required String repository,
}) async {
  if (!await lockFile.exists()) {
    throw StateError(
      '$kRuntimeLockName is missing; locked verify never resolves a legacy channel',
    );
  }
  final lock = RuntimeLock.fromJson(
    jsonDecode(await lockFile.readAsString()),
    expectedRepository: repository,
  );
  verifyLockedRuntimeTree(
    root: output,
    lock: lock,
    generatedManifest: manifestFile,
    expectedRepository: repository,
  );
}

Future<void> _prepareFromLocalRuntime({
  required Directory distDir,
  required Directory output,
  required File manifestFile,
}) async {
  if (!await distDir.exists()) {
    throw StateError(
      'dist directory does not exist: ${distDir.path}. Please build webview-runtime first.',
    );
  }
  final version = verifyRuntimeTree(distDir);
  final temporaryRoot = await _createPreparationParent(output);
  try {
    final prepared = Directory(p.join(temporaryRoot.path, 'runtime'));
    await _copyRuntimeDirectory(distDir, prepared);
    final copiedVersion = verifyRuntimeTree(prepared);
    final manifest = generateLocalRuntimeManifest(
      copiedVersion,
      contentSha256: canonicalContentSha256(prepared),
    );
    await atomicallyMaterializeLockedRuntime(
      prepared: prepared,
      destination: output,
      manifestFile: manifestFile,
      manifest: manifest,
    );
  } finally {
    if (await temporaryRoot.exists())
      await temporaryRoot.delete(recursive: true);
  }
  // `version` is intentionally evaluated before any write: local validation
  // must fail closed without touching tracked assets or the formal lock.
  if (version['sourceCommit'] is! String)
    throw StateError('local runtime sourceCommit is invalid');
}

Future<Directory> _createPreparationParent(Directory output) async {
  await output.parent.create(recursive: true);
  return createRuntimePreparationDirectory(output.parent);
}

Future<void> _copyRuntimeDirectory(
  Directory source,
  Directory destination,
) async {
  final sourceType = FileSystemEntity.typeSync(source.path, followLinks: false);
  if (sourceType != FileSystemEntityType.directory)
    throw StateError('runtime source must be a real directory');
  await destination.create(recursive: true);
  for (final entity in source.listSync(followLinks: false)) {
    final type = FileSystemEntity.typeSync(entity.path, followLinks: false);
    final target = p.join(destination.path, p.basename(entity.path));
    if (type == FileSystemEntityType.link)
      throw StateError('runtime source must not contain symlinks');
    if (type == FileSystemEntityType.directory) {
      await _copyRuntimeDirectory(Directory(entity.path), Directory(target));
    } else if (type == FileSystemEntityType.file) {
      await File(entity.path).copy(target);
    } else {
      throw StateError(
        'runtime source contains an unsupported filesystem entry',
      );
    }
  }
}

class _AtomicMaterializationTarget {
  _AtomicMaterializationTarget({
    required this.destination,
    required this.staged,
    required this.backup,
    required this.isDirectory,
  });

  final String destination;
  final String staged;
  final String backup;
  final bool isDirectory;
  bool hadOriginal = false;
  bool installed = false;
}

/// Commit the vendored tree and its generated identity files as one
/// filesystem transaction. Every target is staged beside its destination;
/// if any rename fails, already-installed targets are removed and originals
/// are restored before the failure is reported.
Future<void> atomicallyMaterializeLockedRuntime({
  required Directory prepared,
  required Directory destination,
  required File manifestFile,
  required String manifest,
  File? lockFile,
  String? lock,
  Future<void> Function(String source, String destination, bool directory)?
  rename,
}) async {
  if ((lockFile == null) != (lock == null)) {
    throw ArgumentError('lockFile and lock must be provided together');
  }
  final installRename = rename ?? _atomicRename;
  final destinations = <String>{
    p.normalize(destination.path),
    p.normalize(manifestFile.path),
    if (lockFile != null) p.normalize(lockFile.path),
  };
  if (destinations.length != (lockFile == null ? 2 : 3)) {
    throw ArgumentError('atomic materialization targets must be distinct');
  }

  final transaction = '$pid-${DateTime.now().microsecondsSinceEpoch}';
  final targets = <_AtomicMaterializationTarget>[
    _AtomicMaterializationTarget(
      destination: destination.path,
      staged: prepared.path,
      backup: p.join(
        destination.parent.path,
        '.${p.basename(destination.path)}.old-$transaction',
      ),
      isDirectory: true,
    ),
  ];
  final stagedManifest = File(
    p.join(
      manifestFile.parent.path,
      '.${p.basename(manifestFile.path)}.tmp-$transaction',
    ),
  );
  targets.add(
    _AtomicMaterializationTarget(
      destination: manifestFile.path,
      staged: stagedManifest.path,
      backup: p.join(
        manifestFile.parent.path,
        '.${p.basename(manifestFile.path)}.old-$transaction',
      ),
      isDirectory: false,
    ),
  );
  File? stagedLock;
  if (lockFile != null) {
    stagedLock = File(
      p.join(
        lockFile.parent.path,
        '.${p.basename(lockFile.path)}.tmp-$transaction',
      ),
    );
    targets.add(
      _AtomicMaterializationTarget(
        destination: lockFile.path,
        staged: stagedLock.path,
        backup: p.join(
          lockFile.parent.path,
          '.${p.basename(lockFile.path)}.old-$transaction',
        ),
        isDirectory: false,
      ),
    );
  }

  for (final target in targets) {
    await Directory(p.dirname(target.destination)).create(recursive: true);
    _assertAtomicTargetReady(target);
  }
  try {
    await stagedManifest.writeAsString(manifest, flush: true);
    if (stagedLock != null) await stagedLock.writeAsString(lock!, flush: true);
    _assertAtomicStagedTargetReady(targets[0]);
    _assertAtomicStagedTargetReady(targets[1]);
    if (targets.length == 3) _assertAtomicStagedTargetReady(targets[2]);

    for (final target in targets) {
      if (_atomicExists(target.destination)) {
        await _atomicRename(
          target.destination,
          target.backup,
          target.isDirectory,
        );
        target.hadOriginal = true;
      }
    }
    for (final target in targets) {
      await installRename(
        target.staged,
        target.destination,
        target.isDirectory,
      );
      target.installed = true;
    }
  } catch (error) {
    Object? rollbackError;
    try {
      for (final target in targets.reversed) {
        if (target.installed && _atomicExists(target.destination)) {
          await _atomicDelete(target.destination, target.isDirectory);
        }
      }
      for (final target in targets.reversed) {
        if (target.hadOriginal &&
            _atomicExists(target.backup) &&
            !_atomicExists(target.destination)) {
          await _atomicRename(
            target.backup,
            target.destination,
            target.isDirectory,
          );
        }
      }
    } catch (rollback) {
      rollbackError = rollback;
    }
    if (rollbackError != null) {
      throw StateError(
        'atomic runtime materialization failed and rollback failed: '
        '$error; rollback: $rollbackError',
      );
    }
    rethrow;
  } finally {
    for (final target in targets) {
      if (_atomicExists(target.staged)) {
        await _atomicDelete(target.staged, target.isDirectory);
      }
    }
  }

  // Old targets are no longer needed once all three new targets are live. If
  // cleanup itself is interrupted, --clean can remove only these debris paths
  // without touching the committed vendor, lock, or manifest.
  for (final target in targets) {
    if (_atomicExists(target.backup)) {
      try {
        await _atomicDelete(target.backup, target.isDirectory);
      } catch (_) {
        // Leave recoverable debris for the explicit cleanup command.
      }
    }
  }
}

void _assertAtomicTargetReady(_AtomicMaterializationTarget target) {
  final destinationType = FileSystemEntity.typeSync(
    target.destination,
    followLinks: false,
  );
  final expected = target.isDirectory
      ? FileSystemEntityType.directory
      : FileSystemEntityType.file;
  if (destinationType != FileSystemEntityType.notFound &&
      destinationType != expected) {
    throw StateError(
      'atomic runtime target must be a real ${target.isDirectory ? 'directory' : 'file'}: '
      '${target.destination}',
    );
  }
  if (_atomicExists(target.backup)) {
    throw StateError(
      'atomic runtime backup already exists: ${target.backup}; run --clean',
    );
  }
}

void _assertAtomicStagedTargetReady(_AtomicMaterializationTarget target) {
  final type = FileSystemEntity.typeSync(target.staged, followLinks: false);
  final expected = target.isDirectory
      ? FileSystemEntityType.directory
      : FileSystemEntityType.file;
  if (type != expected) {
    throw StateError(
      'atomic runtime staged target is missing: ${target.staged}',
    );
  }
}

bool _atomicExists(String path) =>
    FileSystemEntity.typeSync(path, followLinks: false) !=
    FileSystemEntityType.notFound;

Future<void> _atomicRename(String source, String destination, bool directory) {
  final entity = directory ? Directory(source) : File(source);
  return entity.rename(destination);
}

Future<void> _atomicDelete(String path, bool directory) {
  final entity = directory ? Directory(path) : File(path);
  return entity.delete(recursive: directory);
}

Future<void> _materializeFormalArtifact({
  required RuntimeArtifactBundle bundle,
  required String releaseTag,
  required String repository,
  required Directory output,
  required File manifestFile,
  required File lockFile,
}) async {
  final lock = RuntimeLock.fromArtifact(
    bundle.metadata,
    repository: repository,
    releaseTag: releaseTag,
  );
  final temporaryRoot = await _createPreparationParent(output);
  try {
    final prepared = Directory(p.join(temporaryRoot.path, 'runtime'));
    await extractAndVerifyRuntimeArtifact(
      bundle: bundle,
      destination: prepared,
    );
    final version = readRuntimeVersion(
      File(p.join(prepared.path, 'runtime-version.json')),
    );
    final manifest = generateLockedRuntimeManifest(lock, version);
    // Every validation happens before the first tracked path is changed.
    await atomicallyMaterializeLockedRuntime(
      prepared: prepared,
      destination: output,
      manifestFile: manifestFile,
      manifest: manifest,
      lockFile: lockFile,
      lock: lock.toJsonString(),
    );
    verifyLockedRuntimeTree(
      root: output,
      lock: lock,
      generatedManifest: manifestFile,
      expectedRepository: repository,
    );
  } finally {
    if (await temporaryRoot.exists())
      await temporaryRoot.delete(recursive: true);
  }
}

/// Materialize a locally controlled artifact without claiming remote
/// promotion. This is intentionally separate from `_materializeFormalArtifact`:
/// it never receives a lock file and therefore cannot create or replace the
/// package's formal artifact selector.
Future<void> materializeUnpublishedRuntimeArtifact({
  required RuntimeArtifactBundle bundle,
  required String releaseTag,
  required Directory output,
  required File manifestFile,
}) async {
  if (releaseTag != runtimeArtifactTag(bundle.metadata.sourceCommit)) {
    throw StateError(
      '--from-artifact release tag does not match artifact sourceCommit',
    );
  }
  final temporaryRoot = await _createPreparationParent(output);
  try {
    final prepared = Directory(p.join(temporaryRoot.path, 'runtime'));
    await extractAndVerifyRuntimeArtifact(
      bundle: bundle,
      destination: prepared,
    );
    final version = readRuntimeVersion(
      File(p.join(prepared.path, 'runtime-version.json')),
    );
    final manifest = generateLocalRuntimeManifest(
      version,
      contentSha256: bundle.metadata.contentSha256,
    );
    // An unpublished artifact is useful for local migration and tests, but it
    // has no remote provenance.  Materialize only the ephemeral vendor and
    // local manifest; a formal lock may be written solely by --update after
    // fetchExactArtifact has proved the promoted Release bytes.
    await atomicallyMaterializeLockedRuntime(
      prepared: prepared,
      destination: output,
      manifestFile: manifestFile,
      manifest: manifest,
    );
    verifyRuntimeTree(output);
  } finally {
    if (await temporaryRoot.exists()) {
      await temporaryRoot.delete(recursive: true);
    }
  }
}

Future<void> _legacyMain(
  List<String> arguments, {
  required Directory repoRoot,
  required Directory output,
  required File manifestFile,
  required Directory appRoot,
}) async {
  final channelFile = File(
    Platform.environment['TG_RICHTEXT_RUNTIME_CHANNEL_FILE'] ??
        p.join(appRoot.path, 'richtext-runtime-channel.json'),
  );
  if (arguments.isNotEmpty && arguments.first == '--from-dist') {
    if (arguments.length > 2)
      throw ArgumentError('--legacy --from-dist [distPath]');
    final distPath = arguments.length == 2
        ? arguments[1]
        : p.normalize(p.join(repoRoot.path, 'apps', 'webview-runtime', 'dist'));
    await _prepareFromLocalDist(
      distDir: Directory(distPath),
      output: output,
      manifestFile: manifestFile,
      channelFile: channelFile,
    );
    stdout.writeln('legacy runtime prepared from local dist: $distPath');
    return;
  }
  if (arguments.isNotEmpty)
    throw ArgumentError(
      'supported legacy argument: --legacy [--from-dist <path>]',
    );
  final config = RuntimeChannelConfig.fromJson(
    jsonDecode(await channelFile.readAsString()),
  );
  final api = Uri.parse(
    Platform.environment['TG_RICHTEXT_GITHUB_API_URL'] ??
        'https://api.github.com',
  );
  const project = kDefaultRuntimeRepository;
  final token = Platform.environment['TG_RICHTEXT_GITHUB_TOKEN'] ?? '';
  final client = GitHubRuntimeReleaseClient(
    apiBase: api,
    project: project,
    token: token,
  );
  final resolved = await client.resolveLatest(config);
  final cache = RuntimeArchiveCache(
    Directory(p.join(repoRoot.path, '.dart_tool', 'richtext-runtime')),
  );
  final archive = await cache.getOrStore(
    resolved.archiveSha256,
    () => client.downloadArchive(resolved),
  );
  final temporaryRoot = await _createPreparationParent(output);
  try {
    final extracted = Directory(p.join(temporaryRoot.path, 'runtime'));
    await extractRuntimeArchive(bytes: archive, destination: extracted);
    verifyRuntimeDirectory(extracted, resolved.metadata);
    final version = readRuntimeVersion(
      File(p.join(extracted.path, 'runtime-version.json')),
    );
    final manifest = generateRuntimeManifest(resolved.metadata, version);
    await atomicallyMaterializeRuntime(
      prepared: extracted,
      destination: output,
    );
    await replaceFileAtomically(manifestFile, manifest);
  } finally {
    if (await temporaryRoot.exists())
      await temporaryRoot.delete(recursive: true);
  }
  stdout.writeln(
    'legacy latest runtime prepared: ${resolved.metadata.releaseTag}',
  );
}

Future<void> cleanRuntimeGeneratedDebris({
  required Directory output,
  required File manifestFile,
  File? lockFile,
}) async {
  // The runtime tree, lock, and generated manifest are committed inputs. A
  // maintenance cleanup may remove only abandoned atomic-operation debris;
  // it must never delete or rewrite the committed vendor by default.
  final parents = <String>{
    output.parent.path,
    manifestFile.parent.path,
    if (lockFile != null) lockFile.parent.path,
  };
  for (final parentPath in parents) {
    final parent = Directory(parentPath);
    if (!await parent.exists()) continue;
    for (final entity in parent.listSync(followLinks: false)) {
      final name = p.basename(entity.path);
      final isRuntimeTemp =
          parentPath == output.parent.path &&
          (name.startsWith('.richtext-runtime-') ||
              name.startsWith('.${p.basename(output.path)}.old-'));
      final isManifestTemp =
          parentPath == manifestFile.parent.path &&
          name.startsWith('.${p.basename(manifestFile.path)}.');
      final isLockTemp =
          lockFile != null &&
          parentPath == lockFile.parent.path &&
          name.startsWith('.${p.basename(lockFile.path)}.');
      if (isRuntimeTemp || isManifestTemp || isLockTemp) {
        await entity.delete(recursive: true);
      }
    }
  }
}

String _branchSlug(String branch) {
  final slug = branch
      .toLowerCase()
      .replaceAll(RegExp(r'[^a-z0-9]+'), '-')
      .replaceAll(RegExp(r'^-+|-+$'), '');
  final trimmed = slug.length > 48 ? slug.substring(0, 48) : slug;
  if (trimmed.isEmpty)
    throw ArgumentError('branch cannot produce a release slug: $branch');
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
    throw StateError(
      'runtime-version.json is missing in dist directory: ${distDir.path}',
    );
  }
  final version =
      jsonDecode(await versionFile.readAsString()) as Map<String, Object?>;
  final config = RuntimeChannelConfig.fromJson(
    jsonDecode(await channelFile.readAsString()),
  );

  final tarArchive = Archive();
  for (final entity in distDir.listSync(recursive: true)) {
    if (entity is File) {
      final relativePath = p
          .relative(entity.path, from: distDir.path)
          .replaceAll(r'\', '/');
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
  final releaseTag =
      'webview-runtime-channel-${_branchSlug(branch)}-${branchId.substring(0, 16)}-1';

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
      '${jsonEncode(<String, Object?>{'schemaVersion': 1, 'branch': metadata.branch, 'branchIdentity': metadata.branchIdentity, 'sourceCommit': metadata.sourceCommit, 'pipelineId': metadata.pipelineId, 'pipelineIid': metadata.pipelineIid, 'releaseTag': metadata.releaseTag, 'archiveName': metadata.archiveName, 'archiveSha256': metadata.archiveSha256, 'protocolVersion': metadata.protocolVersion, 'hostEnvelopeVersion': metadata.hostEnvelopeVersion, 'runtimeBuildId': metadata.runtimeBuildId, 'generatedAt': metadata.generatedAt})}\n',
      flush: true,
    );
    final manifest = generateRuntimeManifest(metadata, version);
    await atomicallyMaterializeRuntime(
      prepared: extracted,
      destination: output,
    );
    await replaceFileAtomically(manifestFile, manifest);
  } finally {
    if (await temporaryRoot.exists())
      await temporaryRoot.delete(recursive: true);
  }
}

Future<void> replaceFileAtomically(File destination, String contents) async {
  final parent = destination.parent;
  await parent.create(recursive: true);
  final temporary = File(
    p.join(parent.path, '.${p.basename(destination.path)}.tmp-$pid'),
  );
  final backup = File(
    p.join(parent.path, '.${p.basename(destination.path)}.old-$pid'),
  );
  if (await temporary.exists()) await temporary.delete();
  if (await backup.exists()) await backup.delete();
  await temporary.writeAsString(contents, flush: true);
  if (await destination.exists()) await destination.rename(backup.path);
  try {
    await temporary.rename(destination.path);
  } catch (_) {
    if (await backup.exists() && !await destination.exists())
      await backup.rename(destination.path);
    rethrow;
  }
  if (await backup.exists()) await backup.delete();
}
