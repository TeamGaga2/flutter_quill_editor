import 'dart:io';

import 'package:flutter_quill_editor/host/web_asset_resolver.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  group('resolveAssetUriAgainstBase', () {
    test('resolves asset relative to root base with trailing slash', () {
      final uri = resolveAssetUriAgainstBase(
        'http://localhost:8080/',
        'assets/packages/flutter_quill_editor/assets/runtime/index.html',
      );
      expect(
        uri.toString(),
        'http://localhost:8080/assets/packages/flutter_quill_editor/assets/runtime/index.html',
      );
    });

    test('resolves asset relative to root base without trailing slash', () {
      final uri = resolveAssetUriAgainstBase(
        'http://localhost:8080',
        'assets/packages/flutter_quill_editor/assets/runtime/index.html',
      );
      expect(
        uri.toString(),
        'http://localhost:8080/assets/packages/flutter_quill_editor/assets/runtime/index.html',
      );
    });

    test('resolves asset relative to subpath base with trailing slash', () {
      final uri = resolveAssetUriAgainstBase(
        'https://example.com/app/',
        'assets/packages/flutter_quill_editor/assets/runtime/index.html',
      );
      expect(
        uri.toString(),
        'https://example.com/app/assets/packages/flutter_quill_editor/assets/runtime/index.html',
      );
    });

    test('resolves asset relative to subpath base without trailing slash', () {
      final uri = resolveAssetUriAgainstBase(
        'https://example.com/app',
        'assets/packages/flutter_quill_editor/assets/runtime/index.html',
      );
      expect(
        uri.toString(),
        'https://example.com/app/assets/packages/flutter_quill_editor/assets/runtime/index.html',
      );
    });

    test('deep routing path is not present when base URI is document base', () {
      // Document base is root '/', but active SPA routing path might be '/channels/123/456'
      const documentBase = 'http://localhost:8080/';
      final uri = resolveAssetUriAgainstBase(
        documentBase,
        'assets/packages/flutter_quill_editor/assets/runtime/index.html',
      );
      expect(
        uri.toString(),
        'http://localhost:8080/assets/packages/flutter_quill_editor/assets/runtime/index.html',
      );
      expect(uri.pathSegments, ['assets', 'packages', 'flutter_quill_editor', 'assets', 'runtime', 'index.html']);
    });

    test('handles empty base string gracefully', () {
      final uri = resolveAssetUriAgainstBase('', 'assets/icon.png');
      expect(uri.toString(), '/assets/icon.png');
    });
  });

  group('resolveWebAssetUri (VM stub)', () {
    test('resolves via VM stub without throwing', () {
      final uri = resolveWebAssetUri('assets/packages/flutter_quill_editor/assets/runtime/index.html');
      expect(uri, isNotNull);
      expect(uri.path, contains('assets/packages/flutter_quill_editor/assets/runtime/index.html'));
    });
  });

  group('richtext_webview contract', () {
    test('richtext_webview does not use Uri.base.resolve for webEntryAssetPath or emoji src', () {
      final source = File('lib/widget/richtext_webview.dart').readAsStringSync();
      expect(source, isNot(contains('Uri.base.resolve(kRichTextRuntimeManifest.webEntryAssetPath)')));
      expect(source, isNot(contains("Uri.base.resolve('assets/")));
      expect(source, contains('resolveWebAssetUri(kRichTextRuntimeManifest.webEntryAssetPath)'));
      expect(source, contains("resolveWebAssetUri('assets/"));
    });
  });
}
