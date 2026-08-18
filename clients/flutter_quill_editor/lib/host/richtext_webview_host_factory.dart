import 'package:flutter_quill_editor/host/platform_is_windows_stub.dart'
    if (dart.library.io) 'package:flutter_quill_editor/host/platform_is_windows_io.dart'
    as platform_is_windows;
import 'package:flutter_quill_editor/host/richtext_webview_host.dart';
import 'package:flutter_quill_editor/host/runtime_manifest.dart';
import 'package:flutter_quill_editor/host/web_iframe_richtext_host_stub.dart'
    if (dart.library.html) 'package:flutter_quill_editor/host/web_iframe_richtext_host_web.dart'
    as web_iframe;
import 'package:flutter_quill_editor/host/webview_flutter_richtext_host.dart';
import 'package:flutter/foundation.dart';

/// Which [RichTextWebViewHost] backend to use for this platform.
enum RichTextWebViewHostKind {
  /// Android / iOS / macOS.
  webViewFlutter,

  /// Windows.
  windowsInAppWebView,

  /// Flutter Web same-origin iframe.
  webIframe,
}

/// Host-provided Windows backend factory.
///
/// The package ships `webview_flutter` (Android / iOS / macOS) and iframe
/// (Flutter Web) hosts but deliberately carries no Windows / InAppWebView
/// code. A Windows host must register a creator (e.g. a closure around the
/// app's `createWindowsRichTextWebViewHost`); without one, Windows host
/// creation fails with [RichTextWebViewHostCreationException].
typedef RichTextWindowsHostCreator =
    Future<RichTextWebViewHost> Function({required RichTextWebViewHostCallbacks callbacks});

/// Pure host-kind selection — safe to unit test without touching `dart:io`
/// or creating any WebView (see `host_factory_test.dart`).
///
/// [isWindowsOverride] / [isWebOverride] exist only for tests; production
/// callers should omit them.
RichTextWebViewHostKind selectRichTextWebViewHostKind({
  bool? isWindowsOverride,
  bool? isWebOverride,
}) {
  final isWeb = isWebOverride ?? kIsWeb;
  if (isWeb) {
    return RichTextWebViewHostKind.webIframe;
  }
  final isWindows = isWindowsOverride ?? platform_is_windows.platformIsWindows();
  return isWindows
      ? RichTextWebViewHostKind.windowsInAppWebView
      : RichTextWebViewHostKind.webViewFlutter;
}

/// Creates the [RichTextWebViewHost] appropriate for the current platform.
///
/// Windows additionally requires the host app to register a
/// [RichTextWindowsHostCreator] (runtime detection and the shared WebView2
/// environment live in the host app):
/// - No registered creator → throws [RichTextWebViewHostCreationException]
///   with [RichTextWebViewFailureStage.webViewCreation].
///
/// Never returns a partially-constructed host; callers can go straight from
/// a caught [RichTextWebViewHostCreationException] to the failed state.
Future<RichTextWebViewHost> createRichTextWebViewHost({
  required RichTextWebViewHostCallbacks callbacks,
  RichTextWebViewHostKind? kindOverride,
  RichTextRuntimeManifest runtimeManifest = kRichTextRuntimeManifest,
  String? capabilityToken,
  RichTextWindowsHostCreator? windowsHostCreator,
}) async {
  final kind = kindOverride ?? selectRichTextWebViewHostKind();
  switch (kind) {
    case RichTextWebViewHostKind.webViewFlutter:
      return WebViewFlutterRichTextHost(callbacks: callbacks);
    case RichTextWebViewHostKind.windowsInAppWebView:
      final creator = windowsHostCreator;
      if (creator == null) {
        throw RichTextWebViewHostCreationException(
          const RichTextWebViewFailure(
            stage: RichTextWebViewFailureStage.webViewCreation,
            message: 'Windows host creator not registered — provide '
                'RichTextWebView.windowsHostCreator (e.g. a '
                'flutter_inappwebview/WebView2 backend).',
          ),
        );
      }
      return creator(callbacks: callbacks);
    case RichTextWebViewHostKind.webIframe:
      final token = capabilityToken;
      if (token == null || token.isEmpty) {
        throw RichTextWebViewHostCreationException(
          const RichTextWebViewFailure(
            stage: RichTextWebViewFailureStage.webViewCreation,
            message: 'WebIframeRichTextHost requires a capability token.',
          ),
        );
      }
      return web_iframe.WebIframeRichTextHost(
        callbacks: callbacks,
        manifest: runtimeManifest,
        capabilityToken: token,
      );
  }
}
