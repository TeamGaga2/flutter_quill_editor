import 'dart:io';

import 'package:flutter_test/flutter_test.dart';

/// ADR 0002 contract on the materialized runtime bundle: stable rich-text visual
/// rules live only in the runtime CSS shipped under
/// `app/assets/richtext_webview_runtime` — the Flutter bootstrap only injects
/// runtime state (theme, shell background, copy).
///
/// These assertions pin the acceptance matrix's CSS-expressible half
/// (typography T, H1–H3, node colors, block spacing, content alignment,
/// placeholder origin) against the minified bundle text. Regenerating the
/// assets via `just richtext-runtime-prepare` runs this contract on the exact
/// CSS the App ships.
void main() {
  late String css;

  setUpAll(() {
    final dir = Directory('assets/richtext_webview_runtime/assets');
    expect(dir.existsSync(), isTrue, reason: 'prepared runtime assets missing');
    final cssFiles = dir
        .listSync()
        .whereType<File>()
        .where((f) => f.path.endsWith('.css'))
        .toList();
    expect(cssFiles, isNotEmpty, reason: 'expected mount-editor-*.css in runtime assets');
    css = cssFiles.map((f) => f.readAsStringSync()).join('\n');
  });

  group('token subset (ADR 0002)', () {
    test('ships only the semantic Figma tokens with Light/Dark values', () {
      expect(css, contains('--tgg-schemes-on-surface:#171d19'));
      expect(css, contains('--tgg-schemes-surface-container-low:#f5f5f4'));
      expect(css, contains('--tgg-common-blue:#009dff'));
      expect(css, contains('--tgg-blue-secondary:#0091ed'));
      expect(css, contains('--tgg-primary-01:#009c64'));
      expect(css, contains('--tgg-divider-low:#e3e8e5'));
      expect(
        css,
        contains(
          '--tgg-quote-text:color-mix(in srgb, var(--tgg-schemes-on-surface) 80%, transparent)',
        ),
      );
      expect(
        css,
        contains(
          '--tgg-quote-bar:color-mix(in srgb, var(--tgg-schemes-on-surface) 30%, transparent)',
        ),
      );

      expect(css, contains('--tgg-fill04:#fff'));
      expect(css, contains('--tgg-fill03:#fafafa'));
      expect(css, contains('--tgg-fill01:#e9e9e9'));
      expect(css, contains('--tgg-text01:#121212'));
      expect(css, contains('--tgg-text05:#fff'));
      expect(css, contains('--tgg-schemes-primary:#009c64'));
      expect(css, contains('--tgg-schemes-on-primary:#fff'));
      expect(css, contains('--tgg-schemes-outline-variant:#a0a7a1'));
      expect(css, contains('--tgg-schemes-on-surface-variant:#404942'));
      expect(css, contains('--tgg-primary03:#38c585'));
      expect(css, contains('--tgg-primary04:#88dcb6'));
      expect(css, contains('--tgg-shadow-primary:0px 8px 40px 0px #0003'));
      expect(css, contains('--tgg-scrim-black70:#000000b3'));

      final dark = RegExp(r'html\.tg-theme-dark\{[^}]*\}').firstMatch(css);
      expect(dark, isNotNull);
      final darkRule = dark!.group(0)!;
      expect(darkRule, contains('--tgg-schemes-on-surface:#e4e8e3'));
      expect(darkRule, contains('--tgg-schemes-surface-container-low:#2c302d'));
      expect(darkRule, contains('--tgg-divider-low:#313532'));
      expect(darkRule, contains('--tgg-fill04:#3a3a3a'));
      expect(darkRule, contains('--tgg-fill03:#313131'));
      expect(darkRule, contains('--tgg-fill01:#272727'));
      expect(darkRule, contains('--tgg-text01:#fafafa'));
      expect(darkRule, contains('--tgg-text05:#fff'));
      expect(darkRule, contains('--tgg-schemes-primary:#91d5ac'));
      expect(darkRule, contains('--tgg-schemes-on-primary:#003921'));
      expect(darkRule, contains('--tgg-schemes-outline-variant:#4e5550'));
      expect(darkRule, contains('--tgg-schemes-on-surface-variant:#c0c9c0'));
      expect(darkRule, contains('--tgg-primary03:#009c64'));
      expect(darkRule, contains('--tgg-primary04:#4a8f70'));
    });

    test('paints the editor document with Surface Container Low', () {
      expect(css, contains('background:var(--tgg-schemes-surface-container-low)'));
      expect(
        css,
        contains(
          '.tg-webview-root{background:var(--tgg-schemes-surface-container-low)',
        ),
      );
    });

    test('does not keep per-orientation body text indirection or merged tokens', () {
      expect(css, isNot(contains('--tgg-body-text')));
      expect(css, isNot(contains('--tgg-blue-primary')));
    });
  });

  group('typography (ADR 0002)', () {
    test('body T is 16/24 on mobile and 14/20 on desktop', () {
      final container = RegExp(
        r'\.tg-webview-editor-root \.ql-container\{[^}]*\}',
      ).firstMatch(css);
      expect(container, isNotNull);
      expect(container!.group(0), contains('font-size:16px'));
      expect(container.group(0), contains('line-height:24px'));
      expect(container.group(0), contains('font-weight:400'));
      expect(container.group(0), contains('letter-spacing:0'));
      expect(container.group(0), contains('color:var(--tgg-schemes-on-surface)'));
      expect(container.group(0), contains('PingFang SC'));

      final desktop = RegExp(
        r'\.tg-webview-layout-desktop \.tg-webview-editor-root \.ql-container\{[^}]*\}',
      ).firstMatch(css);
      expect(desktop, isNotNull);
      expect(desktop!.group(0), contains('font-size:14px'));
      expect(desktop.group(0), contains('line-height:20px'));
    });

    test('H1–H3 use Figma px line-heights and On Surface color', () {
      final h1 = RegExp(r'\.tg-webview-editor-root \.ql-editor h1\{[^}]*\}').firstMatch(css);
      expect(h1!.group(0), contains('font-size:28px'));
      expect(h1.group(0), contains('line-height:40px'));
      expect(h1.group(0), contains('color:var(--tgg-schemes-on-surface)'));

      final h2 = RegExp(r'\.tg-webview-editor-root \.ql-editor h2\{[^}]*\}').firstMatch(css);
      expect(h2!.group(0), contains('font-size:24px'));
      expect(h2.group(0), contains('line-height:32px'));

      final h3 = RegExp(r'\.tg-webview-editor-root \.ql-editor h3\{[^}]*\}').firstMatch(css);
      expect(h3!.group(0), contains('font-size:20px'));
      expect(h3.group(0), contains('line-height:28px'));
    });
  });

  group('block spacing (ADR 0002)', () {
    test('every top-level block carries 12px margin-top and no bottom margin', () {
      final shared = RegExp(
        r'\.tg-webview-editor-root \.ql-editor>p,[^}]*\}',
      ).firstMatch(css);
      expect(shared, isNotNull);
      final rule = shared!.group(0)!;
      expect(rule, contains('margin:12px 0 0'));
      expect(rule, contains('>h1'));
      expect(rule, contains('>h2'));
      expect(rule, contains('>h3'));
      expect(rule, contains('>ol'));
      expect(rule, contains('>ul'));

      final image = RegExp(
        r'\.tg-webview-editor-root img\.tgg-image\{[^}]*\}',
      ).firstMatch(css);
      expect(image, isNotNull);
      expect(image!.group(0), contains('margin:12px 0 0'));

      final video = RegExp(
        r'\.tg-webview-editor-root div\.tgg-video\{[^}]*\}',
      ).firstMatch(css);
      expect(video, isNotNull);
      expect(video!.group(0), contains('margin:12px 0 0'));

      expect(css, contains('.tg-webview-editor-root hr.tgg-divider{'));
    });

    test('consecutive quote lines form one top-level block', () {
      final quote = RegExp(
        r'\.tg-webview-editor-root \.ql-editor>blockquote\{[^}]*\}',
      ).firstMatch(css);
      expect(quote, isNotNull);
      expect(quote!.group(0), contains('margin:12px 0 0'));
      expect(quote.group(0), contains('color:var(--tgg-quote-text)'));
      expect(quote.group(0), contains('padding:0 0 0 8px'));
      expect(quote.group(0), contains('border:0'));
      expect(quote.group(0), contains('border-left:3px solid var(--tgg-quote-bar)'));
      expect(quote.group(0), contains('border-radius:0'));
      expect(
        css,
        isNot(contains('.tg-webview-editor-root .ql-editor>blockquote:before{')),
      );

      final consecutiveQuote = RegExp(
        r'\.tg-webview-editor-root \.ql-editor>blockquote\+blockquote\{[^}]*\}',
      ).firstMatch(css);
      expect(consecutiveQuote, isNotNull);
      expect(consecutiveQuote!.group(0), contains('margin-top:0'));
      expect(consecutiveQuote.group(0), isNot(contains('padding-top')));

      final quoteStart = RegExp(
        r'blockquote\.tgg-quote-group-start\{[^}]*\}',
      ).firstMatch(css);
      expect(quoteStart, isNotNull);
      expect(quoteStart!.group(0), contains('border-top-left-radius:2px'));

      final quoteEnd = RegExp(
        r'blockquote\.tgg-quote-group-end\{[^}]*\}',
      ).firstMatch(css);
      expect(quoteEnd, isNotNull);
      expect(quoteEnd!.group(0), contains('border-bottom-left-radius:2px'));
    });

    test('content area pads 0 0 16px 6px without !important', () {
      final editor = RegExp(r'\.tg-webview-editor-root \.ql-editor\{[^}]*\}').firstMatch(css);
      expect(editor, isNotNull);
      expect(editor!.group(0), contains('padding:0 0 16px 6px'));
      expect(editor.group(0), isNot(contains('padding:0 0 16px 6px!important')));
    });

    test('placeholder shares the first block origin (6px / 12px)', () {
      final placeholder = RegExp(
        r'\.tg-webview-editor-root \.ql-editor\.ql-blank:before\{[^}]*\}',
      ).firstMatch(css);
      expect(placeholder, isNotNull);
      expect(placeholder!.group(0), contains('top:12px'));
      expect(placeholder.group(0), contains('left:6px'));
      expect(placeholder.group(0), isNot(contains('!important')));
    });
  });

  group('content alignment (ADR 0002)', () {
    test('mobile body compensates the missing host card inset', () {
      final mobile = RegExp(
        r'\.tg-webview-layout-mobile \.tg-webview-editor-root \.tg-richtext-host-editor\{[^}]*\}',
      ).firstMatch(css);
      expect(mobile, isNotNull);
      expect(mobile!.group(0), contains('padding-left:10px'));
    });

    test('title insets: desktop 10+6, mobile 16 — no legacy mobile top pad', () {
      final base = RegExp(r'\.tg-webview-title-wrap\{[^}]*\}').firstMatch(css);
      expect(base, isNotNull);
      expect(base!.group(0), contains('margin:8px 0 0'));
      expect(base.group(0), contains('padding:0 6px'));

      final mobile = RegExp(
        r'\.tg-webview-layout-mobile \.tg-webview-title-wrap\{[^}]*\}',
      ).firstMatch(css);
      expect(mobile, isNotNull);
      expect(mobile!.group(0), contains('margin:16px 0 0'));
      expect(mobile.group(0), contains('padding:0 16px'));

      expect(css, isNot(contains('padding:10px 16px 0')));
      expect(
        RegExp(r'\.tg-webview-editor-root--with-title\{[^}]*\}').firstMatch(css)!.group(0),
        contains('padding:0'),
      );
    });
  });

  group('node styles (ADR 0002)', () {
    test('Link, Mention and Channel use their own Figma tokens', () {
      expect(css, contains('.tg-webview-editor-root .ql-editor a{color:var(--tgg-common-blue);'));
      expect(css, contains('text-decoration:underline'));
      expect(
        css,
        contains('.tg-webview-editor-root .tgg-mention{color:var(--tgg-blue-secondary)}'),
      );
      expect(css, contains('.tg-webview-editor-root .tgg-channel{color:var(--tgg-primary-01)}'));
    });

    test('Divider uses Divider Low with 0.5px mobile / 1px desktop stroke', () {
      final divider = RegExp(
        r'\.tg-webview-editor-root hr\.tgg-divider\{[^}]*\}',
      ).firstMatch(css);
      expect(divider, isNotNull);
      expect(divider!.group(0), contains('border-top:1px solid var(--tgg-divider-low)'));
      expect(divider.group(0), contains('margin:12px 0 0'));

      final mobile = RegExp(
        r'\.tg-webview-layout-mobile \.tg-webview-editor-root hr\.tgg-divider\{[^}]*\}',
      ).firstMatch(css);
      expect(mobile, isNotNull);
      expect(mobile!.group(0), contains('border-top-width:.5px'));
    });
  });

  group('ownership (ADR 0002)', () {
    test('bundle keeps the stable chrome the bootstrap dropped', () {
      // Scrollbar chrome was migrated from the Flutter inject into the bundle.
      expect(css, contains('scrollbar-width:thin'));
      expect(css, contains('::-webkit-scrollbar-track'));
    });
  });
}
