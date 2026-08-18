import 'dart:convert';

import 'package:flutter/material.dart';

/// JavaScript channel name registered on the WebView (Flutter host) / the
/// handler name registered via `addJavaScriptHandler` (Windows host).
///
/// Must match the production transport factory injected into the runtime.
/// Canonical contract: flutter_quill_editor `docs/plans/richtext-flutter-bridge.md`
/// and `apps/webview-runtime/scripts/flutter-inject-template.js`.
const String kTgRichTextBridgeChannel = 'TgRichTextBridge';

/// JavaScript channel name / handler used by the desktop pointer gate to
/// notify Flutter of an in-page pointerdown while the gate is active.
const String kTgPointerGateChannel = 'TgPointerGate';

/// Max media box size for WebView embeds — mirrors Flutter `kImImageCachedSize`.
int richTextWebMediaMaxSizeFor({required bool isDesktopRichTextSurface}) =>
    isDesktopRichTextSurface ? 320 : 240;

/// Composition Title lives in the editor runtime on every IM composition host
/// (mobile + Desktop Rich Text Surfaces). Independent of the runtime toolbar
/// mode.
bool get kRichTextWebShowTitleInput => true;

/// CSS `#rrggbb` for a Flutter [Color] (shell background sync).
String richTextColorToCss(Color color) {
  final rgb = color.toARGB32() & 0xFFFFFF;
  return '#${rgb.toRadixString(16).padLeft(6, '0')}';
}

/// Toolbar Mode for a host surface (pure; the host injects the decision).
///
/// Desktop Rich Text Surfaces → In-Web Desktop Chrome (`desktop`).
/// Mobile → editor-only (`none`).
String richTextWebToolbarModeFor({required bool isDesktopRichTextSurface}) =>
    isDesktopRichTextSurface ? 'desktop' : 'none';

/// How the injected bridge shim delivers Web → Flutter messages.
///
/// The wire-level protocol contract (`TgRichTextBridge.postMessage`) is the
/// same source name on both backends; only the underlying transport differs
/// per plan §5.5.
enum RichTextBridgeChannelKind {
  /// Android / iOS / macOS: `webview_flutter` `JavaScriptChannel`.
  javaScriptChannel,

  /// Windows: stable `flutter_inappwebview` `callHandler` bridge.
  inAppWebViewHandler,
}

