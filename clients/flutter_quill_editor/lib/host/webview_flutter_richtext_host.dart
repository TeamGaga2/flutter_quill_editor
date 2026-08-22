import 'dart:async';
import 'dart:convert';

import 'package:flutter_quill_editor/bridge/transport_bootstrap.dart';
import 'package:flutter_quill_editor/host/richtext_webview_host.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:webview_flutter/webview_flutter.dart';
import 'package:webview_flutter_android/webview_flutter_android.dart';
import 'package:webview_flutter_wkwebview/webview_flutter_wkwebview.dart';

/// Android / iOS / macOS [RichTextWebViewHost] built on `webview_flutter`.
///
/// This is a direct extraction of what `RichTextWebView` used to do inline —
/// behavior is unchanged, only relocated behind the host contract so the
/// shared orchestration layer no longer imports `webview_flutter` types.
class WebViewFlutterRichTextHost extends RichTextWebViewHost {
  WebViewFlutterRichTextHost({required super.callbacks}) {
    _controller = _createController();
    _wireController(_controller);
    _surfaceReady.complete();
  }

  late final WebViewController _controller;
  final Completer<void> _surfaceReady = Completer<void>();

  @override
  Future<void> get whenSurfaceReady => _surfaceReady.future;

  /// Origin (`scheme://host:port`) navigation is allowed to stay within.
  /// Set once [loadUrl] is called; this host is recreated per retry
  /// generation, so a single origin per instance is correct.
  Uri? _allowedOrigin;

  static WebViewController _createController() {
    late final PlatformWebViewControllerCreationParams params;
    if (WebViewPlatform.instance is WebKitWebViewPlatform) {
      params = WebKitWebViewControllerCreationParams(
        allowsInlineMediaPlayback: true,
        mediaTypesRequiringUserAction: const <PlaybackMediaTypes>{},
      );
    } else {
      params = const PlatformWebViewControllerCreationParams();
    }
    return WebViewController.fromPlatformCreationParams(params);
  }

  void _wireController(WebViewController controller) {
    controller
      ..setJavaScriptMode(JavaScriptMode.unrestricted)
      ..enableZoom(false)
      ..addJavaScriptChannel(
        kTgRichTextBridgeChannel,
        onMessageReceived: (message) {
          if (message.message.isEmpty) return;
          callbacks.onRawBridgeMessage(message.message);
        },
      )
      ..addJavaScriptChannel(
        kTgPointerGateChannel,
        onMessageReceived: (_) => callbacks.onPointerGateOutsidePointer(),
      )
      ..setNavigationDelegate(
        NavigationDelegate(
          onPageStarted: (url) => callbacks.onPageStarted(Uri.tryParse(url)),
          onPageFinished: (url) => callbacks.onPageFinished(Uri.tryParse(url)),
          onNavigationRequest: _decideNavigation,
          onWebResourceError: _onWebResourceError,
        ),
      );

    if (controller.platform case final AndroidWebViewController android) {
      if (kDebugMode) {
        AndroidWebViewController.enableDebugging(true);
      }
      unawaited(android.setMediaPlaybackRequiresUserGesture(false));
      // Needed when falling back to file:// loads of local runtime files.
      unawaited(android.setAllowFileAccess(true));
    } else if (controller.platform case final WebKitWebViewController webkit) {
      if (kDebugMode) {
        webkit.setInspectable(true);
      }
      if (defaultTargetPlatform == TargetPlatform.iOS) {
        unawaited(webkit.setAllowsBackForwardNavigationGestures(false));
        unawaited(webkit.setOverScrollMode(WebViewOverScrollMode.never));
      }
    }
  }

  NavigationDecision _decideNavigation(NavigationRequest request) {
    final origin = _allowedOrigin;
    final requestUri = Uri.tryParse(request.url);
    if (origin == null || requestUri == null) {
      return NavigationDecision.prevent;
    }
    final decision = evaluateMainFrameNavigation(
      requestUrl: requestUri,
      allowedOrigin: origin,
    );
    if (decision == RichTextWebViewNavigationDecision.allow) {
      return NavigationDecision.navigate;
    }
    callbacks.onExternalNavigation(requestUri);
    return NavigationDecision.prevent;
  }

  void _onWebResourceError(WebResourceError error) {
    // Favicon / optional subresources must not fail the whole surface.
    if (error.isForMainFrame != true) return;
    callbacks.onMainFrameFailure(
      RichTextWebViewFailure(
        stage: RichTextWebViewFailureStage.navigation,
        message: error.description,
        diagnostics: <String, String>{
          'errorCode': '${error.errorCode}',
          'errorType': '${error.errorType}',
        },
      ),
    );
  }

  @override
  Widget buildSurface() => WebViewWidget(controller: _controller);

  @override
  Future<void> loadUrl(Uri url) async {
    _allowedOrigin = url.replace(path: '', query: '', fragment: '');
    await _controller.loadRequest(url);
  }

  @override
  Future<void> deliverProtocol(String protocolJson) async {
    final literal = jsonEncode(protocolJson);
    await runJavaScript('''
(function () {
  if (typeof window.__TG_RICHTEXT_DELIVER__ !== "function") {
    throw new Error(
      "TG_RICHTEXT_DELIVER_MISSING: host transport is not mounted. " +
        "Wait for ready / ensure CREATE_TRANSPORT ran before commands."
    );
  }
  window.__TG_RICHTEXT_DELIVER__($literal);
})();
''');
  }

  @override
  Future<void> runJavaScript(String script) => _controller.runJavaScript(script);

  @override
  Future<void> setBackgroundColor(Color color) async {
    // macOS WKWebView has no scrollView API; shell color is instead painted
    // via early HTML/CSS (see RichTextWebView materialize) on that platform.
    if (defaultTargetPlatform == TargetPlatform.macOS) return;
    await _controller.setBackgroundColor(color);
  }

  @override
  Future<void> setInspectable(bool inspectable) async {
    if (_controller.platform case final WebKitWebViewController webkit) {
      webkit.setInspectable(inspectable);
    }
  }

  @override
  Future<void> wakeEditingSession({bool keepTitle = false}) async {
    await runJavaScript(
      'window.__TG_RICHTEXT_WAKE_EDITING_SESSION__ && '
      'window.__TG_RICHTEXT_WAKE_EDITING_SESSION__(${keepTitle ? 'true' : 'false'});',
    );
  }

  @override
  Future<void> dispose() async {
    await _controller.removeJavaScriptChannel(kTgRichTextBridgeChannel);
    await _controller.removeJavaScriptChannel(kTgPointerGateChannel);
  }
}
