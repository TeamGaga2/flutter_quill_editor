import 'package:flutter_quill_editor/host/web_asset_resolver.dart';
import 'package:web/web.dart' as web;

/// Web implementation resolving assets relative to `document.baseURI`
/// (which adheres to `<base href="...">` and does not drift with HTML5 history routing).
Uri resolveWebAssetUri(String assetPath) {
  final baseStr = web.document.baseURI;
  if (baseStr.isNotEmpty) {
    return resolveAssetUriAgainstBase(baseStr, assetPath);
  }
  final origin = web.window.location.origin;
  return resolveAssetUriAgainstBase(origin, assetPath);
}
