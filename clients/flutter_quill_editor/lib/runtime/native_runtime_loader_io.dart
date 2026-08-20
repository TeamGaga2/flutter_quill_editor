import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:flutter_quill_editor/bridge/transport_bootstrap.dart';
import 'package:flutter_quill_editor/emoji_assets.dart';
import 'package:flutter_quill_editor/media/local_media_registry.dart';
import 'package:flutter_quill_editor/runtime/native_runtime_loader.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';
import 'package:path/path.dart' as p;
import 'package:path_provider/path_provider.dart';

const String _kRuntimeAssetDir =
    'packages/flutter_quill_editor/assets/richtext_webview_runtime';
const _kMaterializeStampName = '.materialize-stamp';

/// Real implementation — Android / iOS / macOS / Windows.
NativeRuntimeLoader createNativeRuntimeLoader() => IoNativeRuntimeLoader();

/// Copies the packaged runtime + emoji assets into an app-support cache
/// directory and serves them over a loopback `http://127.0.0.1` server.
///
/// Android WebView often fails `loadFlutterAsset` for multi-file Vite apps
/// (relative `type=module` + CORS/`crossorigin`), so `RichTextWebView` prefers
/// this loopback server over serving straight from Flutter assets.
class IoNativeRuntimeLoader implements NativeRuntimeLoader {
  Directory? _runtimeDir;
  HttpServer? _server;

  @override
  Future<void> materializeRuntimeToCache({
    required String theme,
    required String? shellBackgroundColor,
    required String bridgeToken,
    required String nonce,
    required RichTextBridgeChannelKind bridgeChannelKind,
    required List<RichTextEmojiDefinition> emojiDefinitions,
    required int mediaMaxSize,
    required String toolbarMode,
    required bool showTitleInput,
    bool showCloseButton = true,
    String? titlePlaceholder,
    String? placeholder,
  }) async {
    final runtimeDir = await _materializeRuntimeToCache(
      theme: theme,
      shellBgCss: shellBackgroundColor,
      bridgeToken: bridgeToken,
      nonce: nonce,
      bridgeChannelKind: bridgeChannelKind,
      emojiDefinitions: emojiDefinitions,
      mediaMaxSize: mediaMaxSize,
      toolbarMode: toolbarMode,
      showTitleInput: showTitleInput,
      showCloseButton: showCloseButton,
      titlePlaceholder: titlePlaceholder,
      placeholder: placeholder,
    );
    final indexFile = File('${runtimeDir.path}/index.html');
    if (!indexFile.existsSync()) {
      throw StateError('Runtime index missing at ${indexFile.path}');
    }
    _runtimeDir = runtimeDir;
  }

  @override
  Future<String> startLocalServer(LocalMediaRegistry mediaRegistry) async {
    final runtimeDir = _runtimeDir;
    if (runtimeDir == null) {
      throw StateError(
        'NativeRuntimeLoader.startLocalServer called before materializeRuntimeToCache.',
      );
    }
    return _startLocalServer(runtimeDir, mediaRegistry);
  }

  @override
  Future<void> close() async {
    await _server?.close(force: true);
    _server = null;
  }

