import 'package:flutter_quill_editor/host/web_browser_preflight_stub.dart'
    if (dart.library.html) 'package:flutter_quill_editor/host/web_browser_preflight_web.dart'
    as impl;

/// Result of Flutter Web editor capability probes (plan §12 / ADR-0011).
class WebBrowserPreflightResult {
  const WebBrowserPreflightResult.ok() : ok = true, reason = null;

  const WebBrowserPreflightResult.failed(this.reason) : ok = false;

  final bool ok;
  final String? reason;
}

/// Probes MessageChannel + IndexedDB Blob round-trip before mounting the iframe.
Future<WebBrowserPreflightResult> runWebBrowserPreflight() => impl.runWebBrowserPreflight();
