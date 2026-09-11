import 'package:flutter_quill_editor/host/web_asset_resolver_stub.dart'
    if (dart.library.js_interop) 'package:flutter_quill_editor/host/web_asset_resolver_web.dart'
    if (dart.library.html) 'package:flutter_quill_editor/host/web_asset_resolver_web.dart'
    as impl;

/// Normalizes [baseUriString] ensuring a trailing slash and resolves [assetPath] against it.
Uri resolveAssetUriAgainstBase(String baseUriString, String assetPath) {
  final baseUri = baseUriString.isNotEmpty ? Uri.parse(baseUriString) : Uri.parse('/');
  final normalizedPath = baseUri.path.endsWith('/') ? baseUri.path : '${baseUri.path}/';
  final normalizedBase = baseUri.replace(path: normalizedPath);
  return normalizedBase.resolve(assetPath);
}

/// Resolves a web asset path against the document's `<base href>` (or origin fallback),
/// rather than `Uri.base` (which reflects the current route path in Path URL strategy).
Uri resolveWebAssetUri(String assetPath) => impl.resolveWebAssetUri(assetPath);
