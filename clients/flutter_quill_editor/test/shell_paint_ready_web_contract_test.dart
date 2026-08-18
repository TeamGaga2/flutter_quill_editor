import 'dart:io';

import 'package:flutter_test/flutter_test.dart';

/// Regression contract: Flutter Web iframe never fires onPageStarted /
/// onPageFinished, so the shell paint cover must be lifted from
/// `_loadWebIframeRuntime` after `initializeRuntime` — otherwise title/body
/// stay invisible while typing and send still work underneath the ColoredBox.
void main() {
  test('web iframe load path marks shell paint ready after initializeRuntime', () {
    final source = File('lib/widget/richtext_webview.dart').readAsStringSync();

    final webLoadStart = source.indexOf('Future<void> _loadWebIframeRuntime(');
    expect(webLoadStart, isNonNegative);
    final webLoadEnd = source.indexOf(
      '\n  @override\n  void dispose()',
      webLoadStart,
    );
    expect(webLoadEnd, greaterThan(webLoadStart));
    final webLoad = source.substring(webLoadStart, webLoadEnd);

    expect(webLoad, contains('initializeRuntime'));
    // Must lift the cover here — web iframe never gets pageStarted/Finished.
    expect(webLoad, contains('_shellPaintReady = true'));
    expect(webLoad, contains('onPageStarted/onPageFinished'));

    expect(source, contains("ValueKey<String>('richtext-shell-paint-cover')"));
  });

  test('theme sync updates the native WebView background with the shell token', () {
    final source = File('lib/widget/richtext_webview.dart').readAsStringSync();
    final syncStart = source.indexOf('Future<void> _syncThemeToWebView(');
    expect(syncStart, isNonNegative);
    final syncEnd = source.indexOf('\n  /// CSS hex for', syncStart);
    expect(syncEnd, greaterThan(syncStart));
    final sync = source.substring(syncStart, syncEnd);

    expect(sync, contains('await host.setBackgroundColor(shellColor);'));
  });
}
