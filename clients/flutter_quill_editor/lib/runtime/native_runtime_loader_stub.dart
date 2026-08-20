import 'package:flutter_quill_editor/bridge/transport_bootstrap.dart';
import 'package:flutter_quill_editor/emoji_assets.dart';
import 'package:flutter_quill_editor/media/local_media_registry.dart';
import 'package:flutter_quill_editor/runtime/native_runtime_loader.dart';

/// Flutter Web stub — [RichTextWebView] never calls this on the web path.
NativeRuntimeLoader createNativeRuntimeLoader() => _UnsupportedNativeRuntimeLoader();

class _UnsupportedNativeRuntimeLoader implements NativeRuntimeLoader {
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
    List<String>? visibleInsertActions = const <String>[],
    required bool showTitleInput,
    bool showCloseButton = true,
    String? titlePlaceholder,
    String? placeholder,
  }) {
    throw UnsupportedError('NativeRuntimeLoader is only available on native platforms.');
  }

  @override
  Future<String> startLocalServer(LocalMediaRegistry mediaRegistry) {
    throw UnsupportedError('NativeRuntimeLoader is only available on native platforms.');
  }

  @override
  Future<void> close() async {}
}