/// Bootstrap script — keep in lockstep with:
/// `flutter_quill_editor/apps/webview-runtime/scripts/flutter-inject-template.js`
///
/// Injection strategy:
/// 1. Prefer injecting **before** navigation when the platform allows.
/// 2. Flutter re-injects on page started / finished (idempotent).
/// 3. Optional early classic script in asset `index.html` for race safety.
///
/// Flutter → Web: `window.__TG_RICHTEXT_DELIVER__(protocolJsonString)`
/// (trusted direction — no capability envelope needed).
/// Web → Flutter: `TgRichTextBridge.postMessage(envelopeJsonString)` where
/// the envelope wraps the protocol JSON string with [bridgeToken] (plan
/// §5.5). [bridgeChannelKind] selects the underlying delivery primitive.
String buildRichTextTransportBootstrapJs({
  required String bridgeToken,
  RichTextBridgeChannelKind bridgeChannelKind = RichTextBridgeChannelKind.javaScriptChannel,
  int? mediaMaxSize,
  String? toolbarMode,
  bool? showTitleInput,
  String? titlePlaceholder,
  String? placeholder,
  String? shellBackgroundColor,
  String? theme,
}) {
  // Hosts inject their own configuration; mobile-style defaults keep the
  // builder usable standalone (tests / fixtures).
  final maxSize = mediaMaxSize ?? richTextWebMediaMaxSizeFor(isDesktopRichTextSurface: false);
  final mode = toolbarMode ?? richTextWebToolbarModeFor(isDesktopRichTextSurface: false);
  final showTitle = showTitleInput ?? kRichTextWebShowTitleInput;
  final titleHint = jsonEncode(titlePlaceholder ?? 'Enter a title');
  // Flutter l10n is source of truth; fall back matches runtime default.
  final bodyPlaceholder = jsonEncode(placeholder ?? 'Enter text');
  final shellBg = shellBackgroundColor ?? '#ffffff';
  final themeMode = theme ?? 'light';
  final tokenLiteral = jsonEncode(bridgeToken);
  final sendImpl = bridgeChannelKind == RichTextBridgeChannelKind.inAppWebViewHandler
      ? '''
        if (
          typeof window.flutter_inappwebview === "undefined" ||
          typeof window.flutter_inappwebview.callHandler !== "function"
        ) {
          throw new Error(
            "TgRichTextBridge handler is not available. InAppWebView bridge not ready.",
          );
        }
        window.flutter_inappwebview.callHandler("$kTgRichTextBridgeChannel", envelope);'''
      : '''
        if (
          typeof TgRichTextBridge === "undefined" ||
          typeof TgRichTextBridge.postMessage !== "function"
        ) {
          throw new Error(
            "TgRichTextBridge channel is not available. Register JavascriptChannel before load.",
          );
        }
        TgRichTextBridge.postMessage(envelope);''';
  return '''
(function injectTeamGagaRichTextBridge() {
  "use strict";

  // Popup / new-window requests are always denied (plan §5.5) at the JS
  // layer so behavior is identical on every host backend, regardless of
  // native new-window callback support (webview_flutter has none; the
  // Windows host additionally denies natively via onCreateWindow).
  try {
    window.open = function () { return null; };
  } catch (e) {}

  var existing = window.__TG_RICHTEXT_CONFIG__ || {};
  window.__TG_RICHTEXT_CONFIG__ = {
    toolbarMode: "$mode",
    // Flutter host is source of truth — always overwrite (stale value from an
    // earlier inject cannot win after the real theme arrives).
    theme: "$themeMode",
    locale: existing.locale,
    mediaMaxSize: $maxSize,
    // Flutter host is source of truth for body placeholder (l10n).
    placeholder: $bodyPlaceholder,
    showTitleInput: $showTitle,
    titlePlaceholder: $titleHint,
    // Flutter host is source of truth — always overwrite so a stale white
    // default from an earlier inject cannot win after the real shell color arrives.
    shellBackgroundColor: "$shellBg"
  };
  // Apply theme class here so every injectBootstrap (load + live sync) updates
  // token CSS — do not rely solely on prepareShell (one-shot) or a separate
  // runJavaScript toggle (can race / be skipped when shell color is stale).
  var root = document.documentElement;
  if (root) {
    root.classList.remove("tg-theme-dark", "tg-theme-light");
    root.classList.add("tg-theme-$themeMode");
  }
  var appEl = document.getElementById("app");
  if (appEl) {
    appEl.dataset.theme = "$themeMode";
  }
  // Platform class (tg-webview-layout-*) is owned by the runtime:
  // mount-editor prepareShell sets it from toolbarMode (ADR 0002).
  // Emoji defs are injected separately by Flutter (buildEmojiDefinitionsBootstrapJs)
  // before this bootstrap, or embedded in index.html.

  // Dynamic shell background sync only (ADR 0001 / ADR 0002): the host owns
  // the page background and keeps the title/body surfaces painted with the
  // tokenized shell color. Stable typography, spacing and node styles are
  // owned exclusively by the runtime bundle CSS — do NOT re-declare them here.
  var HOST_EDITOR_STYLE_ID = "tg-richtext-host-style";
  // !important: Vite bundle CSS loads after this <style> and sets
  // html/body/.tg-webview-root to transparent, which reveals WKWebView's
  // default white canvas in title + content padding while .ql-editor (higher
  // specificity) still shows the shell color.
  var HOST_EDITOR_STYLE = [
    "html,body{background:$shellBg!important}",
    ".tg-webview-root{background:$shellBg!important}",
    ".tg-webview-editor-root{background:$shellBg!important}",
    ".tg-webview-editor-root .tg-richtext-host-editor{background:$shellBg!important}",
    ".tg-webview-editor-root .ql-editor{background:$shellBg!important}",
    ".tg-webview-title-wrap{background:$shellBg!important}",
    ".tg-webview-title-input{background:$shellBg!important}"
  ].join("");

  function ensureHostStyle() {
    var head = document.head || document.documentElement;
    if (!head) return;
    var style = document.getElementById(HOST_EDITOR_STYLE_ID);
    if (!style) {
      style = document.createElement("style");
      style.id = HOST_EDITOR_STYLE_ID;
      head.appendChild(style);
    } else if (style.parentNode === head && head.lastChild !== style) {
      // Keep host style last so it wins equal-specificity rules from the bundle.
      head.appendChild(style);
    }
    if (style.textContent !== HOST_EDITOR_STYLE) {
      style.textContent = HOST_EDITOR_STYLE;
    }
  }

  function syncPlaceholder() {
    var placeholder = window.__TG_RICHTEXT_CONFIG__ && window.__TG_RICHTEXT_CONFIG__.placeholder;
    if (!placeholder) return;
    var editor = document.querySelector(".tg-webview-editor-root .ql-editor");
    if (!editor) return;
    if (editor.getAttribute("data-placeholder") !== placeholder) {
      editor.setAttribute("data-placeholder", placeholder);
    }
  }

  if (typeof document !== "undefined") {
    // Apply shell background immediately (needs only <head>) so the first paint
    // matches the Flutter container — waiting for DOMContentLoaded flashes white.
    ensureHostStyle();
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", syncPlaceholder, { once: true });
    } else {
      syncPlaceholder();
    }
    if (!window.__TG_RICHTEXT_HOST_STYLE_OBSERVER__) {
      window.__TG_RICHTEXT_HOST_STYLE_OBSERVER__ = new MutationObserver(function () {
        syncPlaceholder();
      });
      window.__TG_RICHTEXT_HOST_STYLE_OBSERVER__.observe(document.documentElement, {
        childList: true,
        subtree: true
      });
    }
  }

  window.__TG_RICHTEXT_CREATE_TRANSPORT__ = function createTgRichTextTransport() {
    var listeners = [];
    var destroyed = false;
    var BRIDGE_TOKEN = $tokenLiteral;

    function deliver(message) {
      if (destroyed) {
        return;
      }
      var snapshot = listeners.slice();
      for (var i = 0; i < snapshot.length; i++) {
        try {
          snapshot[i](message);
        } catch (e) {
          // Isolate listener failures from the bridge.
        }
      }
    }

    // Canonical name (richtext contract). Keep alias for older client drafts.
    window.__TG_RICHTEXT_DELIVER__ = deliver;
    window.__TG_RICHTEXT_DELIVER_FROM_FLUTTER__ = deliver;

    return {
      send: function send(message) {
        if (destroyed) {
          throw new Error("TgRichTextBridge transport has been destroyed.");
        }
        // Capability envelope: the stable plugin does not expose reliable
        // origin metadata to the Dart callback, so every outbound message
        // must prove it came from this materialized runtime (plan §5.5).
        var envelope = JSON.stringify({ v: 1, t: BRIDGE_TOKEN, p: message });
$sendImpl
      },
      subscribe: function subscribe(listener) {
        if (destroyed) {
          throw new Error("TgRichTextBridge transport has been destroyed.");
        }
        listeners.push(listener);
        return function unsubscribe() {
          var idx = listeners.indexOf(listener);
          if (idx >= 0) {
            listeners.splice(idx, 1);
          }
        };
      },
      destroy: function destroy() {
        destroyed = true;
        listeners = [];
        try {
          delete window.__TG_RICHTEXT_DELIVER__;
          delete window.__TG_RICHTEXT_DELIVER_FROM_FLUTTER__;
        } catch (e) {
          window.__TG_RICHTEXT_DELIVER__ = undefined;
          window.__TG_RICHTEXT_DELIVER_FROM_FLUTTER__ = undefined;
        }
      },
    };
  };
})();
''';
}
