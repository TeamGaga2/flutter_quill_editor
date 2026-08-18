import 'package:flutter_quill_editor/protocol/messages.dart';
import 'package:flutter/widgets.dart';

/// Maps a viewport-relative [ProtocolCaretRect] (CSS px) to Flutter global
/// coordinates using the WebView widget's global origin.
///
/// Product rule (same as [DesktopRichTextToolBar] / Quill PC path):
/// - menu **X** aligns to the editor (WebView) left edge;
/// - menu **Y** follows the caret bottom so the panel opens under the line.
///
/// CSS pixels are treated as Flutter logical pixels (standard webview_flutter
/// viewport scaling). Callers may pass [devicePixelRatio] only if a future
/// host ever needs non-1:1 mapping; default is 1.0.
Offset resolveWebTriggerMenuOffset({
  required ProtocolCaretRect caretRect,
  required Offset webViewGlobalOrigin,
  double devicePixelRatio = 1.0,
}) {
  final scale = devicePixelRatio <= 0 ? 1.0 : devicePixelRatio;
  final caretBottomY =
      webViewGlobalOrigin.dy + (caretRect.y.toDouble() + caretRect.height.toDouble()) / scale;
  return Offset(webViewGlobalOrigin.dx, caretBottomY);
}

/// Global rect of the caret for [Menu] auto vertical flip (`anchorRect`).
Rect resolveWebTriggerAnchorRect({
  required ProtocolCaretRect caretRect,
  required Offset webViewGlobalOrigin,
  double devicePixelRatio = 1.0,
}) {
  final scale = devicePixelRatio <= 0 ? 1.0 : devicePixelRatio;
  final left = webViewGlobalOrigin.dx + caretRect.x.toDouble() / scale;
  final top = webViewGlobalOrigin.dy + caretRect.y.toDouble() / scale;
  final width = caretRect.width.toDouble() / scale;
  final height = caretRect.height.toDouble() / scale;
  return Rect.fromLTWH(left, top, width, height);
}

/// Global origin of the WebView surface identified by [webViewKey], or null.
Offset? webViewGlobalOriginOf(GlobalKey? webViewKey) {
  final box = webViewKey?.currentContext?.findRenderObject() as RenderBox?;
  if (box == null || !box.hasSize) return null;
  return box.localToGlobal(Offset.zero);
}

/// Visible size of the WebView surface, or null.
Size? webViewSizeOf(GlobalKey? webViewKey) {
  final box = webViewKey?.currentContext?.findRenderObject() as RenderBox?;
  if (box == null || !box.hasSize) return null;
  return box.size;
}

/// Inserts plain [text] into a Web snapshot at character [index], deleting
/// [deleteCount] characters first. Embed ops count as length 1 (Quill rules).
///
/// Used to inject `@` / `#` for toolbar-triggered live menus without a
/// dedicated protocol `insert_text` command and without round-tripping through
/// business Delta (which would strip embed `displayText`).
RichTextSnapshot insertPlainTextInSnapshot(
  RichTextSnapshot snapshot, {
  required int index,
  required String text,
  int deleteCount = 0,
}) {
  assert(index >= 0, 'index must be non-negative');
  assert(deleteCount >= 0, 'deleteCount must be non-negative');

  final ops = snapshot.content;
  if (ops.isEmpty) {
    return RichTextSnapshot(<String, Object?>{
      'content': <Object?>[
        <String, Object?>{'insert': '$text\n'},
      ],
    });
  }

  final built = <Object?>[];
  var cursor = 0;
  final deleteEnd = index + deleteCount;
  var inserted = false;

  void ensureInserted() {
    if (inserted || text.isEmpty) {
      inserted = true;
      return;
    }
    built.add(<String, Object?>{'insert': text});
    inserted = true;
  }

  for (final raw in ops) {
    if (raw is! Map) {
      built.add(raw);
      continue;
    }
    final op = Map<String, Object?>.from(
      raw.map((key, value) => MapEntry(key.toString(), value as Object?)),
    );
    final insert = op['insert'];

    if (insert is String) {
      final start = cursor;
      final end = cursor + insert.length;
      cursor = end;

      // Fully before the edit range.
      if (end <= index) {
        built.add(op);
        continue;
      }
      // Fully after the edit range.
      if (start >= deleteEnd) {
        ensureInserted();
        built.add(op);
        continue;
      }

      // Overlaps [index, deleteEnd).
      final keepPrefix = index > start ? insert.substring(0, index - start) : '';
      final keepSuffix = deleteEnd < end ? insert.substring(deleteEnd - start) : '';
      if (keepPrefix.isNotEmpty) {
        built.add(<String, Object?>{
          'insert': keepPrefix,
          if (op['attributes'] != null) 'attributes': op['attributes'],
        });
      }
      ensureInserted();
      if (keepSuffix.isNotEmpty) {
        built.add(<String, Object?>{
          'insert': keepSuffix,
          if (op['attributes'] != null) 'attributes': op['attributes'],
        });
      }
      continue;
    }

    // Embed (mention / channel / image / …): length 1.
    final start = cursor;
    cursor += 1;
    if (start < index) {
      built.add(op);
      continue;
    }
    if (start >= deleteEnd) {
      ensureInserted();
      built.add(op);
      continue;
    }
    // Embed falls inside the deleted range — drop it.
  }

  if (!inserted && text.isNotEmpty) {
    // Caret past end (or empty doc after deletes): append before trailing logic.
    built.add(<String, Object?>{'insert': text});
  }

  if (built.isEmpty) {
    built.add(<String, Object?>{'insert': '\n'});
  }

  return RichTextSnapshot(<String, Object?>{'content': built});
}
