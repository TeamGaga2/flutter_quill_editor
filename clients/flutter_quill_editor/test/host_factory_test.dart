import 'package:flutter_quill_editor/host/richtext_webview_host_factory.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  group('selectRichTextWebViewHostKind', () {
    test('selects the Windows InAppWebView host when Platform.isWindows is true', () {
      final kind = selectRichTextWebViewHostKind(isWindowsOverride: true, isWebOverride: false);

      expect(kind, RichTextWebViewHostKind.windowsInAppWebView);
    });

    test('selects the webview_flutter host when Platform.isWindows is false', () {
      final kind = selectRichTextWebViewHostKind(isWindowsOverride: false, isWebOverride: false);

      expect(kind, RichTextWebViewHostKind.webViewFlutter);
    });

    test('selects the web iframe host when running on Flutter Web', () {
      final kind = selectRichTextWebViewHostKind(isWebOverride: true);

      expect(kind, RichTextWebViewHostKind.webIframe);
    });

    test('falls back to the real Platform.isWindows when no override is given', () {
      // The test host running this suite is never Windows / Web.
      final kind = selectRichTextWebViewHostKind(isWebOverride: false);

      expect(kind, RichTextWebViewHostKind.webViewFlutter);
    });
  });
}
