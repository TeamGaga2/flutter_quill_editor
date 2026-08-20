import 'package:flutter_quill_editor/bridge/transport_bootstrap.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  group('In-Web Desktop Chrome toolbarMode (Host Capability Wire seam)', () {
    test('Desktop Rich Text Surfaces select desktop Toolbar Mode', () {
      expect(
        richTextWebToolbarModeFor(isDesktopRichTextSurface: true),
        'desktop',
      );
      expect(
        richTextWebToolbarModeFor(isDesktopRichTextSurface: false),
        'none',
      );
    });

    test('Composition Title is requested independently of toolbar mode', () {
      // ADR-0018: mobile toolbarMode none still shows the Web title.
      expect(kRichTextWebShowTitleInput, isTrue);

      final mobile = buildRichTextTransportBootstrapJs(
        bridgeToken: 'tok',
        toolbarMode: 'none',
        showTitleInput: true,
      );
      expect(mobile, contains('toolbarMode: "none"'));
      expect(mobile, contains('showTitleInput: true'));

      final desktop = buildRichTextTransportBootstrapJs(
        bridgeToken: 'tok',
        toolbarMode: 'desktop',
        showTitleInput: true,
      );
      expect(desktop, contains('toolbarMode: "desktop"'));
      expect(desktop, contains('showTitleInput: true'));
    });

    test('platform layout class is owned by the runtime, not the bootstrap', () {
      // ADR 0002: mount-editor prepareShell derives tg-webview-layout-mobile /
      // -desktop from toolbarMode; the bootstrap must not re-apply it.
      final js = buildRichTextTransportBootstrapJs(
        bridgeToken: 'tok',
        toolbarMode: 'desktop',
      );
      expect(js, isNot(contains('tg-webview-layout-mobile')));
      expect(js, isNot(contains('tg-webview-layout-desktop')));
    });

    test('bootstrap bakes desktop Toolbar Mode when selected', () {
      final js = buildRichTextTransportBootstrapJs(
        bridgeToken: 'tok',
        toolbarMode: 'desktop',
      );

      expect(js, contains('toolbarMode: "desktop"'));
      expect(js, isNot(contains('toolbarMode: "none"')));
    });

    test('host style no longer pins toolbar/typography — runtime CSS owns them', () {
      // ADR 0002: stable visual rules (toolbar chrome, title, body T, headings,
      // lists, quotes, links, nodes, scrollbars) live only in the runtime
      // bundle CSS. The bootstrap must not duplicate them.
      final js = buildRichTextTransportBootstrapJs(
        bridgeToken: 'tok',
        toolbarMode: 'desktop',
      );

      expect(js, isNot(contains('.tg-webview-toolbar{')));
      expect(js, isNot(contains('.ql-editor p{')));
      expect(js, isNot(contains('.ql-editor h1{')));
      expect(js, isNot(contains('blockquote')));
      expect(js, isNot(contains('.ql-indent-1')));
      expect(js, isNot(contains('.tgg-mention{')));
      expect(js, isNot(contains('.tgg-channel{')));
      expect(js, isNot(contains('.ql-editor.ql-blank:before{')));
      expect(js, isNot(contains('::-webkit-scrollbar')));
      expect(js, isNot(contains('scrollbar-width')));
      expect(js, isNot(contains('--tgg-body-text')));
      expect(js, isNot(contains('--tgg-fill10')));
      // Title input / wrap may only appear inside the retained dynamic shell
      // background sync — never with stable typography declarations.
      expect(js, isNot(contains('font-size:20px')));
      expect(js, isNot(contains('.tg-webview-title-input::placeholder')));
      expect(js, isNot(contains('.tg-webview-title-wrap{margin')));
    });
  });

  group('buildRichTextTransportBootstrapJs', () {
    test('bakes the dark theme into the injected config', () {
      final js = buildRichTextTransportBootstrapJs(
        bridgeToken: 'tok',
        theme: 'dark',
        toolbarMode: 'none',
      );

      expect(js, contains('theme: "dark"'));
      expect(js, contains('toolbarMode: "none"'));
    });

    test('defaults to the light theme', () {
      final js = buildRichTextTransportBootstrapJs(bridgeToken: 'tok');

      expect(js, contains('theme: "light"'));
    });

    test('bakes body placeholder into CONFIG (Flutter is source of truth)', () {
      final defaultJs = buildRichTextTransportBootstrapJs(bridgeToken: 'tok');
      final localized = buildRichTextTransportBootstrapJs(
        bridgeToken: 'tok',
        placeholder: '输入正文...',
      );

      expect(defaultJs, contains('placeholder: "Enter text"'));
      expect(localized, contains('placeholder: "输入正文..."'));
      // Must not prefer a stale existing.placeholder over host inject.
      expect(localized, isNot(contains('existing.placeholder')));
    });

    test('host editor style syncs only dynamic shell backgrounds', () {
      final js = buildRichTextTransportBootstrapJs(bridgeToken: 'tok', theme: 'dark');

      // The host still owns the page background (ADR 0001): concrete shell
      // hex with !important so the bundle's transparent defaults never reveal
      // WKWebView's white canvas.
      expect(js, contains('html,body{background:#ffffff!important}'));
      expect(js, contains('.tg-webview-root{background:#ffffff!important}'));
      expect(js, contains('.tg-webview-editor-root{background:#ffffff!important}'));
      expect(
        js,
        contains('.tg-webview-editor-root .tg-richtext-host-editor{background:#ffffff!important}'),
      );
      expect(js, contains('.tg-webview-editor-root .ql-editor{background:#ffffff!important}'));
      expect(js, contains('.tg-webview-title-wrap{background:#ffffff!important}'));
      expect(js, contains('.tg-webview-title-input{background:#ffffff!important}'));

      // No content color tokens: stable colors come from the bundle (ADR 0002).
      expect(js, isNot(contains('var(--tgg-')));
    });

    test('bootstrap applies the theme class on html', () {
      final dark = buildRichTextTransportBootstrapJs(bridgeToken: 'tok', theme: 'dark');
      final light = buildRichTextTransportBootstrapJs(bridgeToken: 'tok', theme: 'light');

      expect(dark, contains('classList.add("tg-theme-dark")'));
      expect(dark, contains('classList.remove("tg-theme-dark", "tg-theme-light")'));
      expect(light, contains('classList.add("tg-theme-light")'));
    });

    test('bootstrap no longer ships stable scrollbar chrome', () {
      // Scrollbar rules are stable visuals owned by runtime CSS (ADR 0002).
      final js = buildRichTextTransportBootstrapJs(bridgeToken: 'tok');

      expect(js, isNot(contains('::-webkit-scrollbar')));
      expect(js, isNot(contains('scrollbar-width')));
      expect(js, isNot(contains('scrollbar-color')));
      expect(js, isNot(contains('-webkit-appearance:none!important')));
    });

    test('keeps the transport factory contract', () {
      final js = buildRichTextTransportBootstrapJs(bridgeToken: 'tok');

      expect(js, contains('window.__TG_RICHTEXT_CREATE_TRANSPORT__'));
      expect(js, contains('TgRichTextBridge.postMessage'));
    });

    test('denies window.open at the JS layer regardless of backend', () {
      final js = buildRichTextTransportBootstrapJs(bridgeToken: 'tok');

      expect(js, contains('window.open = function () { return null; };'));
    });

    test('wraps outbound messages in a capability envelope carrying the token', () {
      final js = buildRichTextTransportBootstrapJs(bridgeToken: 'super-secret-token');

      expect(js, contains('super-secret-token'));
      expect(js, contains('JSON.stringify({ v: 1, t: BRIDGE_TOKEN, p: message })'));
      expect(js, contains('TgRichTextBridge.postMessage(envelope)'));
    });

    test(
      'routes outbound messages through the InAppWebView handler on the Windows backend',
      () {
        final js = buildRichTextTransportBootstrapJs(
          bridgeToken: 'tok',
          bridgeChannelKind: RichTextBridgeChannelKind.inAppWebViewHandler,
        );

        expect(
          js,
          contains('window.flutter_inappwebview.callHandler("TgRichTextBridge", envelope)'),
        );
        expect(js, isNot(contains('TgRichTextBridge.postMessage(envelope)')));
      },
    );

    test('bakes showCloseButton into injected config', () {
      final defaultJs = buildRichTextTransportBootstrapJs(bridgeToken: 'tok');
      expect(defaultJs, contains('showCloseButton: true'));

      final hiddenJs = buildRichTextTransportBootstrapJs(
        bridgeToken: 'tok',
        showCloseButton: false,
      );
      expect(hiddenJs, contains('showCloseButton: false'));
    });
  });
}
