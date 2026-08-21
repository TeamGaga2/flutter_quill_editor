import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';

import 'package:archive/archive.dart';
import 'package:crypto/crypto.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:flutter_quill_editor/host/iframe_host_envelope.dart';
import 'package:http/http.dart' as http;
import 'package:path/path.dart' as p;
import 'package:flutter_quill_editor/protocol/protocol_version.dart';

import '../tool/richtext_runtime_prepare.dart' as prepare;
import '../tool/runtime_delivery.dart';

void main() {
  test(
    'canonical content digest matches the shared Node/Dart golden fixture',
    () async {
      final fixtureFile = File(
        p.join(
          Directory.current.path,
          '..',
          '..',
          'scripts',
          'fixtures',
          'runtime-content-sha256.json',
        ),
      );
      final fixture =
          jsonDecode(await fixtureFile.readAsString()) as Map<String, Object?>;
      final root = await Directory.systemTemp.createTemp(
        'runtime-content-golden-',
      );
      addTearDown(() => root.delete(recursive: true));
      for (final raw in fixture['files']! as List<Object?>) {
        final file = (raw as Map<String, Object?>);
        final relative = file['path']! as String;
        final target = File(
          p.joinAll(<String>[root.path, ...relative.split('/')]),
        );
        target.parent.createSync(recursive: true);
        target.writeAsBytesSync(base64Decode(file['contentBase64']! as String));
      }
      expect(canonicalContentSha256(root), fixture['contentSha256']);
    },
  );

  test('formal lock is not fabricated before remote promotion proof', () {
    final packageRoot = Directory.current;
    expect(
      File(p.join(packageRoot.path, kRuntimeLockName)).existsSync(),
      isFalse,
    );
  });

  test('--allow-unpublished is local-only at the CLI policy boundary', () {
    expect(
      prepare.unpublishedArtifactAllowedInEnvironment(<String, String>{}),
      isTrue,
    );
    for (final key in <String>['CI', 'GITHUB_ACTIONS', 'GITHUB_RUN_ID']) {
      expect(
        prepare.unpublishedArtifactAllowedInEnvironment(<String, String>{
          key: key == 'GITHUB_RUN_ID' ? '123' : 'true',
        }),
        isFalse,
        reason: key,
      );
    }
    expect(
      prepare.unpublishedArtifactAllowedInEnvironment(<String, String>{
        'CI': 'false',
        'GITHUB_ACTIONS': '0',
      }),
      isTrue,
    );
  });

  test(
    'locked verifier validates a real tree and reproducible codegen offline',
    () async {
      final sourceCommit = 'f' * 40;
      final root = await Directory.systemTemp.createTemp(
        'runtime-locked-tree-',
      );
      addTearDown(() => root.delete(recursive: true));
      final iframe = '<script src="./assets/main.js"></script>\n';
      final files = <String, List<int>>{
        'assets/main.js': utf8.encode('console.log("locked");\n'),
        'iframe.html': utf8.encode(iframe),
        'index.html': utf8.encode('<iframe src="./iframe.html"></iframe>\n'),
        'runtime-version.json': utf8.encode(
          jsonEncode(<String, Object?>{
            'protocolVersion': kRichTextProtocolVersion,
            'hostEnvelopeVersion': kHostEnvelopeVersion,
            'buildId': 'locked-build',
            'builtAt': '2026-01-01T00:00:00.000Z',
            'package': 'webview-runtime',
            'sourceCommit': sourceCommit,
            'webEntry': 'iframe.html',
            'webEntrySha256': sha256.convert(utf8.encode(iframe)).toString(),
          }),
        ),
      };
      for (final entry in files.entries) {
        final file = File(
          p.joinAll(<String>[root.path, ...entry.key.split('/')]),
        )..parent.createSync(recursive: true);
        file.writeAsBytesSync(entry.value);
      }
      final lock = RuntimeLock(
        schemaVersion: kRuntimeLockSchemaVersion,
        repository: kDefaultRuntimeRepository,
        releaseTag: runtimeArtifactTag(sourceCommit),
        archiveName: kRuntimeArchiveName,
        archiveSha256: 'a' * 64,
        contentSha256: canonicalContentSha256(root),
        sourceCommit: sourceCommit,
        buildId: 'locked-build',
        protocolVersion: kRichTextProtocolVersion,
        hostEnvelopeVersion: kHostEnvelopeVersion,
        webEntry: 'iframe.html',
        webEntrySha256: sha256.convert(utf8.encode(iframe)).toString(),
      );
      final manifest = File(p.join(root.parent.path, 'runtime_manifest.dart'))
        ..writeAsStringSync(
          generateLockedRuntimeManifest(
            lock,
            readRuntimeVersion(File(p.join(root.path, 'runtime-version.json'))),
          ),
        );
      verifyLockedRuntimeTree(
        root: root,
        lock: lock,
        generatedManifest: manifest,
      );
    },
  );

  test(
    'artifact tag is exact source identity and rejects branch/latest forms',
    () {
      final commit = 'a' * 40;
      final tag = runtimeArtifactTag(commit);
      expect(parseRuntimeArtifactTag(tag), commit);
      expect(
        parseRuntimeArtifactTag('webview-runtime-channel-dev-abc-1'),
        isNull,
      );
      expect(
        () => RuntimeLock.fromJson(<String, Object?>{
          'schemaVersion': 1,
          'artifact': <String, Object?>{
            'repository': kDefaultRuntimeRepository,
            'releaseTag': 'webview-runtime-artifact-$commit',
            'archiveName': kRuntimeArchiveName,
            'archiveSha256': 'b' * 64,
            'contentSha256': 'c' * 64,
          },
          'runtime': <String, Object?>{
            'sourceCommit': commit,
            'buildId': 'build',
            'protocolVersion': kRichTextProtocolVersion,
            'hostEnvelopeVersion': kHostEnvelopeVersion,
            'webEntry': 'iframe.html',
            'webEntrySha256': 'd' * 64,
          },
        }),
        returnsNormally,
      );
    },
  );

  test(
    'lock repository is fixed and rejects an attacker-selected repository',
    () {
      final commit = 'b' * 40;
      final lockJson = <String, Object?>{
        'schemaVersion': 1,
        'artifact': <String, Object?>{
          'repository': 'evil.example/attacker',
          'releaseTag': runtimeArtifactTag(commit),
          'archiveName': kRuntimeArchiveName,
          'archiveSha256': 'a' * 64,
          'contentSha256': 'c' * 64,
        },
        'runtime': <String, Object?>{
          'sourceCommit': commit,
          'buildId': 'build',
          'protocolVersion': kRichTextProtocolVersion,
          'hostEnvelopeVersion': kHostEnvelopeVersion,
          'webEntry': 'iframe.html',
          'webEntrySha256': 'd' * 64,
        },
      };
      expect(() => RuntimeLock.fromJson(lockJson), throwsStateError);
      expect(
        () => RuntimeLock.fromJson(
          lockJson,
          expectedRepository: 'evil.example/attacker',
        ),
        throwsArgumentError,
      );
    },
  );

  test(
    'canonical digest rejects non-portable NFC and Hangul path names',
    () async {
      final root = await Directory.systemTemp.createTemp(
        'runtime-content-path-',
      );
      addTearDown(() => root.delete(recursive: true));
      for (final name in <String>['café.txt', '한글.txt', 'cafe\u0301.txt']) {
        final file = File(p.join(root.path, name))
          ..writeAsStringSync('non-portable');
        expect(() => canonicalContentSha256(root), throwsStateError);
        file.deleteSync();
      }
    },
  );

  test(
    'runtime verification rejects a symlink before reading runtime metadata',
    () async {
      if (Platform.isWindows) return;
      final root = await Directory.systemTemp.createTemp('runtime-scan-root-');
      final outside = await Directory.systemTemp.createTemp(
        'runtime-scan-outside-',
      );
      addTearDown(() async {
        await root.delete(recursive: true);
        await outside.delete(recursive: true);
      });
      final target = File(p.join(outside.path, 'runtime-version.json'))
        ..writeAsStringSync('not-json');
      Link(p.join(root.path, 'runtime-version.json')).createSync(target.path);
      expect(() => verifyRuntimeTree(root), throwsStateError);
    },
  );

  test('three-target materialization fails closed and can recover', () async {
    final root = await Directory.systemTemp.createTemp('runtime-atomic-');
    addTearDown(() => root.delete(recursive: true));
    final output = Directory(p.join(root.path, 'assets'));
    await output.create();
    await File(p.join(output.path, 'old.txt')).writeAsString('old');
    final manifest = File(p.join(root.path, 'runtime_manifest.dart'))
      ..writeAsStringSync('old manifest');
    final lock = File(p.join(root.path, kRuntimeLockName));
    final invalidLock = Directory(lock.path)..createSync();
    await File(p.join(invalidLock.path, 'keep')).writeAsString('keep');
    final prepared = Directory(p.join(root.path, 'prepared'))..createSync();
    await File(p.join(prepared.path, 'new.txt')).writeAsString('new');

    await expectLater(
      prepare.atomicallyMaterializeLockedRuntime(
        prepared: prepared,
        destination: output,
        manifestFile: manifest,
        manifest: 'new manifest',
        lockFile: lock,
        lock: 'new lock',
      ),
      throwsStateError,
    );
    expect(File(p.join(output.path, 'old.txt')).readAsStringSync(), 'old');
    expect(manifest.readAsStringSync(), 'old manifest');
    expect(File(p.join(invalidLock.path, 'keep')).readAsStringSync(), 'keep');

    await invalidLock.delete(recursive: true);
    await prepare.atomicallyMaterializeLockedRuntime(
      prepared: prepared,
      destination: output,
      manifestFile: manifest,
      manifest: 'new manifest',
      lockFile: lock,
      lock: 'new lock',
    );
    expect(File(p.join(output.path, 'new.txt')).readAsStringSync(), 'new');
    expect(manifest.readAsStringSync(), 'new manifest');
    expect(lock.readAsStringSync(), 'new lock');
  });

  test(
    'three-target materialization rolls back after an interrupted install',
    () async {
      final root = await Directory.systemTemp.createTemp(
        'runtime-atomic-interrupt-',
      );
      addTearDown(() => root.delete(recursive: true));
      final output = Directory(p.join(root.path, 'assets'))..createSync();
      await File(p.join(output.path, 'old.txt')).writeAsString('old');
      final manifest = File(p.join(root.path, 'runtime_manifest.dart'))
        ..writeAsStringSync('old manifest');
      final lock = File(p.join(root.path, kRuntimeLockName))
        ..writeAsStringSync('old lock');
      final prepared = Directory(p.join(root.path, 'prepared'))..createSync();
      await File(p.join(prepared.path, 'new.txt')).writeAsString('new');
      var installs = 0;

      await expectLater(
        prepare.atomicallyMaterializeLockedRuntime(
          prepared: prepared,
          destination: output,
          manifestFile: manifest,
          manifest: 'new manifest',
          lockFile: lock,
          lock: 'new lock',
          rename: (source, destination, directory) async {
            installs++;
            if (installs == 2) throw StateError('simulated interruption');
            await (directory ? Directory(source) : File(source)).rename(
              destination,
            );
          },
        ),
        throwsStateError,
      );
      expect(installs, 2);
      expect(File(p.join(output.path, 'old.txt')).readAsStringSync(), 'old');
      expect(manifest.readAsStringSync(), 'old manifest');
      expect(lock.readAsStringSync(), 'old lock');
      expect(
        root.listSync().where(
          (entity) => p.basename(entity.path).startsWith('.assets.old-'),
        ),
        isEmpty,
      );
    },
  );

  test(
    '--clean removes only atomic debris, not committed vendor files',
    () async {
      final root = await Directory.systemTemp.createTemp('runtime-clean-');
      addTearDown(() => root.delete(recursive: true));
      final output = Directory(p.join(root.path, 'assets'))..createSync();
      final committed = File(p.join(output.path, 'runtime-version.json'))
        ..writeAsStringSync('committed');
      final manifest = File(p.join(root.path, 'runtime_manifest.dart'))
        ..writeAsStringSync('manifest');
      final lock = File(p.join(root.path, kRuntimeLockName))
        ..writeAsStringSync('lock');
      Directory(p.join(root.path, '.richtext-runtime-stale')).createSync();
      Directory(p.join(root.path, '.assets.old-stale')).createSync();
      File(
        p.join(root.path, '.runtime_manifest.dart.tmp-stale'),
      ).writeAsStringSync('tmp');
      File(
        p.join(root.path, '.richtext-runtime.lock.json.tmp-stale'),
      ).writeAsStringSync('tmp');

      await prepare.cleanRuntimeGeneratedDebris(
        output: output,
        manifestFile: manifest,
      );
      expect(committed.readAsStringSync(), 'committed');
      expect(manifest.readAsStringSync(), 'manifest');
      expect(lock.readAsStringSync(), 'lock');
      expect(
        Directory(p.join(root.path, '.richtext-runtime-stale')).existsSync(),
        isFalse,
      );
      expect(
        Directory(p.join(root.path, '.assets.old-stale')).existsSync(),
        isFalse,
      );
    },
  );

  test(
    'unpublished artifact materialization never writes the formal lock',
    () async {
      final sourceCommit = 'd' * 40;
      final source = await Directory.systemTemp.createTemp(
        'runtime-unpublished-source-',
      );
      final root = await Directory.systemTemp.createTemp(
        'runtime-unpublished-output-',
      );
      addTearDown(() async {
        await source.delete(recursive: true);
        await root.delete(recursive: true);
      });
      final iframe = '<script src="./assets/main.js"></script>\n';
      final files = <String, List<int>>{
        'assets/main.js': utf8.encode('console.log("local");\n'),
        'iframe.html': utf8.encode(iframe),
        'index.html': utf8.encode('<iframe src="./iframe.html"></iframe>\n'),
        'runtime-version.json': utf8.encode(
          jsonEncode(<String, Object?>{
            'protocolVersion': kRichTextProtocolVersion,
            'hostEnvelopeVersion': kHostEnvelopeVersion,
            'buildId': sourceCommit,
            'builtAt': '2026-01-01T00:00:00.000Z',
            'package': 'webview-runtime',
            'sourceCommit': sourceCommit,
            'webEntry': 'iframe.html',
            'webEntrySha256': sha256.convert(utf8.encode(iframe)).toString(),
          }),
        ),
      };
      final archive = Archive();
      for (final entry in files.entries) {
        final file = File(
          p.joinAll(<String>[source.path, ...entry.key.split('/')]),
        )..parent.createSync(recursive: true);
        file.writeAsBytesSync(entry.value);
        archive.addFile(
          ArchiveFile(entry.key, entry.value.length, entry.value),
        );
      }
      final archiveBytes = Uint8List.fromList(
        GZipEncoder().encode(TarEncoder().encode(archive)),
      );
      final archiveSha = sha256.convert(archiveBytes).toString();
      final bundle = RuntimeArtifactBundle(
        metadata: RuntimeArtifactMetadata(
          schemaVersion: 1,
          package: 'webview-runtime',
          archiveName: kRuntimeArchiveName,
          archiveSha256: archiveSha,
          contentSha256: canonicalContentSha256(source),
          sourceCommit: sourceCommit,
          buildId: sourceCommit,
          protocolVersion: kRichTextProtocolVersion,
          hostEnvelopeVersion: kHostEnvelopeVersion,
          webEntry: 'iframe.html',
          webEntrySha256: sha256.convert(utf8.encode(iframe)).toString(),
        ),
        archiveBytes: archiveBytes,
        archiveSha256: archiveSha,
      );
      final output = Directory(p.join(root.path, 'vendor'));
      final manifest = File(p.join(root.path, 'runtime_manifest.dart'));
      final lock = File(p.join(root.path, kRuntimeLockName))
        ..writeAsStringSync('sentinel lock');
      await prepare.materializeUnpublishedRuntimeArtifact(
        bundle: bundle,
        releaseTag: runtimeArtifactTag(sourceCommit),
        output: output,
        manifestFile: manifest,
      );
      expect(lock.readAsStringSync(), 'sentinel lock');
      expect(manifest.readAsStringSync(), contains('releaseTag: null'));
      verifyRuntimeTree(output);
    },
  );

  test(
    'exact client requests one tag endpoint and validates all artifact bytes',
    () async {
      final sourceCommit = 'e' * 40;
      final releaseTag = runtimeArtifactTag(sourceCommit);
      final iframe = '<script src="./assets/main.js"></script>\n';
      final files = <String, List<int>>{
        'assets/main.js': utf8.encode('console.log("exact");\n'),
        'iframe.html': utf8.encode(iframe),
        'index.html': utf8.encode('<iframe src="./iframe.html"></iframe>\n'),
        'runtime-version.json': utf8.encode(
          jsonEncode(<String, Object?>{
            'protocolVersion': kRichTextProtocolVersion,
            'hostEnvelopeVersion': kHostEnvelopeVersion,
            'buildId': sourceCommit,
            'builtAt': '2026-01-01T00:00:00.000Z',
            'package': 'webview-runtime',
            'sourceCommit': sourceCommit,
            'webEntry': 'iframe.html',
            'webEntrySha256': sha256.convert(utf8.encode(iframe)).toString(),
          }),
        ),
      };
      final tree = await Directory.systemTemp.createTemp('runtime-exact-tree-');
      addTearDown(() => tree.delete(recursive: true));
      for (final entry in files.entries) {
        final file = File(
          p.joinAll(<String>[tree.path, ...entry.key.split('/')]),
        );
        file.parent.createSync(recursive: true);
        file.writeAsBytesSync(entry.value);
      }
      final archive = Archive();
      for (final entry in files.entries) {
        archive.addFile(
          ArchiveFile(entry.key, entry.value.length, entry.value),
        );
      }
      final archiveBytes = Uint8List.fromList(
        GZipEncoder().encode(TarEncoder().encode(archive)),
      );
      final archiveSha = sha256.convert(archiveBytes).toString();
      final contentSha = canonicalContentSha256(tree);
      final metadataBytes = utf8.encode(
        '${jsonEncode(<String, Object?>{'schemaVersion': 1, 'package': 'webview-runtime', 'archiveName': kRuntimeArchiveName, 'archiveSha256': archiveSha, 'contentSha256': contentSha, 'sourceCommit': sourceCommit, 'buildId': sourceCommit, 'protocolVersion': kRichTextProtocolVersion, 'hostEnvelopeVersion': kHostEnvelopeVersion, 'webEntry': 'iframe.html', 'webEntrySha256': sha256.convert(utf8.encode(iframe)).toString()})}\n',
      );
      final checksumBytes = utf8.encode('$archiveSha  $kRuntimeArchiveName\n');
      final transport = _ExactArtifactClient(
        releaseTag: releaseTag,
        metadata: metadataBytes,
        archive: archiveBytes,
        checksum: checksumBytes,
      );
      final client = GitHubRuntimeReleaseClient(
        apiBase: Uri.parse('https://api.test'),
        project: 'acme/editor',
        token: 'secret-token',
        httpClient: transport,
      );
      final result = await client.fetchExactArtifact(releaseTag);
      expect(result.releaseTag, releaseTag);
      expect(result.bundle.archiveSha256, archiveSha);
      expect(
        transport.requests.first.url.path,
        '/repos/acme/editor/releases/tags/$releaseTag',
      );
      expect(
        transport.requests.any((request) => request.url.path == '/releases'),
        isFalse,
      );
      for (final request in transport.requests) {
        expect(request.headers['authorization'], 'Bearer secret-token');
      }
    },
  );

  test('exact update verifies an annotated tag final commit', () async {
    final sourceCommit = 'c' * 40;
    final releaseTag = runtimeArtifactTag(sourceCommit);
    final iframe = '<script src="./assets/main.js"></script>\n';
    final files = <String, List<int>>{
      'assets/main.js': utf8.encode('console.log("annotated");\n'),
      'iframe.html': utf8.encode(iframe),
      'index.html': utf8.encode('<iframe src="./iframe.html"></iframe>\n'),
      'runtime-version.json': utf8.encode(
        jsonEncode(<String, Object?>{
          'protocolVersion': kRichTextProtocolVersion,
          'hostEnvelopeVersion': kHostEnvelopeVersion,
          'buildId': sourceCommit,
          'builtAt': '2026-01-01T00:00:00.000Z',
          'package': 'webview-runtime',
          'sourceCommit': sourceCommit,
          'webEntry': 'iframe.html',
          'webEntrySha256': sha256.convert(utf8.encode(iframe)).toString(),
        }),
      ),
    };
    final tree = await Directory.systemTemp.createTemp(
      'runtime-annotated-tree-',
    );
    addTearDown(() => tree.delete(recursive: true));
    final archive = Archive();
    for (final entry in files.entries) {
      final file = File(
        p.joinAll(<String>[tree.path, ...entry.key.split('/')]),
      );
      file.parent.createSync(recursive: true);
      file.writeAsBytesSync(entry.value);
      archive.addFile(ArchiveFile(entry.key, entry.value.length, entry.value));
    }
    final archiveBytes = Uint8List.fromList(
      GZipEncoder().encode(TarEncoder().encode(archive)),
    );
    final archiveSha = sha256.convert(archiveBytes).toString();
    final transport = _ExactArtifactClient(
      releaseTag: releaseTag,
      metadata: utf8.encode(
        jsonEncode(<String, Object?>{
          'schemaVersion': 1,
          'package': 'webview-runtime',
          'archiveName': kRuntimeArchiveName,
          'archiveSha256': archiveSha,
          'contentSha256': canonicalContentSha256(tree),
          'sourceCommit': sourceCommit,
          'buildId': sourceCommit,
          'protocolVersion': kRichTextProtocolVersion,
          'hostEnvelopeVersion': kHostEnvelopeVersion,
          'webEntry': 'iframe.html',
          'webEntrySha256': sha256.convert(utf8.encode(iframe)).toString(),
        }),
      ),
      archive: archiveBytes,
      checksum: utf8.encode('$archiveSha  $kRuntimeArchiveName\n'),
      annotatedTag: true,
      sourceCommit: sourceCommit,
    );
    final result = await GitHubRuntimeReleaseClient(
      apiBase: Uri.parse('https://api.test'),
      project: 'acme/editor',
      token: 'secret-token',
      httpClient: transport,
    ).fetchExactArtifact(releaseTag);
    expect(result.releaseTag, releaseTag);
    expect(
      transport.requests.any(
        (request) =>
            request.url.path == '/repos/acme/editor/git/tags/${'a' * 40}',
      ),
      isTrue,
    );
  });
}

