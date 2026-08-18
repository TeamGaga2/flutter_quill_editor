import 'package:flutter_quill_editor/host/richtext_webview_host.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  group('evaluateMainFrameNavigation', () {
    final allowedOrigin = Uri.parse('http://127.0.0.1:54321');

    test('allows navigation to the same loopback origin', () {
      final decision = evaluateMainFrameNavigation(
        requestUrl: Uri.parse('http://127.0.0.1:54321/index.html'),
        allowedOrigin: allowedOrigin,
      );

      expect(decision, RichTextWebViewNavigationDecision.allow);
    });

    test('allows navigation to a different path/query on the same origin', () {
      final decision = evaluateMainFrameNavigation(
        requestUrl: Uri.parse('http://127.0.0.1:54321/assets/index.js?v=2'),
        allowedOrigin: allowedOrigin,
      );

      expect(decision, RichTextWebViewNavigationDecision.allow);
    });

    test('cancels and hands off navigation to an external https link', () {
      final decision = evaluateMainFrameNavigation(
        requestUrl: Uri.parse('https://example.com/'),
        allowedOrigin: allowedOrigin,
      );

      expect(decision, RichTextWebViewNavigationDecision.cancelAndHandOff);
    });

    test('cancels navigation to a different loopback port', () {
      final decision = evaluateMainFrameNavigation(
        requestUrl: Uri.parse('http://127.0.0.1:9999/index.html'),
        allowedOrigin: allowedOrigin,
      );

      expect(decision, RichTextWebViewNavigationDecision.cancelAndHandOff);
    });

    test('cancels navigation to a different scheme on the same host/port', () {
      final decision = evaluateMainFrameNavigation(
        requestUrl: Uri.parse('https://127.0.0.1:54321/index.html'),
        allowedOrigin: allowedOrigin,
      );

      expect(decision, RichTextWebViewNavigationDecision.cancelAndHandOff);
    });

    test('cancels navigation to a different host', () {
      final decision = evaluateMainFrameNavigation(
        requestUrl: Uri.parse('http://localhost:54321/index.html'),
        allowedOrigin: allowedOrigin,
      );

      expect(decision, RichTextWebViewNavigationDecision.cancelAndHandOff);
    });
  });

  group('shouldAllowPopupOrNewWindow', () {
    test('always denies popups / new windows', () {
      expect(shouldAllowPopupOrNewWindow(), isFalse);
    });
  });
}