  /// Copy packaged runtime + emoji assets into a stable cache folder.
  ///
  /// When [runtime-version.json] and the emoji stamp match the bundled
  /// assets, skip the wipe/recopy (hundreds of emoji PNGs) and only refresh
  /// the HTML inject for the current theme/shell/capability. Cold
  /// rematerialize on Android was exceeding the 10s command ready timeout
  /// and surfacing editorNotReady.
  Future<Directory> _materializeRuntimeToCache({
    required String theme,
    required String? shellBgCss,
    required String bridgeToken,
    required String nonce,
    required RichTextBridgeChannelKind bridgeChannelKind,
    required List<RichTextEmojiDefinition> emojiDefinitions,
    required int mediaMaxSize,
    required String toolbarMode,
    required bool showTitleInput,
    required bool showCloseButton,
    required String? titlePlaceholder,
    required String? placeholder,
  }) async {
    final support = await getApplicationSupportDirectory();
    final runtimeDir = Directory('${support.path}/richtext_webview_runtime');
    final bundledVersion = await rootBundle.loadString(
      '$_kRuntimeAssetDir/runtime-version.json',
    );
    final emojiKeys = emojiFlutterAssetKeys(emojiDefinitions);
    final stampContents = '${bundledVersion.trim()}\nemojiCount=${emojiKeys.length}\n';

    final cacheValid = await _isRuntimeCacheValid(
      runtimeDir: runtimeDir,
      stampContents: stampContents,
    );

    if (!cacheValid) {
      // Wipe previous materialization so stale hashed JS/CSS cannot be served
      // after a runtime sync (index.html may point at a new bundle hash).
      if (runtimeDir.existsSync()) {
        await runtimeDir.delete(recursive: true);
      }
      await runtimeDir.create(recursive: true);

      // Copy all runtime files listed in AssetManifest (hashed JS/CSS change per build).
      final runtimeKeys = await _listAssetKeysWithPrefix('$_kRuntimeAssetDir/');
      if (runtimeKeys.isEmpty) {
        throw StateError(
          'No assets under $_kRuntimeAssetDir — sync webview-runtime dist first.',
        );
      }
      for (final key in runtimeKeys) {
        // Skip docs / metadata that are not needed at runtime.
        if (key.endsWith('.md') || key.endsWith('README.md')) continue;
        final relative = key.substring('$_kRuntimeAssetDir/'.length);
        if (relative.isEmpty) continue;
        await _copyAssetToFile(key, File(p.join(runtimeDir.path, relative)));
      }

      // Copy TeamGaga emoji stickers so the host can resolve insert_emoji ids.
      final emojiDir = Directory(p.join(runtimeDir.path, 'images', 'emoji'));
      if (!emojiDir.existsSync()) {
        await emojiDir.create(recursive: true);
      }
      for (final key in emojiKeys) {
        final id = p.basenameWithoutExtension(key);
        try {
          await _copyAssetToFile(key, File(p.join(emojiDir.path, '$id.png')));
        } on Object catch (e) {
          if (kDebugMode) {
            debugPrint('RichTextWebView: skip missing emoji asset $key ($e)');
          }
        }
      }

      await File(p.join(runtimeDir.path, _kMaterializeStampName)).writeAsString(
        stampContents,
        flush: true,
      );
    } else if (kDebugMode) {
      debugPrint('RichTextWebView: reusing cached runtime at ${runtimeDir.path}');
    }

    // Always refresh HTML injects (theme / shell / title / bridge capability /
    // CSP nonce) so a cache hit still picks up per-generation values without
    // a full recopy.
    await _patchRuntimeIndexHtml(
      runtimeDir: runtimeDir,
      theme: theme,
      shellBgCss: shellBgCss,
      bridgeToken: bridgeToken,
      nonce: nonce,
      bridgeChannelKind: bridgeChannelKind,
      emojiDefinitions: emojiDefinitions,
      mediaMaxSize: mediaMaxSize,
      toolbarMode: toolbarMode,
      showTitleInput: showTitleInput,
      showCloseButton: showCloseButton,
      titlePlaceholder: titlePlaceholder,
      placeholder: placeholder,
    );

    return runtimeDir;
  }

  Future<bool> _isRuntimeCacheValid({
    required Directory runtimeDir,
    required String stampContents,
  }) async {
    if (!runtimeDir.existsSync()) return false;
    final index = File(p.join(runtimeDir.path, 'index.html'));
    final version = File(p.join(runtimeDir.path, 'runtime-version.json'));
    final stamp = File(p.join(runtimeDir.path, _kMaterializeStampName));
    final emojiDir = Directory(p.join(runtimeDir.path, 'images', 'emoji'));
    if (!index.existsSync() ||
        !version.existsSync() ||
        !stamp.existsSync() ||
        !emojiDir.existsSync()) {
      return false;
    }
    try {
      return await stamp.readAsString() == stampContents;
    } on Object {
      return false;
    }
  }

