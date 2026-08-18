import 'dart:async';
import 'dart:convert';

import 'package:flutter_quill_editor/bridge/richtext_transport.dart';
import 'package:flutter_quill_editor/protocol/codec.dart';
import 'package:flutter_quill_editor/protocol/messages.dart';
import 'package:flutter_quill_editor/widget/richtext_editor_controller.dart';
import 'package:flutter_test/flutter_test.dart';

void _deliverReady(MemoryRichTextTransport transport) {
  transport.deliverFromWeb(
    encodeProtocolMessage(ReadyEvent(protocolVersion: 1)),
  );
}

void main() {
  group('RichTextEditorController', () {
    late MemoryRichTextTransport transport;
    late RichTextEditorController controller;
    late StreamSubscription<String> outboundSub;
    final outbound = <String>[];

    setUp(() {
      transport = MemoryRichTextTransport();
      outbound.clear();
      outboundSub = transport.outbound.listen(outbound.add);
      controller = RichTextEditorController(
        transport: transport,
        commandTimeout: const Duration(seconds: 2),
        idGenerator: () => 'test',
      );
    });

    tearDown(() async {
      await outboundSub.cancel();
      await controller.dispose();
      await transport.dispose();
    });

    test('ready completes on ready event', () async {
      final readyFuture = controller.ready;
      expect(controller.isReady, isFalse);

      transport.deliverFromWeb(
        encodeProtocolMessage(ReadyEvent(protocolVersion: 1)),
      );

      await readyFuture;
      expect(controller.isReady, isTrue);
    });

    test('setSnapshot sends command and awaits matching response', () async {
      _deliverReady(transport);
      const snapshot = RichTextSnapshot({
        'content': [
          {'insert': 'hello\n'},
        ],
      });

      final future = controller.setSnapshot(snapshot);

      // Wait for outbound command.
      await Future<void>.delayed(Duration.zero);
      expect(outbound, hasLength(1));

      final command = decodeProtocolMessage(outbound.single);
      expect(command, isA<ProtocolParseSuccess<ProtocolMessage>>());
      final cmd = (command as ProtocolParseSuccess<ProtocolMessage>).value as ProtocolCommand;
      expect(cmd.type, 'set_snapshot');
      expect(cmd.id, startsWith('test_'));

      transport.deliverFromWeb(
        encodeProtocolMessage(
          ProtocolSuccessResponse(
            id: cmd.id,
            type: 'set_snapshot',
            value: const {},
          ),
        ),
      );

      await future;
    });

    test('getSnapshot returns snapshot from success response', () async {
      _deliverReady(transport);
      final future = controller.getSnapshot();

      await Future<void>.delayed(Duration.zero);
      final cmdJson = jsonDecode(outbound.single) as Map<String, dynamic>;
      final id = cmdJson['id'] as String;

      transport.deliverFromWeb(
        encodeProtocolMessage(
          ProtocolSuccessResponse(
            id: id,
            type: 'get_snapshot',
            value: {
              'snapshot': {
                'content': [
                  {'insert': 'hello\n'},
                ],
              },
            },
          ),
        ),
      );

      final snap = await future;
      expect(snap.content, isNotEmpty);
    });

    test('failure response throws RichTextEditorException', () async {
      _deliverReady(transport);
      final future = controller.undo();
      await Future<void>.delayed(Duration.zero);

      final cmdJson = jsonDecode(outbound.single) as Map<String, dynamic>;
      final id = cmdJson['id'] as String;

      transport.deliverFromWeb(
        encodeProtocolMessage(
          ProtocolFailureResponse(
            id: id,
            error: const ProtocolFailureError(
              code: ProtocolErrorCode.commandFailed,
              message: 'Command failed.',
            ),
          ),
        ),
      );

      await expectLater(
        future,
        throwsA(
          isA<RichTextEditorException>().having(
            (e) => e.code,
            'code',
            ProtocolErrorCode.commandFailed,
          ),
        ),
      );
    });

    test('onChange and onState streams receive events', () async {
      final changes = <ChangeEvent>[];
      final states = <StateChangeEvent>[];
      final changeSub = controller.onChange.listen(changes.add);
      final stateSub = controller.onState.listen(states.add);
      expect(controller.latestState, isNull);

      transport
        ..deliverFromWeb(
          encodeProtocolMessage(
            ChangeEvent(
              snapshot: const RichTextSnapshot({
                'content': [
                  {'insert': 'a\n'},
                ],
              }),
            ),
          ),
        )
        ..deliverFromWeb(
          encodeProtocolMessage(
            StateChangeEvent(
              state: const ProtocolEditorState(
                focused: true,
                selection: ProtocolSelection(start: 0, end: 1),
                canUndo: true,
                canRedo: false,
                formats: ProtocolEditorFormats(
                  bold: true,
                  italic: false,
                  underline: false,
                  strike: false,
                  header: false,
                  list: false,
                  blockquote: false,
                ),
              ),
            ),
          ),
        );

      await Future<void>.delayed(Duration.zero);
      expect(changes, hasLength(1));
      expect(states, hasLength(1));
      expect(states.single.state.canUndo, isTrue);
      expect(controller.latestState?.canUndo, isTrue);
      expect(controller.latestState?.formats.bold, isTrue);

      await changeSub.cancel();
      await stateSub.cancel();
    });

    test('toggleInlineFormat / insertEmoji / focus encode correctly', () async {
      _deliverReady(transport);
      Future<void> pumpAndRespond(String expectedType) async {
        await Future<void>.delayed(Duration.zero);
        final cmdJson = jsonDecode(outbound.last) as Map<String, dynamic>;
        expect(cmdJson['type'], expectedType);
        transport.deliverFromWeb(
          encodeProtocolMessage(
            ProtocolSuccessResponse(
              id: cmdJson['id'] as String,
              type: expectedType,
              value: const {},
            ),
          ),
        );
      }

      final bold = controller.toggleInlineFormat(ProtocolInlineFormat.bold);
      await pumpAndRespond('toggle_inline_format');
      await bold;

      final emoji = controller.insertEmoji('party_parrot');
      await pumpAndRespond('insert_emoji');
      await emoji;

      final focus = controller.focus();
      await pumpAndRespond('focus');
      await focus;
    });

    test('typed insert commands encode payloads and optional selection', () async {
      _deliverReady(transport);
      Future<Map<String, dynamic>> pumpAndRespond(String expectedType) async {
        await Future<void>.delayed(Duration.zero);
        final cmdJson = jsonDecode(outbound.last) as Map<String, dynamic>;
        expect(cmdJson['type'], expectedType);
        transport.deliverFromWeb(
          encodeProtocolMessage(
            ProtocolSuccessResponse(
              id: cmdJson['id'] as String,
              type: expectedType,
              value: const {},
            ),
          ),
        );
        return cmdJson;
      }

      const selection = ProtocolSelection(start: 2, end: 5);

      final mention = controller.insertMention(
        id: 'user-1',
        sign: '!',
        displayText: 'Alice',
        selection: selection,
      );
      final mentionJson = await pumpAndRespond('insert_mention');
      expect(mentionJson['payload'], {
        'id': 'user-1',
        'sign': '!',
        'displayText': 'Alice',
        'selection': {'start': 2, 'end': 5},
      });
      await mention;

      final channel = controller.insertChannel(
        id: 'channel-1',
        displayText: 'general',
      );
      final channelJson = await pumpAndRespond('insert_channel');
      expect(channelJson['payload'], {
        'id': 'channel-1',
        'displayText': 'general',
      });
      await channel;

      final image = controller.insertImage(
        src: 'tgg-local-media://image-token',
        width: '320',
        height: '240',
        mimeType: 'image/jpeg',
        fileSize: 10,
      );
      final imageJson = await pumpAndRespond('insert_image');
      expect(imageJson['payload'], {
        'src': 'tgg-local-media://image-token',
        'width': '320',
        'height': '240',
        'mimeType': 'image/jpeg',
        'fileSize': 10,
      });
      await image;

      final video = controller.insertVideo(
        src: 'https://cdn.example/video.mp4',
        width: '640',
        height: '480',
        mimeType: 'video/mp4',
        fileSize: 20,
        poster: 'https://cdn.example/poster.jpg',
        duration: 5,
      );
      final videoJson = await pumpAndRespond('insert_video');
      expect(videoJson['payload'], {
        'src': 'https://cdn.example/video.mp4',
        'width': '640',
        'height': '480',
        'mimeType': 'video/mp4',
        'fileSize': 20,
        'poster': 'https://cdn.example/poster.jpg',
        'duration': 5,
      });
      await video;

      final link = controller.insertLink(
        url: 'https://teamgaga.com',
        text: 'TeamGaga',
        selection: selection,
      );
      final linkJson = await pumpAndRespond('insert_link');
      expect(linkJson['payload'], {
        'url': 'https://teamgaga.com',
        'text': 'TeamGaga',
        'selection': {'start': 2, 'end': 5},
      });
      await link;

      final divider = controller.insertDivider();
      final dividerJson = await pumpAndRespond('insert_divider');
      expect(dividerJson['payload'], isEmpty);
      await divider;
    });

    test('indent / outdent / getCaretRect encode and decode correctly', () async {
      _deliverReady(transport);
      Future<Map<String, dynamic>> pumpAndRespond(
        String expectedType, {
        Map<String, Object?> value = const {},
      }) async {
        await Future<void>.delayed(Duration.zero);
        final cmdJson = jsonDecode(outbound.last) as Map<String, dynamic>;
        expect(cmdJson['type'], expectedType);
        expect(cmdJson['payload'], isEmpty);
        transport.deliverFromWeb(
          encodeProtocolMessage(
            ProtocolSuccessResponse(
              id: cmdJson['id'] as String,
              type: expectedType,
              value: value,
            ),
          ),
        );
        return cmdJson;
      }

      final indent = controller.indent();
      await pumpAndRespond('indent');
      await indent;

      final outdent = controller.outdent();
      await pumpAndRespond('outdent');
      await outdent;

      final caretFuture = controller.getCaretRect();
      await pumpAndRespond(
        'get_caret_rect',
        value: {
          'rect': {'x': 12.5, 'y': 48, 'width': 0, 'height': 20},
        },
      );
      final rect = await caretFuture;
      expect(
        rect,
        const ProtocolCaretRect(x: 12.5, y: 48, width: 0, height: 20),
      );

      final nullCaretFuture = controller.getCaretRect();
      await pumpAndRespond('get_caret_rect', value: {'rect': null});
      expect(await nullCaretFuture, isNull);
    });

    test('wakeEditingSession no-ops when no action was injected', () async {
      // Must not throw even though this controller (built in setUp) was
      // constructed without a wakeEditingSessionAction.
      await controller.wakeEditingSession();
      await controller.wakeEditingSession(keepTitle: true);
    });

    test('wakeEditingSession invokes the injected action with keepTitle', () async {
      final calls = <bool>[];
      final withAction = RichTextEditorController(
        transport: transport,
        commandTimeout: const Duration(seconds: 2),
        idGenerator: () => 'test',
        wakeEditingSessionAction: ({keepTitle = false}) async {
          calls.add(keepTitle);
        },
      );

      await withAction.wakeEditingSession();
      await withAction.wakeEditingSession(keepTitle: true);

      expect(calls, [false, true]);

      await withAction.dispose();
    });

    test('onRequestLink receives request_link events with optional selection', () async {
      final links = <RequestLinkEvent>[];
      final sub = controller.onRequestLink.listen(links.add);

      transport
        ..deliverFromWeb(
          encodeProtocolMessage(
            RequestLinkEvent(
              selection: const ProtocolSelection(start: 0, end: 5),
            ),
          ),
        )
        ..deliverFromWeb(encodeProtocolMessage(RequestLinkEvent()));

      await Future<void>.delayed(Duration.zero);
      expect(links, hasLength(2));
      expect(links[0].selection, const ProtocolSelection(start: 0, end: 5));
      expect(links[1].selection, isNull);

      await sub.cancel();
    });
  });
}
