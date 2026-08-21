import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';

import 'package:archive/archive.dart';
import 'package:crypto/crypto.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;

import '../tool/runtime_delivery.dart';

String repeated(String value, int count) =>
    List<String>.filled(count, value).join();

class _RedirectClient extends http.BaseClient {
  final requests = <http.BaseRequest>[];

  @override
  Future<http.StreamedResponse> send(http.BaseRequest request) async {
    requests.add(request);
    return http.StreamedResponse(
      Stream<List<int>>.value(utf8.encode('redirect')),
      302,
      headers: const <String, String>{
        'location': 'https://mirror.example/releases',
      },
      request: request,
    );
  }
}

void main() {
  test(
    'exact artifact requests never forward a token across origins',
    () async {
      final transport = _RedirectClient();
      final sourceCommit = repeated('a', 40);
      final client = GitHubRuntimeReleaseClient(
        apiBase: Uri.parse('https://api.github.com'),
        project: 'TeamGaga2/flutter_quill_editor',
        token: 'secret-token',
        httpClient: transport,
      );
      await expectLater(
        client.fetchExactArtifact(runtimeArtifactTag(sourceCommit)),
        throwsStateError,
      );
      expect(transport.requests, hasLength(1));
      expect(
        transport.requests.single.headers['Authorization'],
        'Bearer secret-token',
      );
    },
  );

  test('archive path validation rejects traversal and symlinks', () {
    expect(
      () => validateArchiveEntries(<ArchiveFile>[
        ArchiveFile.bytes('../escape.js', <int>[1]),
      ]),
      throwsStateError,
    );
    expect(
      () => validateArchiveEntries(<ArchiveFile>[
        ArchiveFile.symlink('index.html', '../outside'),
      ]),
      throwsStateError,
    );
    expect(normalizeArchivePath('./assets/main.js'), 'assets/main.js');
    expect(() => normalizeArchivePath('bad\\name.js'), throwsStateError);
    expect(() => normalizeArchivePath('café.js'), throwsStateError);
    expect(() => normalizeArchivePath('한글.js'), throwsStateError);
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
      () => validateArchiveEntries(<ArchiveFile>[
        ArchiveFile('large.bin', kRuntimeMaxArchiveFileBytes + 1, <int>[]),
      ]),
      throwsStateError,
    );
  });

  test('archive extraction rejects unsafe entries before writing', () async {
    final archive = Archive()
      ..addFile(ArchiveFile.bytes('../escape', <int>[1]));
    final bytes = Uint8List.fromList(
      GZipEncoder().encodeBytes(TarEncoder().encode(archive)),
    );
    final temp = await Directory.systemTemp.createTemp('tg-runtime-test-');
    addTearDown(() => temp.delete(recursive: true));
    expect(
      () => extractRuntimeArchive(
        bytes: bytes,
        destination: Directory('${temp.path}/out'),
      ),
      throwsStateError,
    );
  });

  test('checksum parser is strict and does not accept arbitrary content', () {
    expect(
      parseArchiveChecksum('${repeated('a', 64)}  webview-runtime.tar.gz\n'),
      repeated('a', 64),
    );
    expect(
      () =>
          parseArchiveChecksum(jsonEncode(<String, String>{'token': 'secret'})),
      throwsFormatException,
    );
  });

  test('content-addressed cache revalidates bytes before a hit', () async {
    final temp = await Directory.systemTemp.createTemp(
      'tg-runtime-cache-test-',
    );
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
    await File(
      '${temp.path}/$digest/$kRuntimeArchiveName',
    ).writeAsBytes(<int>[9]);
    await cache.getOrStore(digest, download);
    expect(downloads, 2);
  });

  test('preparation temp directory is created beside the output', () async {
    final parent = await Directory.systemTemp.createTemp(
      'tg-runtime-parent-test-',
    );
    addTearDown(() => parent.delete(recursive: true));
    final outputParent = Directory('${parent.path}/assets');
    await outputParent.create();
    final temporary = await createRuntimePreparationDirectory(outputParent);
    expect(temporary.parent.path, outputParent.path);
    await temporary.delete(recursive: true);
  });
}