  Future<void> _patchRuntimeIndexHtml({
    required Directory runtimeDir,
    required String theme,
    required String? shellBgCss,
    required String bridgeToken,
    required String nonce,
    required RichTextBridgeChannelKind bridgeChannelKind,
    required List<RichTextEmojiDefinition> emojiDefinitions,
    required int mediaMaxSize,
    required String toolbarMode,
    required bool showTitleInput,
    required bool showCloseButton,
    required String? titlePlaceholder,
    required String? placeholder,
  }) async {
    // Sanitize HTML + inject classic scripts *before* the deferred module entry.
    // ES modules load asynchronously; without these scripts in index.html the
    // runtime can call CREATE_TRANSPORT before Flutter's onPageStarted inject
    // runs, host mount fails permanently, and every command times out.
    final index = File(p.join(runtimeDir.path, 'index.html'));
    // Prefer the pristine asset when rewriting so repeated patch passes do not
    // stack or depend on previous inject shape.
    var html = await rootBundle.loadString('$_kRuntimeAssetDir/index.html');
    html = html
        .replaceAll(RegExp(r'\s*crossorigin(?:="[^"]*")?'), '')
        .replaceAll('crossorigin', '');

    // Drop previous materialize injections so orientation/config/capability
    // stays current (the pristine asset may also ship a static fallback
    // inline script for tooling/playground use — always strip and replace).
    html = html.replaceAll(
      RegExp(
        r'\s*<script[^>]*>\s*window\.__TG_RICHTEXT_EMOJI_DEFINITIONS__\s*=[\s\S]*?</script>',
      ),
      '',
    );
    html = html.replaceAll(
      RegExp(
        r'\s*<script[^>]*>\s*\(function injectTeamGagaRichTextBridge\(\)[\s\S]*?</script>',
      ),
      '',
    );
    html = html.replaceAll(
      RegExp(r'\s*<style id="tg-richtext-shell-bg">[\s\S]*?</style>'),
      '',
    );
    html = html.replaceAll(
      RegExp(r'\s*<meta[^>]*http-equiv="Content-Security-Policy"[^>]*/?>'),
      '',
    );

    final emojiJs = buildEmojiDefinitionsBootstrapJs(
      definitions: emojiDefinitions,
    );
    final transportJs = buildRichTextTransportBootstrapJs(
      bridgeToken: bridgeToken,
      bridgeChannelKind: bridgeChannelKind,
      mediaMaxSize: mediaMaxSize,
      toolbarMode: toolbarMode,
      showTitleInput: showTitleInput,
      showCloseButton: showCloseButton,
      titlePlaceholder: titlePlaceholder,
      placeholder: placeholder,
      shellBackgroundColor: shellBgCss,
      theme: theme,
    );
    // Blocking style in <head> before module CSS/JS — first paint must match the
    // Flutter shell (otherwise WKWebView / Chromium flash default white).
    final earlyShellStyle = shellBgCss == null
        ? ''
        : '    <style id="tg-richtext-shell-bg">html,body,.tg-webview-root,.tg-webview-title-wrap,.tg-webview-editor-root{background:$shellBgCss!important}</style>\n';
    final csp = _buildContentSecurityPolicy(nonce);
    html = html.replaceFirst(
      '<title>TeamGaga Rich Text</title>',
      '<title>TeamGaga Rich Text</title>\n'
          '    <meta http-equiv="Content-Security-Policy" content="$csp">\n'
          '$earlyShellStyle'
          '    <script nonce="$nonce">$emojiJs</script>\n'
          '    <script nonce="$nonce">$transportJs</script>',
    );
    await index.writeAsString(html, flush: true);
  }

  Future<void> _copyAssetToFile(String assetKey, File out) async {
    final data = await rootBundle.load(assetKey);
    await out.parent.create(recursive: true);
    await out.writeAsBytes(
      data.buffer.asUint8List(data.offsetInBytes, data.lengthInBytes),
      flush: true,
    );
  }

