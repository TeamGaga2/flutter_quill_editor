import 'package:flutter_quill_editor/host/web_asset_resolver.dart';

/// VM / non-web stub implementation.
Uri resolveWebAssetUri(String assetPath) {
  return resolveAssetUriAgainstBase(Uri.base.toString(), assetPath);
}
