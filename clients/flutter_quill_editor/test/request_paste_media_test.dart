import 'dart:convert';
import 'dart:typed_data';

import 'package:flutter_quill_editor/bridge/richtext_transport.dart';
import 'package:flutter_quill_editor/media/media_resource_registry.dart';
import 'package:flutter_quill_editor/protocol/codec.dart';
import 'package:flutter_quill_editor/protocol/messages.dart';
import 'package:flutter_quill_editor/protocol/protocol_version.dart';
import 'package:flutter_quill_editor/widget/richtext_editor_controller.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  group('request_paste_media wire protocol and controller (ADR-0008)', () {
    test('decodes request_paste_media with full payload', () {
      final jsonStr = jsonEncode({
        'version': kRichTextProtocolVersion,
        'kind': 'event',
        'type': 'request_paste_media',
        'payload': {
          'mimeType': 'image/png',
          'fileSize': 1024,
          'dataBase64': base64Encode(Uint8List.fromList([1, 2, 3, 4])),
          'width': '640',
          'height': '480',
          'fileName': 'photo.png',
          'isVideo': false,
          'selection': {'start': 3, 'end': 3},
        },
      });

      final result = decodeProtocolMessage(jsonStr);
      expect(result, isA<ProtocolParseSuccess<ProtocolMessage>>());
      final event = (result as ProtocolParseSuccess<ProtocolMessage>).value as RequestPasteMediaEvent;
      expect(event.type, 'request_paste_media');
      expect(event.typedPayload.mimeType, 'image/png');
      expect(event.typedPayload.fileSize, 1024);
      expect(event.typedPayload.width, '640');
      expect(event.typedPayload.height, '480');
      expect(event.typedPayload.fileName, 'photo.png');
      expect(event.typedPayload.isVideo, false);
      expect(event.typedPayload.selection?.start, 3);
      expect(event.typedPayload.selection?.end, 3);
    });

    test('decodes request_paste_media for video with duration', () {
      final jsonStr = jsonEncode({
        'version': kRichTextProtocolVersion,
        'kind': 'event',
        'type': 'request_paste_media',
        'payload': {
          'mimeType': 'video/mp4',
          'fileSize': 2048,
          'dataBase64': base64Encode(Uint8List.fromList([5, 6, 7, 8])),
          'width': '1280',
          'height': '720',
          'fileName': 'clip.mp4',
          'isVideo': true,
          'duration': 15,
          'selection': null,
        },
      });

      final result = decodeProtocolMessage(jsonStr);
      expect(result, isA<ProtocolParseSuccess<ProtocolMessage>>());
      final event = (result as ProtocolParseSuccess<ProtocolMessage>).value as RequestPasteMediaEvent;
      expect(event.typedPayload.isVideo, true);
      expect(event.typedPayload.duration, 15);
      expect(event.typedPayload.selection, isNull);
    });

    test('round-trips request_paste_media event through codec', () {
      final event = RequestPasteMediaEvent(
        typedPayload: RequestPasteMediaPayload(
          mimeType: 'image/jpeg',
          fileSize: 4096,
          dataBase64: base64Encode(Uint8List.fromList([10, 20, 30])),
          width: '800',
          height: '600',
          fileName: 'pic.jpg',
          isVideo: false,
          selection: const ProtocolSelection(start: 1, end: 2),
        ),
      );

      final encoded = encodeProtocolMessage(event);
      final decoded = decodeProtocolMessage(encoded);
      expect(decoded, isA<ProtocolParseSuccess<ProtocolMessage>>());
      final roundtrip = (decoded as ProtocolParseSuccess<ProtocolMessage>).value as RequestPasteMediaEvent;
      expect(roundtrip.typedPayload.mimeType, 'image/jpeg');
      expect(roundtrip.typedPayload.fileSize, 4096);
      expect(roundtrip.typedPayload.width, '800');
      expect(roundtrip.typedPayload.height, '600');
      expect(roundtrip.typedPayload.selection?.start, 1);
    });

    test('controller delivers request_paste_media to onRequestPasteMedia stream', () async {
      final transport = MemoryRichTextTransport();
      final controller = RichTextEditorController(transport: transport);

      final pasteEvents = <RequestPasteMediaEvent>[];
      controller.onRequestPasteMedia.listen(pasteEvents.add);

      final jsonStr = jsonEncode({
        'version': kRichTextProtocolVersion,
        'kind': 'event',
        'type': 'request_paste_media',
        'payload': {
          'mimeType': 'image/png',
          'fileSize': 512,
          'dataBase64': base64Encode(Uint8List.fromList([99, 100])),
          'selection': {'start': 0, 'end': 0},
        },
      });
      transport.deliverFromWeb(jsonStr);

      await pumpEventQueue();

      expect(pasteEvents, hasLength(1));
      expect(pasteEvents.first.typedPayload.mimeType, 'image/png');
      expect(pasteEvents.first.typedPayload.fileSize, 512);

      await controller.dispose();
      await transport.dispose();
    });

    test('MediaResourceRegistry registers bytes and resolves token', () async {
      final registry = MediaResourceRegistry();
      final testBytes = Uint8List.fromList([1, 2, 3, 4, 5]);
      final uri = await registry.registerBytes(bytes: testBytes, mimeType: 'image/png');

      expect(uri.startsWith('tgg-local-media://'), isTrue);
      final token = uri.substring('tgg-local-media://'.length);
      final entry = registry.lookup(token);
      expect(entry, isNotNull);
      expect(entry?.bytes, testBytes);
      expect(entry?.mimeType, 'image/png');
    });
  });
}
