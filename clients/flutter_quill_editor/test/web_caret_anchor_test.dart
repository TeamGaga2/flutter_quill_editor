import 'package:flutter_quill_editor/protocol/messages.dart';
import 'package:flutter_quill_editor/web_caret_anchor.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  group('resolveWebTriggerMenuOffset', () {
    test('uses editor left edge and caret bottom Y', () {
      const caret = ProtocolCaretRect(x: 40, y: 80, width: 0, height: 20);
      const origin = Offset(100, 50);

      final offset = resolveWebTriggerMenuOffset(
        caretRect: caret,
        webViewGlobalOrigin: origin,
      );

      // Product rule: X = WebView left, Y = origin.y + caret.y + caret.height
      expect(offset, const Offset(100, 150));
    });

    test('scales when devicePixelRatio is not 1', () {
      const caret = ProtocolCaretRect(x: 40, y: 80, width: 0, height: 20);

      final offset = resolveWebTriggerMenuOffset(
        caretRect: caret,
        webViewGlobalOrigin: Offset.zero,
        devicePixelRatio: 2,
      );

      expect(offset.dx, 0);
      expect(offset.dy, 50);
    });
  });

  group('resolveWebTriggerAnchorRect', () {
    test('maps caret rect into global coordinates', () {
      const caret = ProtocolCaretRect(x: 12.5, y: 48, width: 0, height: 20);
      const origin = Offset(10, 20);

      final rect = resolveWebTriggerAnchorRect(
        caretRect: caret,
        webViewGlobalOrigin: origin,
      );

      expect(rect.left, 22.5);
      expect(rect.top, 68);
      expect(rect.width, 0);
      expect(rect.height, 20);
    });
  });

  group('insertPlainTextInSnapshot', () {
    test('inserts into empty snapshot', () {
      const empty = RichTextSnapshot(<String, Object?>{'content': <Object?>[]});
      final next = insertPlainTextInSnapshot(empty, index: 0, text: '@');
      expect(next.content, [
        {'insert': '@\n'},
      ]);
    });

    test('inserts at start of plain text op', () {
      const snap = RichTextSnapshot({
        'content': [
          {'insert': 'hello\n'},
        ],
      });
      final next = insertPlainTextInSnapshot(snap, index: 0, text: '@');
      expect(
        next.content.map((e) => (e! as Map)['insert']).toList(),
        ['@', 'hello\n'],
      );
    });

    test('inserts in the middle and preserves embeds', () {
      const snap = RichTextSnapshot({
        'content': [
          {'insert': 'ab'},
          {
            'insert': {'mention': 'u1'},
            'attributes': {'sign': '!', 'displayText': 'Alice'},
          },
          {'insert': 'cd\n'},
        ],
      });
      // Lengths: 'ab'(2) + embed(1) + 'cd\n'(3) — insert at 2 (before embed)
      final next = insertPlainTextInSnapshot(snap, index: 2, text: '#');
      final inserts = next.content.map((e) => (e! as Map)['insert']).toList();
      expect(inserts[0], 'ab');
      expect(inserts[1], '#');
      expect(inserts[2], {'mention': 'u1'});
      expect(
        (next.content[2]! as Map)['attributes'],
        {'sign': '!', 'displayText': 'Alice'},
      );
      expect(inserts[3], 'cd\n');
    });

    test('replaces a selection range', () {
      const snap = RichTextSnapshot({
        'content': [
          {'insert': 'hello\n'},
        ],
      });
      final next = insertPlainTextInSnapshot(
        snap,
        index: 1,
        text: '@',
        deleteCount: 3,
      );
      expect(
        next.content.map((e) => (e! as Map)['insert']).toList(),
        ['h', '@', 'o\n'],
      );
    });
  });
}