  Future<List<String>> _listAssetKeysWithPrefix(String prefix) async {
    try {
      final jsonStr = await rootBundle.loadString('AssetManifest.json');
      final map = jsonDecode(jsonStr) as Map<String, dynamic>;
      return map.keys.where((k) => k.startsWith(prefix)).toList();
    } on Object {
      // Flutter 3.22+ AssetManifest.bin only — fall through to the
      // AssetManifest API below.
    }

    final manifest = await AssetManifest.loadFromAssetBundle(rootBundle);
    return manifest.listAssets().where((k) => k.startsWith(prefix)).toList();
  }

  /// Serve [runtimeDir] on 127.0.0.1 and return the index URL.
  Future<String> _startLocalServer(Directory runtimeDir, LocalMediaRegistry mediaRegistry) async {
    await _server?.close(force: true);
    final server = await HttpServer.bind(InternetAddress.loopbackIPv4, 0);
    _server = server;

    final rootPath = p.normalize(runtimeDir.path);
    server.listen((request) async {
      try {
        var reqPath = request.uri.path;
        if (reqPath == '/' || reqPath.isEmpty) {
          reqPath = '/index.html';
        }

        if (reqPath.startsWith('/__tg_media__/')) {
          await serveLocalMediaRequest(request, mediaRegistry);
          return;
        }

        // Prevent path traversal outside the runtime root.
        final candidate = p.normalize(
          p.join(rootPath, reqPath.startsWith('/') ? reqPath.substring(1) : reqPath),
        );
        if (candidate != rootPath && !candidate.startsWith('$rootPath${Platform.pathSeparator}')) {
          request.response.statusCode = HttpStatus.forbidden;
          await request.response.close();
          return;
        }
        final file = File(candidate);
        if (!file.existsSync()) {
          request.response.statusCode = HttpStatus.notFound;
          await request.response.close();
          return;
        }
        request.response.headers.contentType = _contentTypeFor(reqPath);
        request.response.headers.set('Cache-Control', 'no-cache');
        // Allow module scripts without CORS friction on loopback.
        request.response.headers.set('Access-Control-Allow-Origin', '*');
        await request.response.addStream(file.openRead());
        await request.response.close();
      } on Object catch (e, st) {
        if (kDebugMode) {
          debugPrint('RichTextWebView local server error: $e\n$st');
        }
        try {
          request.response.statusCode = HttpStatus.internalServerError;
          await request.response.close();
        } on Object {
          // ignore
        }
      }
    });

    return 'http://127.0.0.1:${server.port}/index.html';
  }
}

/// CSP baseline from plan §5.5 — only `self` + this generation's nonce may
/// run script; no frames/objects/forms; media/img stay permissive enough
/// for the runtime's documented legitimate sources.
String _buildContentSecurityPolicy(String nonce) {
  return [
    "default-src 'self'",
    "script-src 'self' 'nonce-$nonce'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: http: https:",
    "media-src 'self' blob: http: https:",
    "font-src 'self' data:",
    "connect-src 'self'",
    "frame-src 'none'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
  ].join('; ');
}

