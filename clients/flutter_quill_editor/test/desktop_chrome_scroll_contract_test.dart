import 'dart:io';

import 'package:flutter_test/flutter_test.dart';

/// Regression: on macOS WKWebView, Enter on the last body line must scroll only
/// the Editor Surface — not shove In-Web Desktop Chrome (format toolbar + title)
/// out of the viewport.
///
/// Root cause fixed in flutter_quill_editor `apps/webview-runtime/src/style.css`:
/// - shell column uses overflow:clip so Quill scrollRectIntoView cannot scrollTop it
/// - `.tg-richtext-host-editor` is the sole body scrollport (no height:100% with
///   toolbar/title siblings)
/// - `.ql-editor` does not form a nested overflow:auto scrollport
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

  test('shell chrome is not a scroll container', () {
    // lightningcss may emit overflow:clip alone (drops redundant hidden).
    expect(css, contains('.tg-webview-editor-root{'));
    expect(css, contains('overflow:clip'));
    expect(css, contains('.tg-webview-root{'));
  });

  test('host editor is sole body scrollport without height:100%', () {
    final match = RegExp(
      r'\.tg-webview-editor-root \.tg-richtext-host-editor\{[^}]+\}',
    ).firstMatch(css);
    expect(match, isNotNull);
    final rule = match!.group(0)!;
    expect(rule, contains('overflow:auto'));
    // Bare height:100% (not min-height:100%) would overflow chrome siblings.
    expect(rule.contains(RegExp('(?<!min-)height:100%')), isFalse);
    expect(rule, contains('min-height:0'));
  });

  test('ql-editor grows with content and does not nest overflow:auto', () {
    final match = RegExp(
      r'\.tg-webview-editor-root \.ql-editor\{[^}]+\}',
    ).firstMatch(css);
    expect(match, isNotNull);
    final rule = match!.group(0)!;
    expect(rule, contains('height:auto'));
    expect(rule, contains('overflow:visible'));
    expect(rule.contains(RegExp('(?<!min-)height:100%')), isFalse);
  });

  test('ql-container does not override host min-height:0 (same DOM node)', () {
    // Quill adds .ql-container onto .tg-richtext-host-editor. A later
    // min-height:100% would win over host min-height:0 and re-break flex.
    final match = RegExp(
      r'\.tg-webview-editor-root \.ql-container\{[^}]+\}',
    ).firstMatch(css);
    expect(match, isNotNull);
    final rule = match!.group(0)!;
    expect(rule, isNot(contains('min-height:100%')));
    expect(rule.contains(RegExp('(?<!min-)height:100%')), isFalse);
  });
}
