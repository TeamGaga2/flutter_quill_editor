import 'package:flutter/foundation.dart';

/// Reference-counted gate that tells desktop [RichTextWebView] instances to
/// suppress native WKWebView cursor updates while a Flutter overlay is open.
///
/// macOS PlatformViews keep applying `cursor: text` under Flutter menus/popovers,
/// which fights Flutter's arrow/pointer and causes rapid cursor flicker.
///
/// PlatformViews also steal pointer hits from Flutter overlay barriers, so
/// outside-tap dismiss never fires when the user clicks the editor. While
/// blocked, the WebView installs a page-level blocker that reports those
/// clicks via [notifyOutsidePointer], and overlay owners register dismiss
/// handlers with [addOutsidePointerListener].
class DesktopPlatformViewPointerGate {
  DesktopPlatformViewPointerGate._();

  static final DesktopPlatformViewPointerGate instance = DesktopPlatformViewPointerGate._();

  final ValueNotifier<bool> blocked = ValueNotifier(false);
  final ValueNotifier<bool> focusBlocked = ValueNotifier(false);
  var _depth = 0;
  var _focusBlockingDepth = 0;
  final List<VoidCallback> _outsidePointerListeners = <VoidCallback>[];

  static bool get _enabled {
    if (kIsWeb) return true;
    return defaultTargetPlatform == TargetPlatform.macOS ||
        defaultTargetPlatform == TargetPlatform.windows ||
        defaultTargetPlatform == TargetPlatform.linux;
  }

  void acquire({bool blockFocus = true}) {
    if (!_enabled) return;
    _depth += 1;
    if (blockFocus) {
      _focusBlockingDepth += 1;
    }
    if (_depth == 1) {
      blocked.value = true;
    }
    if (_focusBlockingDepth == 1 && blockFocus) {
      focusBlocked.value = true;
    }
  }

  void release({bool blockFocus = true}) {
    if (!_enabled) return;
    if (_depth <= 0) return;
    _depth -= 1;
    if (blockFocus && _focusBlockingDepth > 0) {
      _focusBlockingDepth -= 1;
      if (_focusBlockingDepth == 0) {
        focusBlocked.value = false;
      }
    }
    if (_depth == 0) {
      blocked.value = false;
    }
  }

  /// Ask WebView hosts to re-apply the current [blocked] DOM state.
  ///
  /// Used after overlay teardown so a leftover legacy click-blocker cannot
  /// keep the editor unresponsive when [blocked] is already false.
  ///
  /// When [blocked] is already true (host Menu / link dialog open), do nothing:
  /// pulsing through `false` briefly clears iframe `pointer-events:none` and
  /// `interactionBlocked`, which lets Chrome reclaim the caret from overlay
  /// TextFields on every click.
  void reapply() {
    if (!_enabled) return;
    if (blocked.value) return;
    // ValueNotifier.notifyListeners is protected; pulse the value so listeners
    // run even when the flag is already false.
    blocked.value = true;
    blocked.value = false;
  }

  /// Register a dismiss callback for WebView clicks while [blocked] is true.
  ///
  /// Listeners are invoked synchronously from [notifyOutsidePointer]. Overlay
  /// owners should remove themselves in the same place they [release].
  void addOutsidePointerListener(VoidCallback listener) {
    if (!_enabled) return;
    if (_outsidePointerListeners.contains(listener)) return;
    _outsidePointerListeners.add(listener);
  }

  void removeOutsidePointerListener(VoidCallback listener) {
    _outsidePointerListeners.remove(listener);
  }

  /// Called by [RichTextWebView] when the in-page blocker receives a pointer.
  void notifyOutsidePointer() {
    if (!_enabled || !blocked.value) return;
    final listeners = List<VoidCallback>.of(_outsidePointerListeners);
    for (final listener in listeners) {
      listener();
    }
  }
}
