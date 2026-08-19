import 'package:flutter_quill_editor/protocol/codec.dart';
import 'package:flutter_quill_editor/protocol/messages.dart';
import 'package:flutter_quill_editor/protocol/protocol_version.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  group('request_close Host Capability Wire', () {
    test('decodes empty-payload request_close event', () {
      final decoded = decodeProtocolMessage(
        '{"version":$kRichTextProtocolVersion,"kind":"event","type":"request_close","payload":{}}',
      );

      expect(decoded, isA<ProtocolParseSuccess<ProtocolMessage>>());
      final message = (decoded as ProtocolParseSuccess<ProtocolMessage>).value;
      expect(message, isA<RequestCloseEvent>());
      expect((message as RequestCloseEvent).type, 'request_close');
    });

    test('round-trips RequestCloseEvent', () {
      final encoded = encodeProtocolMessage(RequestCloseEvent());
      final decoded = decodeProtocolMessage(encoded);

      expect(decoded, isA<ProtocolParseSuccess<ProtocolMessage>>());
      final message = (decoded as ProtocolParseSuccess<ProtocolMessage>).value;
      expect(message, isA<RequestCloseEvent>());
    });
  });
}
