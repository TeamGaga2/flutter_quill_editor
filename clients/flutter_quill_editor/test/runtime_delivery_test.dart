// ignore_for_file: prefer_const_declarations, prefer_const_constructors

import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';

import 'package:archive/archive.dart';
import 'package:crypto/crypto.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;

import '../tool/runtime_delivery.dart';

String repeated(String value, int count) => List<String>.filled(count, value).join();

class _RedirectClient extends http.BaseClient {
  final requests = <http.BaseRequest>[];

  @override
  Future<http.StreamedResponse> send(http.BaseRequest request) async {
    requests.add(request);
    if (request.url.host == 'api.github.com') {
      return http.StreamedResponse(
        Stream<List<int>>.value(utf8.encode('redirect')),
        302,
        headers: const <String, String>{'location': 'https://mirror.example/releases'},
        request: request,
      );
    }
    return http.StreamedResponse(
      Stream<List<int>>.value(utf8.encode('[]')),
      200,
      request: request,
    );
  }
}

void main() {
  test('branch identity and latest release selection are deterministic', () {
    final channel = RuntimeChannelConfig.fromJson(<String, Object?>{'branch': 'dev'});
    final host = Uri.parse('https://api.github.com');
    RuntimeReleaseCandidate candidate(int iid) => RuntimeReleaseCandidate(
      tag: 'webview-runtime-channel-dev-${channel.branchIdentity.substring(0, 16)}-$iid',
      pipelineIid: iid,
      metadataUrl: Uri.parse('https://api.github.com/runtime-$iid.json'),
      archiveUrl: Uri.parse('https://api.github.com/runtime-$iid.tar.gz'),
      checksumUrl: Uri.parse('https://api.github.com/runtime-$iid.sha256'),
    );
    expect(
      selectLatestRuntimeRelease(<RuntimeReleaseCandidate>[candidate(2), candidate(7)]).pipelineIid,
      7,
    );
    expect(
      releaseCandidateFromGitHubJson(
        <String, Object?>{
          'tag_name': candidate(7).tag,
          'assets': <Object?>[
            <String, Object?>{
              'name': kRuntimeMetadataName,
              'url': candidate(7).metadataUrl.toString(),
            },
            <String, Object?>{
              'name': kRuntimeArchiveName,
              'url': candidate(7).archiveUrl.toString(),
            },
            <String, Object?>{
              'name': kRuntimeChecksumName,
              'url': candidate(7).checksumUrl.toString(),
            },
          ],
        },
        branchIdentity: channel.branchIdentity,
        expectedHost: host,
      )!.pipelineIid,
      7,
    );
    expect(
      releaseCandidateFromGitHubJson(
        <String, Object?>{'tag_name': candidate(8).tag, 'draft': true},
        branchIdentity: channel.branchIdentity,
        expectedHost: host,
      ),
      isNull,
    );
  });

  test('redirects never forward the private token across origins', () async {
    final transport = _RedirectClient();
    final client = GitHubRuntimeReleaseClient(
      apiBase: Uri.parse('https://api.github.com'),
      project: 'TeamGaga2/flutter_quill_editor',
      token: 'secret-token',
      httpClient: transport,
    );
    await expectLater(
      client.resolveLatest(const RuntimeChannelConfig(branch: 'dev')),
      throwsStateError,
    );
    expect(transport.requests[0].headers['Authorization'], 'Bearer secret-token');
    expect(transport.requests[1].headers.containsKey('Authorization'), isFalse);
  });

  test('metadata rejects an archive identity mismatch', () {
    expect(
      () => RuntimeReleaseMetadata.fromJson(<String, Object?>{
        'branch': 'dev',
        'branchIdentity': runtimeBranchIdentity('dev'),
        'sourceCommit': repeated('a', 40),
        'pipelineId': 1,
        'pipelineIid': 1,
        'releaseTag':
            'webview-runtime-channel-dev-${runtimeBranchIdentity('dev').substring(0, 16)}-1',
        'archiveName': kRuntimeArchiveName,
        'archiveSha256': 'not-a-sha',
        'protocolVersion': 1,
        'hostEnvelopeVersion': 1,
      }),
      throwsStateError,
    );
  });

  test('metadata rejects a runtime protocol newer than the client', () {
    final identity = runtimeBranchIdentity('dev');
    expect(
      () => RuntimeReleaseMetadata.fromJson(<String, Object?>{
        'branch': 'dev',
        'branchIdentity': identity,
        'sourceCommit': repeated('a', 40),
        'pipelineId': 1,
        'pipelineIid': 1,
        'releaseTag': 'webview-runtime-channel-dev-${identity.substring(0, 16)}-1',
        'archiveName': kRuntimeArchiveName,
        'archiveSha256': repeated('b', 64),
        'protocolVersion': 2,
        'hostEnvelopeVersion': 1,
      }),
      throwsStateError,
    );
  });

  test('archive path validation rejects traversal and symlinks', () {
    expect(
      () => validateArchiveEntries(<ArchiveFile>[
        ArchiveFile.bytes('../escape.js', <int>[1]),
      ]),
      throwsStateError,
    );
    expect(
      () => validateArchiveEntries(<ArchiveFile>[ArchiveFile.symlink('index.html', '../outside')]),
      throwsStateError,
    );
    expect(normalizeArchivePath('./assets/main.js'), 'assets/main.js');
  });

  test('archive limits fail closed before materialization', () {
    expect(
      () => validateArchiveEntries(
        List<ArchiveFile>.generate(
          kRuntimeMaxArchiveFiles + 1,
          (index) => ArchiveFile.noData('assets/$index.js'),
        ),
      ),
      throwsStateError,
    );
    expect(
      () => validateArchiveEntries(
        <ArchiveFile>[ArchiveFile('large.bin', kRuntimeMaxArchiveFileBytes + 1, <int>[])],
      ),
      throwsStateError,
    );
  });

  test('manifest generation preserves release provenance', () {
    final branch = 'dev';
    final metadata = RuntimeReleaseMetadata(
      branch: branch,
      branchIdentity: runtimeBranchIdentity(branch),
      sourceCommit: repeated('a', 40),
      pipelineId: 10,
      pipelineIid: 11,
      releaseTag:
          'webview-runtime-channel-dev-${runtimeBranchIdentity(branch).substring(0, 16)}-11',
      archiveName: kRuntimeArchiveName,
      archiveSha256: repeated('b', 64),
      protocolVersion: 1,
      hostEnvelopeVersion: 1,
    );
    final source = generateRuntimeManifest(metadata, <String, Object?>{
      'protocolVersion': 1,
      'hostEnvelopeVersion': 1,
      'buildId': 'build',
      'webEntry': 'iframe.abc.html',
      'webEntrySha256': repeated('c', 64),
    });
    expect(source, contains('releaseTag: "${metadata.releaseTag}"'));
    expect(source, contains('archiveSha256: "${metadata.archiveSha256}"'));
  });

  test('materialized runtime verifies the real release metadata', () async {
    final branch = 'dev';
    final identity = runtimeBranchIdentity(branch);
    final metadata = RuntimeReleaseMetadata.fromJson(<String, Object?>{
      'branch': branch,
      'branchIdentity': identity,
      'sourceCommit': repeated('a', 40),
      'pipelineId': 10,
      'pipelineIid': 11,
      'releaseTag': 'webview-runtime-channel-dev-${identity.substring(0, 16)}-11',
      'archiveName': kRuntimeArchiveName,
      'archiveSha256': repeated('b', 64),
      'protocolVersion': 1,
      'hostEnvelopeVersion': 1,
      'runtimeBuildId': 'build',
      'generatedAt': '2026-01-01T00:00:00.000Z',
    });
    final temp = await Directory.systemTemp.createTemp('tg-runtime-verify-test-');
    addTearDown(() => temp.delete(recursive: true));
    const iframe = '<script src="./assets/main.js"></script>';
    await Directory('${temp.path}/assets').create();
    await File('${temp.path}/assets/main.js').writeAsString('ok');
    await File('${temp.path}/index.html').writeAsString('<iframe src="./iframe.html"></iframe>');
    await File('${temp.path}/iframe.html').writeAsString(iframe);
    await File('${temp.path}/runtime-version.json').writeAsString(
      jsonEncode(<String, Object?>{
        'package': 'webview-runtime',
        'buildId': 'build',
        'sourceCommit': metadata.sourceCommit,
        'protocolVersion': 1,
        'hostEnvelopeVersion': 1,
        'webEntry': 'iframe.html',
        'webEntrySha256': sha256.convert(utf8.encode(iframe)).toString(),
      }),
    );
    verifyRuntimeDirectory(temp, metadata);
  });

  test('archive extraction rejects unsafe entries before writing', () async {
    final archive = Archive()..addFile(ArchiveFile.bytes('../escape', <int>[1]));
    final bytes = Uint8List.fromList(GZipEncoder().encodeBytes(TarEncoder().encode(archive)));
    final temp = await Directory.systemTemp.createTemp('tg-runtime-test-');
    addTearDown(() => temp.delete(recursive: true));
    expect(
      () => extractRuntimeArchive(bytes: bytes, destination: Directory('${temp.path}/out')),
      throwsStateError,
    );
  });

  test('checksum parser is strict and does not accept arbitrary content', () {
    expect(
      parseArchiveChecksum('${repeated('a', 64)}  webview-runtime.tar.gz\n'),
      repeated('a', 64),
    );
    expect(
      () => parseArchiveChecksum(jsonEncode(<String, String>{'token': 'secret'})),
      throwsFormatException,
    );
  });

  test('content-addressed cache revalidates bytes before a hit', () async {
    final temp = await Directory.systemTemp.createTemp('tg-runtime-cache-test-');
    addTearDown(() => temp.delete(recursive: true));
    final bytes = Uint8List.fromList(<int>[1, 2, 3]);
    final digest = sha256.convert(bytes).toString();
    final cache = RuntimeArchiveCache(temp);
    var downloads = 0;
    Future<Uint8List> download() async {
      downloads++;
      return bytes;
    }

    await cache.getOrStore(digest, download);
    await cache.getOrStore(digest, download);
    expect(downloads, 1);
    await File('${temp.path}/$digest/$kRuntimeArchiveName').writeAsBytes(<int>[9]);
    await cache.getOrStore(digest, download);
    expect(downloads, 2);
  });

  test('preparation temp directory is created beside the materialized output', () async {
    final parent = await Directory.systemTemp.createTemp('tg-runtime-parent-test-');
    addTearDown(() => parent.delete(recursive: true));
    final outputParent = Directory('${parent.path}/assets');
    await outputParent.create();
    final temporary = await createRuntimePreparationDirectory(outputParent);
    expect(temporary.parent.path, outputParent.path);
    await temporary.delete(recursive: true);
  });
}
