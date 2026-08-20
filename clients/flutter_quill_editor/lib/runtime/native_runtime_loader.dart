import 'package:flutter_quill_editor/bridge/transport_bootstrap.dart';
import 'package:flutter_quill_editor/emoji_assets.dart';
import 'package:flutter_quill_editor/media/local_media_registry.dart';
import 'package:flutter_quill_editor/runtime/native_runtime_loader_stub.dart'
    if (dart.library.io) 'package:flutter_quill_editor/runtime/native_runtime_loader_io.dart'
    as impl;

/// Native-only (Android / iOS / macOS / Windows) runtime materialize +
/// loopback HTTP server for [RichTextWebView].
///
/// Flutter Web loads the vendored iframe entry directly (see
/// `RichTextWebViewState._loadWebIframeRuntime`) and never touches this —
/// keeping `dart:io` (`File`/`Directory`/`HttpServer`) out of the shared
/// widget so it compiles for Flutter Web.
abstract class NativeRuntimeLoader {
  /// Copies the packaged runtime + emoji assets into a stable app-support
  /// cache directory (skipping the wipe/recopy when already up to date) and
  /// patches `index.html` for this generation's theme/shell/bridge values.
  ///
  /// Throws if the runtime assets are missing or the patched index is not
  /// present afterwards.
  Future<void> materializeRuntimeToCache({
    required String theme,
    required String? shellBackgroundColor,
    required String bridgeToken,
    required String nonce,
    required RichTextBridgeChannelKind bridgeChannelKind,
    required List<RichTextEmojiDefinition> emojiDefinitions,
    required int mediaMaxSize,
    required String toolbarMode,
    List<String>? visibleInsertActions = const <String>[],
    required bool showTitleInput,
    bool showCloseButton = true,
    String? titlePlaceholder,
    String? placeholder,
  });

  /// Serves the runtime materialized by [materializeRuntimeToCache] on
  /// `127.0.0.1` and returns the index URL.
  ///
  /// Must be called after a successful [materializeRuntimeToCache].
  Future<String> startLocalServer(LocalMediaRegistry mediaRegistry);

  /// Closes the loopback server started by [startLocalServer], if any.
  Future<void> close();
}

/// Platform factory — real implementation on native, throws on Flutter Web.
NativeRuntimeLoader createNativeRuntimeLoader() => impl.createNativeRuntimeLoader();
