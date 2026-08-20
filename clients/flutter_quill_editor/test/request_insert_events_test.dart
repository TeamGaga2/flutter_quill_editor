import 'package:flutter_quill_editor/bridge/richtext_transport.dart';
import 'package:flutter_quill_editor/protocol/codec.dart';
import 'package:flutter_quill_editor/protocol/messages.dart';
import 'package:flutter_quill_editor/protocol/protocol_version.dart';
import 'package:flutter_quill_editor/widget/richtext_editor_controller.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  group('request insert actions wire protocol', () {
    test('decodes request_emoji with selection and null', () {
      final withSel = decodeProtocolMessage(
        '{"version":$kRichTextProtocolVersion,"kind":"event","type":"request_emoji","payload":{"selection":{"start":0,"end":2}}}',
      );
      expect(withSel, isA<ProtocolParseSuccess<ProtocolMessage>>());
      final msg1 = (withSel as ProtocolParseSuccess<ProtocolMessage>).value as RequestEmojiEvent;
      expect(msg1.type, 'request_emoji');
      expect(msg1.selection?.start, 0);
      expect(msg1.selection?.end, 2);

      final withNull = decodeProtocolMessage(
        '{"version":$kRichTextProtocolVersion,"kind":"event","type":"request_emoji","payload":{"selection":null}}',
      );
      expect(withNull, isA<ProtocolParseSuccess<ProtocolMessage>>());
      final msg2 = (withNull as ProtocolParseSuccess<ProtocolMessage>).value as RequestEmojiEvent;
      expect(msg2.selection, isNull);
    });

    test('decodes request_mention, request_channel, request_image', () {
      final mention = decodeProtocolMessage(
        '{"version":$kRichTextProtocolVersion,"kind":"event","type":"request_mention","payload":{"selection":{"start":1,"end":4}}}',
      );
      expect(mention, isA<ProtocolParseSuccess<ProtocolMessage>>());
      expect(
        ((mention as ProtocolParseSuccess<ProtocolMessage>).value as RequestMentionEvent).selection?.start,
        1,
      );

      final channel = decodeProtocolMessage(
        '{"version":$kRichTextProtocolVersion,"kind":"event","type":"request_channel","payload":{"selection":null}}',
      );
      expect(channel, isA<ProtocolParseSuccess<ProtocolMessage>>());
      expect(
        ((channel as ProtocolParseSuccess<ProtocolMessage>).value as RequestChannelEvent).selection,
        isNull,
      );

      final image = decodeProtocolMessage(
        '{"version":$kRichTextProtocolVersion,"kind":"event","type":"request_image","payload":{"selection":{"start":5,"end":5}}}',
      );
      expect(image, isA<ProtocolParseSuccess<ProtocolMessage>>());
      expect(
        ((image as ProtocolParseSuccess<ProtocolMessage>).value as RequestImageEvent).selection?.start,
        5,
      );
    });

    test('rejects missing selection or extra properties', () {
      final missing = decodeProtocolMessage(
        '{"version":$kRichTextProtocolVersion,"kind":"event","type":"request_emoji","payload":{}}',
      );
      expect(missing, isA<ProtocolParseFailure<ProtocolMessage>>());

      final extra = decodeProtocolMessage(
        '{"version":$kRichTextProtocolVersion,"kind":"event","type":"request_emoji","payload":{"selection":null,"extra":1}}',
      );
      expect(extra, isA<ProtocolParseFailure<ProtocolMessage>>());
    });

    test('round-trips all 4 request insert events', () {
      final events = <ProtocolEvent>[
        RequestEmojiEvent(selection: const ProtocolSelection(start: 0, end: 1)),
        RequestEmojiEvent(selection: null),
        RequestMentionEvent(selection: const ProtocolSelection(start: 2, end: 3)),
        RequestMentionEvent(selection: null),
        RequestChannelEvent(selection: const ProtocolSelection(start: 4, end: 5)),
        RequestChannelEvent(selection: null),
        RequestImageEvent(selection: const ProtocolSelection(start: 6, end: 7)),
        RequestImageEvent(selection: null),
      ];

      for (final event in events) {
        final encoded = encodeProtocolMessage(event);
        final decoded = decodeProtocolMessage(encoded);
        expect(decoded, isA<ProtocolParseSuccess<ProtocolMessage>>());
        final result = (decoded as ProtocolParseSuccess<ProtocolMessage>).value;
        expect((result as ProtocolEvent).type, event.type);
      }
    });

    test('controller forwards insert action events to dedicated streams', () async {
      final transport = MemoryRichTextTransport();
      final controller = RichTextEditorController(transport: transport);

      final emojiEvents = <RequestEmojiEvent>[];
      final mentionEvents = <RequestMentionEvent>[];
      final channelEvents = <RequestChannelEvent>[];
      final imageEvents = <RequestImageEvent>[];

      controller.onRequestEmoji.listen(emojiEvents.add);
      controller.onRequestMention.listen(mentionEvents.add);
      controller.onRequestChannel.listen(channelEvents.add);
      controller.onRequestImage.listen(imageEvents.add);

      transport.deliverFromWeb(
        '{"version":$kRichTextProtocolVersion,"kind":"event","type":"request_emoji","payload":{"selection":{"start":0,"end":0}}}',
      );
      transport.deliverFromWeb(
        '{"version":$kRichTextProtocolVersion,"kind":"event","type":"request_mention","payload":{"selection":{"start":1,"end":2}}}',
      );
      transport.deliverFromWeb(
        '{"version":$kRichTextProtocolVersion,"kind":"event","type":"request_channel","payload":{"selection":null}}',
      );
      transport.deliverFromWeb(
        '{"version":$kRichTextProtocolVersion,"kind":"event","type":"request_image","payload":{"selection":{"start":3,"end":3}}}',
      );

      await pumpEventQueue();

      expect(emojiEvents, hasLength(1));
      expect(emojiEvents.first.selection?.start, 0);

      expect(mentionEvents, hasLength(1));
      expect(mentionEvents.first.selection?.start, 1);

      expect(channelEvents, hasLength(1));
      expect(channelEvents.first.selection, isNull);

      expect(imageEvents, hasLength(1));
      expect(imageEvents.first.selection?.start, 3);

      await controller.dispose();
      await transport.dispose();
    });
  });
}