class _ExactArtifactClient extends http.BaseClient {
  _ExactArtifactClient({
    required this.releaseTag,
    required this.metadata,
    required this.archive,
    required this.checksum,
    this.annotatedTag = false,
    this.sourceCommit,
  });

  final String releaseTag;
  final List<int> metadata;
  final Uint8List archive;
  final List<int> checksum;
  final bool annotatedTag;
  final String? sourceCommit;
  final requests = <http.BaseRequest>[];

  @override
  Future<http.StreamedResponse> send(http.BaseRequest request) async {
    requests.add(request);
    final path = request.url.path;
    if (path == '/repos/acme/editor/releases/tags/$releaseTag') {
      return _response(
        request,
        jsonEncode(<String, Object?>{
          'tag_name': releaseTag,
          'draft': false,
          'prerelease': false,
          'assets': <Object?>[
            _asset(kRuntimeArtifactMetadataName),
            _asset(kRuntimeArchiveName),
            _asset(kRuntimeChecksumName),
          ],
        }),
      );
    }
    if (path == '/repos/acme/editor/git/ref/tags/$releaseTag') {
      final object = annotatedTag
          ? <String, Object?>{'type': 'tag', 'sha': 'a' * 40}
          : <String, Object?>{
              'type': 'commit',
              'sha': releaseTag.substring(kRuntimeArtifactTagPrefix.length),
            };
      return _response(
        request,
        jsonEncode(<String, Object?>{
          'ref': 'refs/tags/$releaseTag',
          'object': object,
        }),
      );
    }
    if (path == '/repos/acme/editor/git/tags/${'a' * 40}') {
      return _response(
        request,
        jsonEncode(<String, Object?>{
          'object': <String, Object?>{'type': 'commit', 'sha': sourceCommit},
        }),
      );
    }
    if (path.endsWith('/$kRuntimeArtifactMetadataName')) {
      return _response(request, metadata);
    }
    if (path.endsWith('/$kRuntimeArchiveName')) {
      return _response(request, archive);
    }
    if (path.endsWith('/$kRuntimeChecksumName')) {
      return _response(request, checksum);
    }
    return _response(request, 'not found', status: 404);
  }

  Map<String, Object?> _asset(String name) => <String, Object?>{
    'name': name,
    'url': 'https://api.test/repos/acme/editor/releases/assets/$name',
  };

  http.StreamedResponse _response(
    http.BaseRequest request,
    Object body, {
    int status = 200,
  }) {
    final bytes = body is List<int>
        ? body
        : utf8.encode(body is String ? body : jsonEncode(body));
    return http.StreamedResponse(
      Stream<List<int>>.value(bytes),
      status,
      request: request,
    );
  }
}
