import 'package:flutter_quill_editor/host/web_browser_preflight.dart';

/// VM / native: Flutter Web preflight is not required.
Future<WebBrowserPreflightResult> runWebBrowserPreflight() async {
  return const WebBrowserPreflightResult.ok();
}
