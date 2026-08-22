import 'package:flutter/foundation.dart';
import 'package:flutter/widgets.dart';

/// Request keyboard focus for a [RichTextWebView] surface [FocusNode].
///
/// On Windows, `flutter_inappwebview` embeds WebView2 as a **composition
/// texture** with its own nested [FocusNode] (`CustomPlatformView`). Giving
/// primary focus to the page-level surface node steals focus from that nested
/// node, so title/body never keep a caret. Prefer the first focusable
/// descendant (the plugin node) when present.
///
/// macOS WKWebView / mobile hole-punch hosts need the surface node itself so
/// AppKit / Android firstResponder handoff still works.
void requestRichTextWebViewSurfaceFocus(FocusNode surfaceFocusNode) {
  if (defaultTargetPlatform == TargetPlatform.iOS) {
    return;
  }
  if (!kIsWeb && defaultTargetPlatform == TargetPlatform.windows) {
    final descendant = firstFocusableFocusDescendant(surfaceFocusNode);
    if (descendant != null) {
      descendant.requestFocus();
      return;
    }
  }
  surfaceFocusNode.requestFocus();
}

/// Whether the rich-text WebView surface (or its nested plugin FocusNode) already
/// owns Flutter primary focus.
///
/// On Windows texture WebView2 the page-level surface node has
/// `canRequestFocus: false`, so [surfaceFocusNode.hasFocus] is always false while
/// the nested plugin node holds focus. Callers must check descendants before
/// reclaiming, or every in-Web body `FocusEvent` will re-requestFocus and eat
/// the first title↔body caret placement.
bool richTextWebViewSurfaceHasFocus(FocusNode surfaceFocusNode) {
  if (surfaceFocusNode.hasFocus) {
    return true;
  }
  return surfaceFocusNode.descendants.any((descendant) => descendant.hasFocus);
}

/// Reclaim platform WebView focus, then run [focusEditor] (protocol `focus`).
///
/// Windows texture WebView2 needs the nested Flutter [FocusNode] before JS
/// focus can show a caret again after a toolbar / overlay interaction.
Future<void> restoreRichTextWebViewEditorFocus({
  required FocusNode surfaceFocusNode,
  required Future<void> Function() focusEditor,
}) async {
  if (defaultTargetPlatform != TargetPlatform.iOS) {
    requestRichTextWebViewSurfaceFocus(surfaceFocusNode);
    await Future<void>.delayed(const Duration(milliseconds: 50));
  }
  await focusEditor();
}

/// First focusable descendant in the focus tree under [node], if any.
@visibleForTesting
FocusNode? firstFocusableFocusDescendant(FocusNode node) {
  for (final descendant in node.descendants) {
    if (descendant.canRequestFocus) {
      return descendant;
    }
  }
  return null;
}
