import 'package:flutter_quill_editor/host/richtext_webview_host.dart';
import 'package:flutter_quill_editor/host/runtime_manifest.dart';
import 'package:flutter/widgets.dart';

/// Non-web stub — factory never constructs this when `dart.library.html` is absent.
class WebIframeRichTextHost extends RichTextWebViewHost {
  WebIframeRichTextHost({
    required super.callbacks,
    required String capabilityToken,
    RichTextRuntimeManifest manifest = kRichTextRuntimeManifest,
  }) : _manifest = manifest,
       _capabilityToken = capabilityToken {
    throw UnsupportedError('WebIframeRichTextHost is only available on Flutter Web.');
  }

  // Ignore unused fields — present so the stub mirrors the web constructor.
  // ignore: unused_field
  final RichTextRuntimeManifest _manifest;
  // ignore: unused_field
  final String _capabilityToken;

  @override
  Future<void> get whenSurfaceReady => Future<void>.error(
    UnsupportedError('WebIframeRichTextHost is only available on Flutter Web.'),
  );

  @override
  Widget buildSurface() => const SizedBox.expand();

  @override
  Future<void> loadUrl(Uri url) async {
    throw UnsupportedError('WebIframeRichTextHost is only available on Flutter Web.');
  }

  @override
  Future<void> deliverProtocol(String protocolJson) async {
    throw UnsupportedError('WebIframeRichTextHost is only available on Flutter Web.');
  }

  @override
  Future<void> runJavaScript(String script) async {
    throw UnsupportedError('WebIframeRichTextHost is only available on Flutter Web.');
  }

  @override
  Future<void> setBackgroundColor(Color color) async {}

  @override
  Future<void> setInspectable(bool inspectable) async {}

  @override
  Future<void> wakeEditingSession({bool keepTitle = false}) async {}

  @override
  Future<void> initializeRuntime(Map<String, Object?> config) async {
    throw UnsupportedError('WebIframeRichTextHost is only available on Flutter Web.');
  }

  @override
  Future<void> dispose() async {}
}