/// Serves one registered local media request. Kept outside the loader class
/// so the HTTP contract can be tested without constructing a full loader.
@visibleForTesting
Future<void> serveLocalMediaRequest(HttpRequest request, LocalMediaRegistry registry) async {
  if (request.method != 'GET' && request.method != 'HEAD') {
    request.response.statusCode = HttpStatus.methodNotAllowed;
    request.response.headers.set('Allow', 'GET, HEAD');
    await request.response.close();
    return;
  }

  final segments = request.uri.pathSegments;
  if (segments.length != 2 || segments.first != '__tg_media__') {
    request.response.statusCode = HttpStatus.notFound;
    await request.response.close();
    return;
  }

  final entry = registry.lookup(segments[1]);
  final path = entry?.path;
  if (entry == null || path == null || path.isEmpty) {
    request.response.statusCode = HttpStatus.notFound;
    await request.response.close();
    return;
  }

  final file = File(path);
  if (!file.existsSync()) {
    request.response.statusCode = HttpStatus.notFound;
    await request.response.close();
    return;
  }

  final length = await file.length();
  var start = 0;
  var end = length - 1;
  final range = request.headers.value(HttpHeaders.rangeHeader);
  if (range != null) {
    final match = RegExp(r'^bytes=(\d*)-(\d*)$').firstMatch(range.trim());
    if (match == null || length == 0) {
      await _respondRangeNotSatisfiable(request, length);
      return;
    }
    final startText = match.group(1)!;
    final endText = match.group(2)!;
    if (startText.isEmpty) {
      final suffixLength = int.tryParse(endText);
      if (suffixLength == null || suffixLength <= 0) {
        await _respondRangeNotSatisfiable(request, length);
        return;
      }
      start = suffixLength >= length ? 0 : length - suffixLength;
    } else {
      start = int.tryParse(startText) ?? -1;
      end = endText.isEmpty ? length - 1 : (int.tryParse(endText) ?? -1);
    }
    if (start < 0 || start >= length || end < start) {
      await _respondRangeNotSatisfiable(request, length);
      return;
    }
    if (end >= length) end = length - 1;
    request.response.statusCode = HttpStatus.partialContent;
    request.response.headers.set(
      HttpHeaders.contentRangeHeader,
      'bytes $start-$end/$length',
    );
  }

  request.response.headers.contentType = _contentTypeForMimeOrPath(
    entry.mimeType,
    path,
  );
  request.response.headers.contentLength = end - start + 1;
  request.response.headers.set(HttpHeaders.acceptRangesHeader, 'bytes');
  request.response.headers.set(HttpHeaders.cacheControlHeader, 'no-cache');
  request.response.headers.set(HttpHeaders.accessControlAllowOriginHeader, '*');
  // Closing directly is intentional for empty files: there is no stream body
  // to attach, while Content-Length remains the correct value of zero.
  if (request.method == 'HEAD' || length == 0) {
    await request.response.close();
    return;
  }
  await request.response.addStream(file.openRead(start, end + 1));
  await request.response.close();
}

Future<void> _respondRangeNotSatisfiable(HttpRequest request, int length) async {
  request.response.statusCode = HttpStatus.requestedRangeNotSatisfiable;
  request.response.headers.set(HttpHeaders.contentRangeHeader, 'bytes */$length');
  await request.response.close();
}

ContentType _contentTypeFor(String path) {
  final lower = path.toLowerCase();
  if (lower.endsWith('.html')) {
    return ContentType('text', 'html', charset: 'utf-8');
  }
  if (lower.endsWith('.js') || lower.endsWith('.mjs')) {
    return ContentType('text', 'javascript', charset: 'utf-8');
  }
  if (lower.endsWith('.css')) {
    return ContentType('text', 'css', charset: 'utf-8');
  }
  if (lower.endsWith('.svg')) {
    return ContentType('image', 'svg+xml');
  }
  if (lower.endsWith('.json')) {
    return ContentType('application', 'json', charset: 'utf-8');
  }
  if (lower.endsWith('.png')) {
    return ContentType('image', 'png');
  }
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) {
    return ContentType('image', 'jpeg');
  }
  if (lower.endsWith('.gif')) {
    return ContentType('image', 'gif');
  }
  if (lower.endsWith('.webp')) {
    return ContentType('image', 'webp');
  }
  if (lower.endsWith('.mp4') || lower.endsWith('.m4v')) {
    return ContentType('video', 'mp4');
  }
  if (lower.endsWith('.webm')) {
    return ContentType('video', 'webm');
  }
  if (lower.endsWith('.mov')) {
    return ContentType('video', 'quicktime');
  }
  if (lower.endsWith('.woff2')) {
    return ContentType('font', 'woff2');
  }
  return ContentType.binary;
}

ContentType _contentTypeForMimeOrPath(String? mimeType, String path) {
  if (mimeType != null && mimeType.isNotEmpty) {
    final separator = mimeType.indexOf('/');
    if (separator > 0 && separator < mimeType.length - 1) {
      return ContentType(
        mimeType.substring(0, separator),
        mimeType.substring(separator + 1),
      );
    }
  }
  return _contentTypeFor(path);
}
