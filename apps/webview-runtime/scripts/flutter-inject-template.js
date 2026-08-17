/**
 * Canonical Flutter → WebView inject snippet for production bootstrap.
 *
 * Channel name: TgRichTextBridge (webview_flutter JavaScriptChannel).
 *
 * Injection order (before the runtime page navigates / boots modules):
 *   1. window.__TG_RICHTEXT_CONFIG__
 *   2. window.__TG_RICHTEXT_CREATE_TRANSPORT__
 *   3. Load apps/webview-runtime/dist (index.html with base './')
 *
 * Contract:
 * - __TG_RICHTEXT_CREATE_TRANSPORT__(): HostTransport
 *     send(message: string)     → Web → Flutter via channel postMessage (raw Protocol JSON)
 *     subscribe(listener)       → returns unsubscribe; Flutter delivers via deliver helper
 *     destroy()                 → idempotent cleanup
 * - Flutter → Web: runJavaScript calling window.__TG_RICHTEXT_DELIVER__(jsonString)
 * - Web → Flutter: TgRichTextBridge.postMessage(jsonString)
 *
 * Desktop may later use flutter_inappwebview; swap only the send/deliver plumbing —
 * keep the same window factory names and HostTransport shape.
 *
 * Copy the IIFE body into Flutter `runJavaScript` / userScript injection.
 */
(function injectTeamGagaRichTextBridge() {
  "use strict";

  // 1) Config first (optional; defaults to toolbarMode: 'none').
  //    theme is injected dynamically by Flutter as "light" | "dark" (the
  //    app's effective brightness, honoring AdaptiveTheme system/light/dark).
  //    The runtime applies it as tg-theme-light / tg-theme-dark on <html>.
  window.__TG_RICHTEXT_CONFIG__ = window.__TG_RICHTEXT_CONFIG__ || {
    toolbarMode: "none",
    // mediaMaxSize: 240, // mobile; Flutter desktop injects 320
    // theme: "light", // Flutter injects the effective brightness ("light"|"dark")
    // locale: "en",
  };

  // 2) Transport factory — required in production (runtime fail-fast if missing).
  window.__TG_RICHTEXT_CREATE_TRANSPORT__ = function createTgRichTextTransport() {
    var listeners = [];
    var destroyed = false;

    function deliver(message) {
      if (destroyed) {
        return;
      }
      // Copy in case a listener unsubscribes mid-dispatch.
      var snapshot = listeners.slice();
      for (var i = 0; i < snapshot.length; i++) {
        try {
          snapshot[i](message);
        } catch {
          // Isolate listener failures from the bridge.
        }
      }
    }

    // Flutter calls this to push inbound Protocol JSON strings into the host.
    // Canonical name: __TG_RICHTEXT_DELIVER__. Alias kept for older client drafts.
    window.__TG_RICHTEXT_DELIVER__ = deliver;
    window.__TG_RICHTEXT_DELIVER_FROM_FLUTTER__ = deliver;

    return {
      send: function send(message) {
        if (destroyed) {
          throw new Error("TgRichTextBridge transport has been destroyed.");
        }
        // webview_flutter: JavascriptChannel(name: 'TgRichTextBridge', ...)
        if (
          typeof TgRichTextBridge === "undefined" ||
          typeof TgRichTextBridge.postMessage !== "function"
        ) {
          throw new Error(
            "TgRichTextBridge channel is not available. Register JavascriptChannel before load.",
          );
        }
        TgRichTextBridge.postMessage(message);
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
        } catch {
          window.__TG_RICHTEXT_DELIVER__ = undefined;
        }
      },
    };
  };
})();
