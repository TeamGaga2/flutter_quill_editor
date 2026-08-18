import 'dart:io';

import 'package:flutter_test/flutter_test.dart';

void main() {
  test('prepared runtime keeps the WebKit caret after an emoji embed', () {
    final assets = Directory('assets/richtext_webview_runtime/assets');
    expect(assets.existsSync(), isTrue, reason: 'prepared runtime assets missing');

    final javascript = assets
        .listSync()
        .whereType<File>()
        .where((file) => file.path.endsWith('.js'))
        .map((file) => file.readAsStringSync())
        .join('\n');
    final css = assets
        .listSync()
        .whereType<File>()
        .where((file) => file.path.endsWith('.css'))
        .map((file) => file.readAsStringSync())
        .join('\n');
    final emojiBlotSource = RegExp(
      'static blotName=`emoji`;.*?static value',
      dotAll: true,
    ).firstMatch(javascript)?.group(0);

    // The blot uses a non-void wrapper without Quill's FEFF caret guards. The
    // wrapper must stay editable: WKWebView keeps a logical range after a
    // terminal contenteditable=false inline node, but paints its caret at the
    // far edge of the editor instead of after the emoji.
    expect(
      javascript.contains(
        'static blotName=`emoji`;static tagName=`span`;static className=`tgg-emoji`',
      ),
      isTrue,
      reason: 'emoji must use a non-void span blot so WebKit has an inline caret boundary',
    );
    expect(
      javascript.contains(
        'static blotName=`emoji`;static tagName=`img`;static className=`tgg-emoji`',
      ),
      isFalse,
    );
    expect(
      javascript.contains('querySelectorAll(`span.tgg-emoji[data-emoji-id]`)'),
      isTrue,
    );
    expect(
      emojiBlotSource?.contains('setAttribute(`contenteditable`,`false`)'),
      isFalse,
      reason: 'emoji wrapper must stay editable so WKWebView paints the terminal caret',
    );
    expect(css.contains('.tg-webview-editor-root .tgg-emoji img{'), isTrue);
    expect(css.contains('.tg-webview-editor-root img.tgg-emoji{'), isFalse);
  });
}
