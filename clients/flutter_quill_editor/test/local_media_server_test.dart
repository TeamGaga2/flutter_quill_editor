import 'dart:async';
import 'dart:io';

import 'package:flutter_quill_editor/media/local_media_registry.dart';
import 'package:flutter_quill_editor/runtime/native_runtime_loader_io.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  late Directory tempDirectory;
  late HttpServer server;
  late HttpClient client;
  late LocalMediaRegistry registry;

  setUp(() async {
    tempDirectory = await Directory.systemTemp.createTemp('richtext-media-');
    var tokenSequence = 4;
    registry = LocalMediaRegistry(
      tokenGenerator: () =>
          '00000000-0000-4000-8000-${(tokenSequence++).toString().padLeft(12, '0')}',
    );
    server = (await HttpServer.bind(InternetAddress.loopbackIPv4, 0))
      ..listen((request) {
        unawaited(serveLocalMediaRequest(request, registry));
      });
    client = HttpClient();
  });

  tearDown(() async {
    client.close(force: true);
    await server.close(force: true);
    await tempDirectory.delete(recursive: true);
  });

  test('allows GET/HEAD and serves a single byte range', () async {
    final file = File('${tempDirectory.path}/clip.mp4')..writeAsBytesSync([1, 2, 3, 4]);
    final uri = registry.registerPath(file.path, mimeType: 'video/mp4');
    final url = Uri.parse(
      'http://127.0.0.1:${server.port}/__tg_media__/${uri.substring(LocalMediaRegistry.uriPrefix.length)}',
    );

    final get = await client.getUrl(url).then((request) => request.close());
    expect(get.statusCode, HttpStatus.ok);
    expect(get.headers.contentType?.mimeType, 'video/mp4');
    expect(get.headers.contentLength, 4);
    expect(await get.fold<List<int>>([], (bytes, chunk) => bytes..addAll(chunk)), [1, 2, 3, 4]);

    final head = await client.headUrl(url).then((request) => request.close());
    expect(head.statusCode, HttpStatus.ok);
    expect(head.headers.contentLength, 4);
    await head.drain<void>();

    final rangeRequest = await client.getUrl(url);
    rangeRequest.headers.set(HttpHeaders.rangeHeader, 'bytes=1-2');
    final range = await rangeRequest.close();
    expect(range.statusCode, HttpStatus.partialContent);
    expect(range.headers.value(HttpHeaders.contentRangeHeader), 'bytes 1-2/4');
    expect(await range.fold<List<int>>([], (bytes, chunk) => bytes..addAll(chunk)), [2, 3]);
  });

  test('rejects methods other than GET and HEAD', () async {
    final file = File('${tempDirectory.path}/photo.jpg')..writeAsBytesSync([1]);
    final uri = registry.registerPath(file.path, mimeType: 'image/jpeg');
    final url = Uri.parse(
      'http://127.0.0.1:${server.port}/__tg_media__/${uri.substring(LocalMediaRegistry.uriPrefix.length)}',
    );

    final request = await client.postUrl(url);
    final response = await request.close();

    expect(response.statusCode, HttpStatus.methodNotAllowed);
    expect(response.headers.value('Allow'), 'GET, HEAD');
    await response.drain<void>();
  });

  test('closes an empty GET with Content-Length zero', () async {
    final file = File('${tempDirectory.path}/empty.mp4')..createSync();
    final uri = registry.registerPath(file.path, mimeType: 'video/mp4');
    final url = Uri.parse(
      'http://127.0.0.1:${server.port}/__tg_media__/${uri.substring(LocalMediaRegistry.uriPrefix.length)}',
    );

    final response = await client.getUrl(url).then((request) => request.close());

    expect(response.statusCode, HttpStatus.ok);
    expect(response.headers.contentLength, 0);
    expect(await response.fold<List<int>>([], (bytes, chunk) => bytes..addAll(chunk)), isEmpty);
  });

  test('falls back to the file extension when mimeType is absent', () async {
    final image = File('${tempDirectory.path}/restored.jpg')..writeAsBytesSync([1]);
    final video = File('${tempDirectory.path}/restored.mp4')..writeAsBytesSync([1]);
    final imageUri = registry.registerPath(image.path);
    final videoUri = registry.registerPath(video.path);

    final imageResponse = await client
        .getUrl(
          Uri.parse(
            'http://127.0.0.1:${server.port}/__tg_media__/${imageUri.substring(LocalMediaRegistry.uriPrefix.length)}',
          ),
        )
        .then((request) => request.close());
    final videoResponse = await client
        .getUrl(
          Uri.parse(
            'http://127.0.0.1:${server.port}/__tg_media__/${videoUri.substring(LocalMediaRegistry.uriPrefix.length)}',
          ),
        )
        .then((request) => request.close());

    expect(imageResponse.headers.contentType?.mimeType, 'image/jpeg');
    expect(videoResponse.headers.contentType?.mimeType, 'video/mp4');
    await imageResponse.drain<void>();
    await videoResponse.drain<void>();
  });
}
