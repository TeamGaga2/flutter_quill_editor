import 'dart:async';
import 'dart:convert';

import 'package:flutter_quill_editor/async_bool_reconciler.dart';
import 'package:flutter_quill_editor/bridge/transport_bootstrap.dart';
import 'package:flutter_quill_editor/desktop_platform_view_pointer_gate.dart';
import 'package:flutter_quill_editor/emoji_assets.dart';
import 'package:flutter_quill_editor/host/bridge_capability.dart';
import 'package:flutter_quill_editor/host/hosted_richtext_transport.dart';
import 'package:flutter_quill_editor/host/richtext_webview_host.dart';
import 'package:flutter_quill_editor/host/richtext_webview_host_factory.dart';
import 'package:flutter_quill_editor/host/runtime_manifest.dart';
import 'package:flutter_quill_editor/host/web_browser_preflight.dart';
import 'package:flutter_quill_editor/media/local_media_registry.dart';
import 'package:flutter_quill_editor/protocol/messages.dart';
import 'package:flutter_quill_editor/runtime/native_runtime_loader.dart';
import 'package:flutter_quill_editor/widget/richtext_editor_controller.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';

/// Flutter asset path for the offline rich-text webview runtime entry.
///
/// Sync contents from `flutter_quill_editor/apps/webview-runtime/dist`.
/// See `app/assets/richtext_webview_runtime/README.md`.
const String kRichTextWebViewRuntimeAssetPath = 'packages/flutter_quill_editor/assets/richtext_webview_runtime/index.html';

/// Dedicated protocol `ready` timeout — armed only after navigation /
/// initialization actually begins (plan §14 / ADR-0013). It deliberately
/// does **not** cover host surface creation, runtime materialization, or
/// loopback server bind; those have their own stages and deadlines.
const Duration kRichTextWebViewProtocolReadyTimeout = Duration(seconds: 15);

/// Default fallback width when pasted media metadata probe cannot resolve dimensions.
const String kDefaultPasteMediaWidth = '300';

/// Default fallback height when pasted media metadata probe cannot resolve dimensions.
const String kDefaultPasteMediaHeight = '200';

/// Draft namespace key for temporary clipboard-pasted media in `MediaResourceRegistry`.
const String kClipboardDraftKey = 'clipboard';

/// Lifecycle of the shared [RichTextWebView] orchestration (plan §5.6):
///
/// ```text
/// initializing → ready
/// initializing → failed
/// ready → failed
/// failed → retrying → ready | failed
/// ```
enum RichTextWebViewLifecycle { initializing, ready, failed, retrying }

/// Shared WebView host for the TeamGaga rich-text runtime.
///
/// Loads offline assets, injects the production transport factory
/// (`window.__TG_RICHTEXT_CREATE_TRANSPORT__`), and exposes a
/// [RichTextEditorController] once the runtime is ready.
///
/// Backend-neutral: this widget never imports `webview_flutter` or
/// `flutter_inappwebview` directly — it only talks to a [RichTextWebViewHost]
/// picked by [createRichTextWebViewHost] (webview_flutter on Android/iOS/
/// macOS, InAppWebView/WebView2 on Windows). Runtime materialize, the
/// loopback HTTP server, theme sync, pointer-gate JS, and the failure/retry
/// state machine all live here exactly once, shared by both backends.
///
/// ## Injection strategy
///
/// Contract (source of truth in flutter_quill_editor):
/// - Channel: `TgRichTextBridge`
/// - Config: `window.__TG_RICHTEXT_CONFIG__`
/// - Factory: `window.__TG_RICHTEXT_CREATE_TRANSPORT__`
/// - Flutter → Web: `window.__TG_RICHTEXT_DELIVER__(jsonString)`
/// - Web → Flutter: `TgRichTextBridge.postMessage(envelopeJsonString)`,
///   envelope-wrapped with a per-generation [BridgeCapability] token.
///
/// ## Loading strategy
///
/// Android WebView often fails `loadFlutterAsset` for multi-file Vite apps
/// (relative `type=module` + CORS/`crossorigin`). We therefore:
/// 1. Copy runtime files from Flutter assets into an app cache directory
/// 2. Serve via a local `http://127.0.0.1:<port>/` static server
///
/// Ready is signaled by the protocol `ready` event (not merely page finished).
class RichTextWebView extends StatefulWidget {
  const RichTextWebView({
    super.key,
    this.onControllerReady,
    this.onMediaRegistryReady,
    this.onReady,
    this.onError,
    this.onFailure,
    this.onExternalLink,
    this.focusNode,
    this.backgroundColor,
    this.shellBackgroundColor,
    this.titlePlaceholder,
    this.placeholder,
    this.emojiDefinitions = const <RichTextEmojiDefinition>[],
    this.isDesktopRichTextSurface = false,
    this.visibleInsertActions = const <String>[],
    this.showCloseButton = true,
    this.windowsHostCreator,
    this.failedPlaceholderBuilder,
  });

  /// Called once the editor controller is created (before host ready). Fires
  /// again after a successful [RichTextWebViewState.retry] with the new
  /// controller instance.
  final ValueChanged<RichTextEditorController>? onControllerReady;

  /// Called with the per-editor registry used by local media preview URLs.
  /// Fires once (the registry survives retries, only its contents change).
  final ValueChanged<LocalMediaRegistry>? onMediaRegistryReady;

  /// Called when the protocol `ready` event is received.
  final VoidCallback? onReady;

  /// Legacy error callback — called with either a diagnostic `String` or the
  /// underlying `Object` for any failure. Prefer [onFailure] for new code;
  /// this is kept for existing call sites and is invoked alongside it.
  final ValueChanged<Object>? onError;

  /// Called with a structured [RichTextWebViewFailure] whenever the shared
  /// layer transitions into [RichTextWebViewLifecycle.failed].
  final ValueChanged<RichTextWebViewFailure>? onFailure;

  /// Called when a main-frame navigation to a non-runtime origin was
  /// cancelled in the WebView; the page should hand [url] off to its
  /// existing external-link handling.
  final ValueChanged<Uri>? onExternalLink;

  /// Optional Flutter focus node for coordinating platform view focus.
  final FocusNode? focusNode;

  final Color? backgroundColor;

  /// Flutter shell background — synced into Web CSS (required on macOS where
  /// native background APIs are unsupported/unavailable).
  final Color? shellBackgroundColor;

  /// Localized placeholder for the in-Web title field (PC shell).
  final String? titlePlaceholder;

  /// Localized placeholder for the empty body editor (Quill blank state).
  final String? placeholder;

  /// Emoji surface definitions injected by the host app (`id` +
  /// Flutter asset path of the PNG). Empty by default; the example
  /// ships none.
  final List<RichTextEmojiDefinition> emojiDefinitions;

  /// Whether this surface is a desktop rich-text surface. Selects
  /// in-web desktop chrome (`toolbarMode: desktop`, larger media
  /// box) instead of the editor-only mobile configuration.
  final bool isDesktopRichTextSurface;

  /// Visible insert action buttons for the desktop toolbar.
  /// When omitted or empty, no insert buttons are rendered.
  final List<String> visibleInsertActions;

  /// Whether to display the toolbar close button (defaults to true).
  final bool showCloseButton;

  /// Windows backend factory. The package has no InAppWebView /
  /// WebView2 code; Windows hosts must register a creator here or
  /// host creation fails with a
  /// [RichTextWebViewHostCreationException].
  final RichTextWindowsHostCreator? windowsHostCreator;

  /// Optional builder for custom failure placeholder widget.
  final Widget Function(
    BuildContext context,
    RichTextWebViewFailure? failure,
    VoidCallback onRetry,
  )? failedPlaceholderBuilder;

  @override
  State<RichTextWebView> createState() => RichTextWebViewState();
}

class RichTextWebViewState extends State<RichTextWebView> {
  RichTextWebViewHost? _host;
  RichTextWebViewHostKind? _hostKind;
  HostedRichTextTransport? _transport;
  RichTextEditorController? _editorController;
  BridgeCapability _capability = BridgeCapability();

  int _generation = 0;
  RichTextWebViewLifecycle _lifecycle = RichTextWebViewLifecycle.initializing;
  RichTextWebViewFailure? _lastFailure;

  /// Latest runtime-acknowledged snapshot/selection, used to restore content
  /// across a retry (plan §5.6). Never used as a draft/persistence store —
  /// that remains the page's responsibility.
  RichTextSnapshot? _lastAcknowledgedSnapshot;
  ProtocolSelection? _lastKnownSelection;

  StreamSubscription<void>? _readySub;
  StreamSubscription<ChangeEvent>? _changeSub;
  StreamSubscription<SelectionChangeEvent>? _selectionSub;
  StreamSubscription<RequestPasteMediaEvent>? _pasteMediaSub;
  NativeRuntimeLoader? _runtimeLoader;
  late final LocalMediaRegistry _mediaRegistry;
  final _pointerGateDom = AsyncBoolReconciler();
  final _focusGateDom = AsyncBoolReconciler();

  /// True once the editor surface may be shown without a Flutter color cover.
  ///
  /// Native WebViews flip this from [onPageStarted]/[onPageFinished] after
  /// shell CSS inject. Flutter Web's iframe host never fires those callbacks,
  /// so [_loadWebIframeRuntime] marks ready after [initializeRuntime] instead.
  var _shellPaintReady = false;

  /// Last effective theme pushed to the runtime (for didChangeDependencies diff).
  Brightness? _lastBrightness;

  /// Last shell background CSS (hex) pushed to the runtime.
  String? _lastShellBackgroundCss;

  /// True once this element has been through at least one
  /// [didChangeDependencies] — only then is [Theme.of] safe to call.
  var _dependenciesReady = false;

  /// True once the runtime load has been kicked off for the *current*
  /// generation (reset on every [_startGeneration]).
  var _loadKickedOffForGeneration = false;

  RichTextWebViewLifecycle get lifecycle => _lifecycle;

  RichTextWebViewFailure? get lastFailure => _lastFailure;

  int get _mediaMaxSize => richTextWebMediaMaxSizeFor(
    isDesktopRichTextSurface: widget.isDesktopRichTextSurface,
  );

  String get _toolbarMode => richTextWebToolbarModeFor(
    isDesktopRichTextSurface: widget.isDesktopRichTextSurface,
  );

  @override
  void initState() {
    super.initState();

    DesktopPlatformViewPointerGate.instance.blocked.addListener(_onPointerGateChanged);
    DesktopPlatformViewPointerGate.instance.focusBlocked.addListener(_onPointerGateFocusChanged);
    _onPointerGateChanged();
    _onPointerGateFocusChanged();

    _mediaRegistry = MediaResourceRegistry(
      onRegisterObjectUrl: (token, objectUrl, mimeType) async {
        await _host?.registerMedia(
          token: token,
          objectUrl: objectUrl,
          mimeType: mimeType,
        );
      },
      onRevokeObjectUrl: (token) async {
        await _host?.revokeMedia(token: token);
      },
    );

    unawaited(_startGeneration(isFirst: true));
  }

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    // Theme InheritedWidget updates arrive here *before* the parent rebuilds
    // with a new [shellBackgroundColor]. Defer to post-frame so we read the
    // updated prop (critical on macOS where the editor WebView stays alive).
    _scheduleThemeSync();

    // First call: safe to Theme.of for the early HTML inject. Must not run
    // from initState (dependOnInheritedWidgetOfExactType asserts).
    _dependenciesReady = true;
    _maybeKickOffRuntimeLoad(_generation);
  }

  @override
  void didUpdateWidget(covariant RichTextWebView oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.shellBackgroundColor != widget.shellBackgroundColor ||
        oldWidget.backgroundColor != widget.backgroundColor ||
        oldWidget.titlePlaceholder != widget.titlePlaceholder ||
        oldWidget.placeholder != widget.placeholder ||
        oldWidget.showCloseButton != widget.showCloseButton ||
        !listEquals(oldWidget.visibleInsertActions, widget.visibleInsertActions)) {
      _scheduleThemeSync();
    }
  }

  // ---------------------------------------------------------------------------
  // Retry / generation lifecycle
  // ---------------------------------------------------------------------------

  bool _isCurrentGeneration(int generation) => generation == _generation;

  /// Rebuilds this editor's host/transport/controller/server from scratch:
  /// rotates the bridge capability, restores the latest acknowledged
  /// snapshot/selection once the new runtime is ready, and ignores any late
  /// callback from the generation being replaced.
  Future<void> retry() async {
    if (_lifecycle == RichTextWebViewLifecycle.retrying) return;
    _setLifecycle(RichTextWebViewLifecycle.retrying);
    await _disposeGenerationResources();
    if (!mounted) return;
    await _startGeneration(isFirst: false);
  }

  Future<void> _startGeneration({required bool isFirst}) async {
    final generation = ++_generation;
    _capability = BridgeCapability();
    _loadKickedOffForGeneration = false;
    _shellPaintReady = false;
    _lastBrightness = null;
    _lastShellBackgroundCss = null;
    _setLifecycle(
      isFirst ? RichTextWebViewLifecycle.initializing : RichTextWebViewLifecycle.retrying,
    );

    final callbacks = _buildHostCallbacks(generation, restoreOnReady: !isFirst);

    final RichTextWebViewHost host;
    final kind = selectRichTextWebViewHostKind();
    try {
      host = await createRichTextWebViewHost(
        callbacks: callbacks,
        kindOverride: kind,
        capabilityToken: _capability.token,
        windowsHostCreator: widget.windowsHostCreator,
      );
    } on RichTextWebViewHostCreationException catch (error) {
      if (!_isCurrentGeneration(generation)) return;
      _reportFailure(error.failure);
      return;
    } on Object catch (error, stack) {
      if (!_isCurrentGeneration(generation)) return;
      _reportFailure(
        RichTextWebViewFailure(
          stage: RichTextWebViewFailureStage.webViewCreation,
          message: '$error',
          cause: error,
          stackTrace: stack,
        ),
      );
      return;
    }

    if (!_isCurrentGeneration(generation)) {
      unawaited(host.dispose());
      return;
    }

    final transport = HostedRichTextTransport(host: host, capability: _capability);
    final editorController = RichTextEditorController(
      transport: transport,
      wakeEditingSessionAction: transport.wakeEditingSession,
    );

    _host = host;
    _hostKind = kind;
    _transport = transport;
    _editorController = editorController;

    _wireEditorController(editorController, generation, restoreOnReady: !isFirst);

    final shellBg = widget.shellBackgroundColor ?? widget.backgroundColor;
    if (shellBg != null) {
      unawaited(host.setBackgroundColor(shellBg));
    }

    if (mounted) setState(() {});

    if (isFirst) {
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (!mounted) return;
        widget.onMediaRegistryReady?.call(_mediaRegistry);
      });
    }
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted || !_isCurrentGeneration(generation)) return;
      widget.onControllerReady?.call(editorController);
    });

    _maybeKickOffRuntimeLoad(generation);
  }

  void _maybeKickOffRuntimeLoad(int generation) {
    if (!_dependenciesReady) return;
    if (_loadKickedOffForGeneration) return;
    if (!_isCurrentGeneration(generation)) return;
    if (_host == null) return;
    _loadKickedOffForGeneration = true;
    unawaited(_loadRuntime(generation));
  }

  Future<void> _disposeGenerationResources() async {
    await _readySub?.cancel();
    _readySub = null;
    await _changeSub?.cancel();
    _changeSub = null;
    await _selectionSub?.cancel();
    _selectionSub = null;
    await _pasteMediaSub?.cancel();
    _pasteMediaSub = null;
    await _editorController?.dispose();
    _editorController = null;
    await _transport?.dispose();
    _transport = null;
    await _host?.dispose();
    _host = null;
    _hostKind = null;
    await _runtimeLoader?.close();
    _runtimeLoader = null;
    // The old iframe generation's Blob object URLs are dead with the host —
    // revoke them, but keep IndexedDB bytes so retry can rebind fresh ones.
    await _mediaRegistry.revokeObjectUrls();
  }

  void _setLifecycle(RichTextWebViewLifecycle lifecycle) {
    _lifecycle = lifecycle;
    if (mounted) setState(() {});
  }

  void _reportFailure(RichTextWebViewFailure failure) {
    // First terminal failure wins for this generation (plan §14 / ADR-0013).
    // Late protocolReadyTimeout must not overwrite an earlier navigation /
    // surface-ready root cause.
    if (_lifecycle == RichTextWebViewLifecycle.failed) return;
    _lastFailure = failure;
    _setLifecycle(RichTextWebViewLifecycle.failed);
    widget.onFailure?.call(failure);
    widget.onError?.call(failure.cause ?? failure.message);
  }

  // ---------------------------------------------------------------------------
  // Host callbacks / editor controller wiring
  // ---------------------------------------------------------------------------

  RichTextWebViewHostCallbacks _buildHostCallbacks(int generation, {required bool restoreOnReady}) {
    return RichTextWebViewHostCallbacks(
      onPageStarted: (url) {
        if (!_isCurrentGeneration(generation)) return;
        unawaited(_injectBridgeAndShellBootstrap(generation, markShellPaintReady: true));
      },
      onPageFinished: (url) {
        if (!_isCurrentGeneration(generation)) return;
        // Also reveal on finished in case the started inject raced / failed.
        unawaited(_injectBridgeAndShellBootstrap(generation, markShellPaintReady: true));
      },
      onMainFrameFailure: (failure) {
        if (!_isCurrentGeneration(generation)) return;
        _reportFailure(failure);
      },
      onRawBridgeMessage: (raw) {
        if (!_isCurrentGeneration(generation)) return;
        _transport?.handleRawBridgeMessage(raw);
      },
      onPointerGateOutsidePointer: () {
        if (!_isCurrentGeneration(generation)) return;
        DesktopPlatformViewPointerGate.instance.notifyOutsidePointer();
      },
      onExternalNavigation: (url) {
        if (!_isCurrentGeneration(generation)) return;
        if (kDebugMode) {
          debugPrint('RichTextWebView: external navigation handed off: $url');
        }
        widget.onExternalLink?.call(url);
      },
    );
  }

  void _wireEditorController(
    RichTextEditorController controller,
    int generation, {
    required bool restoreOnReady,
  }) {
    _readySub = controller.ready.asStream().listen((_) async {
      if (!_isCurrentGeneration(generation) || _lifecycle == RichTextWebViewLifecycle.failed) {
        return;
      }
      if (restoreOnReady) {
        await _restoreLatestSnapshot(controller, generation);
        if (!_isCurrentGeneration(generation) || _lifecycle == RichTextWebViewLifecycle.failed) {
          return;
        }
      }
      _setLifecycle(RichTextWebViewLifecycle.ready);
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (!mounted || !_isCurrentGeneration(generation)) return;
        widget.onReady?.call();
      });
    });

    // Protocol ready timeout is armed in [_armProtocolReadyTimeout] only after
    // loadUrl / navigation actually begins — not at controller wire-up.

    _changeSub = controller.onChange.listen((event) {
      if (!_isCurrentGeneration(generation)) return;
      _lastAcknowledgedSnapshot = event.snapshot;
    });
    _selectionSub = controller.onSelectionChange.listen((event) {
      if (!_isCurrentGeneration(generation)) return;
      _lastKnownSelection = event.selection;
    });
    _pasteMediaSub = controller.onRequestPasteMedia.listen((event) async {
      if (!_isCurrentGeneration(generation)) return;
      try {
        final payload = event.typedPayload;
        final bytes = base64Decode(payload.dataBase64);
        final uri = await _mediaRegistry.registerBytes(
          bytes: bytes,
          mimeType: payload.mimeType,
          draftKey: kClipboardDraftKey,
          fileName: payload.fileName,
        );
        final width = payload.width ?? kDefaultPasteMediaWidth;
        final height = payload.height ?? kDefaultPasteMediaHeight;
        if (payload.isVideo) {
          await controller.insertVideo(
            src: uri,
            width: width,
            height: height,
            mimeType: payload.mimeType,
            fileSize: payload.fileSize,
            duration: payload.duration,
            selection: payload.selection,
          );
        } else {
          await controller.insertImage(
            src: uri,
            width: width,
            height: height,
            mimeType: payload.mimeType,
            fileSize: payload.fileSize,
            selection: payload.selection,
          );
        }
      } catch (error) {
        debugPrint('Failed to handle paste media: $error');
      }
    });
  }

  /// Arms the protocol `ready` deadline once navigation/init has started.
  void _armProtocolReadyTimeout(RichTextEditorController controller, int generation) {
    unawaited(
      controller.ready.timeout(kRichTextWebViewProtocolReadyTimeout).catchError((Object error) {
        if (!_isCurrentGeneration(generation) || error is! TimeoutException) return;
        if (_lifecycle == RichTextWebViewLifecycle.failed) return;
        _reportFailure(
          RichTextWebViewFailure(
            stage: RichTextWebViewFailureStage.protocolReadyTimeout,
            message:
                'Protocol ready event not received within $kRichTextWebViewProtocolReadyTimeout.',
            cause: error,
          ),
        );
      }),
    );
  }

  /// Retry step 5–6 (plan §5.6): restore the last runtime-acknowledged
  /// snapshot, then selection (best-effort — an out-of-range selection is
  /// swallowed and the runtime's own fallback wins), then focus. No-ops when
  /// there is no in-memory snapshot yet — the page's normal `onReady` draft
  /// restore flow (identical to a fresh mount) covers that case.
  Future<void> _restoreLatestSnapshot(RichTextEditorController controller, int generation) async {
    final snapshot = _lastAcknowledgedSnapshot;
    if (snapshot == null) return;
    try {
      await _rebindLocalMediaForSnapshot(snapshot);
      if (!_isCurrentGeneration(generation)) return;
      await controller.setSnapshot(snapshot);
      if (!_isCurrentGeneration(generation)) return;

      final selection = _lastKnownSelection;
      if (selection != null) {
        try {
          await controller.setSelection(selection);
        } on Object {
          // Selection out of range for the restored content — fall back to
          // wherever the runtime naturally places the caret.
        }
        if (!_isCurrentGeneration(generation)) return;
      }

      await controller.focus();
    } on Object catch (error, stack) {
      if (!_isCurrentGeneration(generation)) return;
      _reportFailure(
        RichTextWebViewFailure(
          stage: RichTextWebViewFailureStage.draftMediaRestore,
          message: 'Failed to restore local media after host retry.',
          cause: error,
          stackTrace: stack,
        ),
      );
    }
  }

  Future<void> _rebindLocalMediaForSnapshot(RichTextSnapshot snapshot) async {
    final tokens = <String>{};
    for (final op in snapshot.content) {
      if (op is! Map) continue;
      final insert = op['insert'];
      if (insert is Map) {
        final image = insert['image'];
        final video = insert['video'];
        if (image is String && image.startsWith(LocalMediaRegistry.uriPrefix)) {
          tokens.add(image);
        }
        if (video is String && video.startsWith(LocalMediaRegistry.uriPrefix)) {
          tokens.add(video);
        }
      }
      final attrs = op['attributes'];
      if (attrs is Map) {
        final poster = attrs['poster'];
        if (poster is String && poster.startsWith(LocalMediaRegistry.uriPrefix)) {
          tokens.add(poster);
        }
      }
    }
    if (tokens.isEmpty) return;
    await _mediaRegistry.rebindObjectUrls(tokens: tokens);
  }

  // ---------------------------------------------------------------------------
  // Theme / shell sync
  // ---------------------------------------------------------------------------

  /// Coalesce brightness / shell-color sync to the end of the frame so parent
  /// rebuilds (new tokenized shell bg) are visible before we inject.
  void _scheduleThemeSync() {
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted) return;
      final brightness = Theme.of(context).brightness;
      final shellCss = _shellBackgroundCss;
      if (brightness == _lastBrightness && shellCss == _lastShellBackgroundCss) {
        return;
      }
      unawaited(_syncThemeToWebView(brightness, shellCss));
    });
  }

  /// Push the effective theme + shell color to the loaded runtime without a
  /// reload: re-run bootstrap (applies `tg-theme-*` + HOST_EDITOR_STYLE).
  Future<void> _syncThemeToWebView(Brightness brightness, String? shellCss) async {
    final host = _host;
    if (host == null) return;
    final theme = brightness == Brightness.dark ? 'dark' : 'light';
    final shellColor = widget.shellBackgroundColor ?? widget.backgroundColor;
    try {
      if (shellColor != null) {
        await host.setBackgroundColor(shellColor);
      }
      if (_hostKind == RichTextWebViewHostKind.webIframe) {
        await host.updatePresentation(
          theme: theme,
          titlePlaceholder: widget.titlePlaceholder,
          placeholder: widget.placeholder,
          shellBackgroundColor: shellCss,
        );
      } else {
        await host.runJavaScript(
          buildRichTextTransportBootstrapJs(
            bridgeToken: _capability.token,
            mediaMaxSize: _mediaMaxSize,
            toolbarMode: _toolbarMode,
            visibleInsertActions: widget.visibleInsertActions,
            showCloseButton: widget.showCloseButton,
            bridgeChannelKind: _bridgeChannelKindFor(_hostKind),
            theme: theme,
            titlePlaceholder: widget.titlePlaceholder,
            placeholder: widget.placeholder,
            shellBackgroundColor: shellCss,
          ),
        );
      }
      if (!mounted) return;
      _lastBrightness = brightness;
      _lastShellBackgroundCss = shellCss;
    } on Object catch (error) {
      // Page not loaded yet — the bootstrap on pageStarted/pageFinished will
      // carry the correct theme.
      if (kDebugMode) {
        debugPrint('RichTextWebView theme sync deferred: $error');
      }
    }
  }

  /// CSS hex for [shellBackgroundColor] / [backgroundColor], if either is set.
  String? get _shellBackgroundCss {
    final color = widget.shellBackgroundColor ?? widget.backgroundColor;
    return color != null ? richTextColorToCss(color) : null;
  }

  RichTextBridgeChannelKind _bridgeChannelKindFor(RichTextWebViewHostKind? kind) {
    return kind == RichTextWebViewHostKind.windowsInAppWebView
        ? RichTextBridgeChannelKind.inAppWebViewHandler
        : RichTextBridgeChannelKind.javaScriptChannel;
  }

  Future<void> _injectBridgeAndShellBootstrap(
    int generation, {
    bool markShellPaintReady = false,
  }) async {
    final host = _host;
    if (host == null || !_isCurrentGeneration(generation)) return;
    try {
      // Emoji definitions first so host bootstrap can resolve insert_emoji src.
      await host.runJavaScript(
        buildEmojiDefinitionsBootstrapJs(
          definitions: widget.emojiDefinitions,
        ),
      );
      if (!mounted || !_isCurrentGeneration(generation)) return;
      final brightness = Theme.of(context).brightness;
      final shellCss = _shellBackgroundCss;
      await host.runJavaScript(
        buildRichTextTransportBootstrapJs(
          bridgeToken: _capability.token,
          mediaMaxSize: _mediaMaxSize,
          toolbarMode: _toolbarMode,
          visibleInsertActions: widget.visibleInsertActions,
          showCloseButton: widget.showCloseButton,
          bridgeChannelKind: _bridgeChannelKindFor(_hostKind),
          theme: brightness == Brightness.dark ? 'dark' : 'light',
          titlePlaceholder: widget.titlePlaceholder,
          placeholder: widget.placeholder,
          shellBackgroundColor: shellCss,
        ),
      );
      if (!_isCurrentGeneration(generation)) return;
      _lastBrightness = brightness;
      _lastShellBackgroundCss = shellCss;
      // Navigation wipes the in-page gate DOM; always strip leftovers, then
      // re-apply if an overlay is still open.
      await _applyPointerGateJs(host, false);
      _pointerGateDom.applied = false;
      await _applyEditorFocusBlocked(host, false);
      _focusGateDom.applied = false;
      await _setEditorPointerEventsBlocked(
        DesktopPlatformViewPointerGate.instance.blocked.value,
      );
      await _setEditorFocusBlocked(
        DesktopPlatformViewPointerGate.instance.focusBlocked.value,
      );
    } on Object catch (error) {
      // Page not loaded far enough yet — onPageStarted / onPageFinished both
      // call this, so a transient race here is expected; the dedicated
      // protocol-ready timeout is the real backstop for a persistent failure.
      if (kDebugMode) {
        debugPrint('RichTextWebView bridge/theme inject deferred: $error');
      }
    } finally {
      if (markShellPaintReady && mounted && !_shellPaintReady && _isCurrentGeneration(generation)) {
        setState(() => _shellPaintReady = true);
      }
    }
  }

  void _onPointerGateChanged() {
    final blocked = DesktopPlatformViewPointerGate.instance.blocked.value;
    unawaited(_setEditorPointerEventsBlocked(blocked));
  }

  void _onPointerGateFocusChanged() {
    final blocked = DesktopPlatformViewPointerGate.instance.focusBlocked.value;
    // Only overlays with their own keyboard input take focus. Live @/# menus
    // block pointer hit-through while the Web editor keeps text/IME ownership.
    if (blocked) {
      widget.focusNode?.unfocus();
    }
    unawaited(_setEditorFocusBlocked(blocked));
  }

  Future<void> _setEditorPointerEventsBlocked(bool blocked) {
    final host = _host;
    if (host == null) return Future<void>.value();
    if (!blocked) {
      // Force a cleanup pass even if we already think we're unblocked.
      // A prior failed/racy apply can leave a legacy blocker div in the DOM
      // while `applied` is already false — that makes the editor unclickable.
      _pointerGateDom.applied = true;
    }
    return _pointerGateDom.setDesired(blocked, (b) => _applyPointerGateJs(host, b));
  }

  Future<void> _applyPointerGateJs(RichTextWebViewHost host, bool blocked) async {
    if (_hostKind == RichTextWebViewHostKind.webIframe) {
      await host.setPointerEventsBlocked(blocked);
      return;
    }
    // Desktop PlatformViews steal hits from Flutter overlay barriers, so
    // outside-tap dismiss never sees editor clicks. Notify Flutter on
    // pointerdown WITHOUT preventDefault / a full-page blocker — a stuck
    // preventDefault layer makes the entire WebView appear dead.
    await host.runJavaScript('''
(function () {
  var STYLE_ID = '__tg_pointer_gate__';
  var LISTENER_KEY = '__tg_pointer_gate_on_pointerdown__';
  var existingStyle = document.getElementById(STYLE_ID);

  function notifyFlutter() {
    try {
      if (typeof TgPointerGate !== 'undefined' && TgPointerGate.postMessage) {
        TgPointerGate.postMessage('down');
      } else if (
        typeof window.flutter_inappwebview !== 'undefined' &&
        typeof window.flutter_inappwebview.callHandler === 'function'
      ) {
        window.flutter_inappwebview.callHandler('$kTgPointerGateChannel', 'down');
      }
    } catch (_) {}
  }

  if (${blocked ? 'true' : 'false'}) {
    if (!existingStyle) {
      var style = document.createElement('style');
      style.id = STYLE_ID;
      style.textContent = [
        'html, body, .tg-webview-root, .tg-webview-root * {',
        '  cursor: pointer !important;',
        '}',
      ].join('\\n');
      (document.head || document.documentElement).appendChild(style);
    }
    if (!window[LISTENER_KEY]) {
      window[LISTENER_KEY] = function () {
        notifyFlutter();
      };
      document.addEventListener('pointerdown', window[LISTENER_KEY], true);
    }
  } else {
    if (existingStyle) existingStyle.remove();
    if (window[LISTENER_KEY]) {
      document.removeEventListener('pointerdown', window[LISTENER_KEY], true);
      window[LISTENER_KEY] = null;
    }
    // Legacy cleanup: older builds installed a full-page blocker div that
    // swallowed clicks with preventDefault. Always strip it when unblocking.
    var legacyBlocker = document.getElementById('__tg_pointer_gate_blocker__');
    if (legacyBlocker) legacyBlocker.remove();
  }
})();
''');
  }

  Future<void> _setEditorFocusBlocked(bool blocked) {
    final host = _host;
    if (host == null) return Future<void>.value();
    if (!blocked) {
      _focusGateDom.applied = true;
    }
    return _focusGateDom.setDesired(blocked, (b) => _applyEditorFocusBlocked(host, b));
  }

  Future<void> _applyEditorFocusBlocked(RichTextWebViewHost host, bool blocked) async {
    if (_hostKind == RichTextWebViewHostKind.webIframe) {
      await host.setInteractionBlocked(blocked);
    }
  }

  // ---------------------------------------------------------------------------
  // Runtime materialize / loopback server
  // ---------------------------------------------------------------------------

  Future<void> _loadRuntime(int generation) async {
    final host = _host;
    final editorController = _editorController;
    if (host == null || editorController == null || !_isCurrentGeneration(generation)) {
      return;
    }

    if (_hostKind == RichTextWebViewHostKind.webIframe) {
      await _loadWebIframeRuntime(generation, host, editorController);
      return;
    }

    // Plan §14: wait for Host Surface Ready before materialize / server /
    // navigation. Windows controller only exists after onWebViewCreated.
    try {
      await host.whenSurfaceReady.timeout(kRichTextWebViewHostSurfaceReadyTimeout);
    } on TimeoutException catch (error, stack) {
      if (!_isCurrentGeneration(generation)) return;
      _reportFailure(
        RichTextWebViewFailure(
          stage: RichTextWebViewFailureStage.hostSurfaceReadyTimeout,
          message: 'Host surface was not ready within $kRichTextWebViewHostSurfaceReadyTimeout.',
          cause: error,
          stackTrace: stack,
        ),
      );
      return;
    } on Object catch (error, stack) {
      if (!_isCurrentGeneration(generation)) return;
      _reportFailure(
        RichTextWebViewFailure(
          stage: RichTextWebViewFailureStage.webViewCreation,
          message: '$error',
          cause: error,
          stackTrace: stack,
        ),
      );
      return;
    }
    if (!_isCurrentGeneration(generation) || _lifecycle == RichTextWebViewLifecycle.failed) {
      return;
    }

    final loader = _runtimeLoader ??= createNativeRuntimeLoader();
    try {
      if (!mounted) {
        throw StateError('RichTextWebView materialize called after unmount.');
      }
      // Capture before awaits — materialize must not use BuildContext after gaps.
      await loader.materializeRuntimeToCache(
        theme: Theme.of(context).brightness == Brightness.dark ? 'dark' : 'light',
        shellBackgroundColor: _shellBackgroundCss,
        bridgeToken: _capability.token,
        nonce: _capability.nonce,
        bridgeChannelKind: _bridgeChannelKindFor(_hostKind),
        emojiDefinitions: widget.emojiDefinitions,
        mediaMaxSize: _mediaMaxSize,
        toolbarMode: _toolbarMode,
        visibleInsertActions: widget.visibleInsertActions,
        showTitleInput: kRichTextWebShowTitleInput,
        showCloseButton: widget.showCloseButton,
        titlePlaceholder: widget.titlePlaceholder,
        placeholder: widget.placeholder,
      );
    } on Object catch (error, stack) {
      if (!_isCurrentGeneration(generation)) return;
      _reportFailure(
        RichTextWebViewFailure(
          stage: RichTextWebViewFailureStage.runtimeMaterialization,
          message: '$error',
          cause: error,
          stackTrace: stack,
        ),
      );
      return;
    }
    if (!_isCurrentGeneration(generation)) return;

    final String baseUrl;
    try {
      // Prefer loopback HTTP: ES modules work reliably (file:// often blocks
      // them).
      baseUrl = await loader.startLocalServer(_mediaRegistry);
    } on Object catch (error, stack) {
      if (!_isCurrentGeneration(generation)) return;
      _reportFailure(
        RichTextWebViewFailure(
          stage: RichTextWebViewFailureStage.localServer,
          message: '$error',
          cause: error,
          stackTrace: stack,
        ),
      );
      return;
    }
    if (!_isCurrentGeneration(generation)) return;
    if (kDebugMode) {
      debugPrint('RichTextWebView loading $baseUrl');
    }

    try {
      await host.loadUrl(Uri.parse(baseUrl));
    } on Object catch (error, stack) {
      if (!_isCurrentGeneration(generation)) return;
      _reportFailure(
        RichTextWebViewFailure(
          stage: RichTextWebViewFailureStage.navigation,
          message: '$error',
          cause: error,
          stackTrace: stack,
        ),
      );
      return;
    }
    if (!_isCurrentGeneration(generation) || _lifecycle == RichTextWebViewLifecycle.failed) {
      return;
    }

    // Navigation has started — now the protocol ready deadline applies.
    _armProtocolReadyTimeout(editorController, generation);
  }

  /// Flutter Web path: load vendored iframe entry from the app asset origin
  /// (no dart:io materialize / loopback server).
  Future<void> _loadWebIframeRuntime(
    int generation,
    RichTextWebViewHost host,
    RichTextEditorController editorController,
  ) async {
    final preflight = await runWebBrowserPreflight();
    if (!preflight.ok) {
      if (!_isCurrentGeneration(generation)) return;
      _reportFailure(
        RichTextWebViewFailure(
          stage: RichTextWebViewFailureStage.unsupportedBrowser,
          message: preflight.reason ?? 'Browser capability preflight failed.',
        ),
      );
      return;
    }

    // Ensure the iframe element is in the tree before setting src.
    await Future<void>.delayed(Duration.zero);
    if (!_isCurrentGeneration(generation) || !mounted) return;

    final entryUrl = Uri.base.resolve(kRichTextRuntimeManifest.webEntryAssetPath);
    try {
      await host.loadUrl(entryUrl);
      await host.whenSurfaceReady.timeout(kRichTextWebViewHostSurfaceReadyTimeout);
    } on TimeoutException catch (error, stack) {
      if (!_isCurrentGeneration(generation)) return;
      _reportFailure(
        RichTextWebViewFailure(
          stage: RichTextWebViewFailureStage.hostSurfaceReadyTimeout,
          message: 'Host surface was not ready within $kRichTextWebViewHostSurfaceReadyTimeout.',
          cause: error,
          stackTrace: stack,
        ),
      );
      return;
    } on Object catch (error, stack) {
      if (!_isCurrentGeneration(generation)) return;
      final stage = error is StateError && '$error'.contains('runtimeMismatch')
          ? RichTextWebViewFailureStage.runtimeMismatch
          : RichTextWebViewFailureStage.navigation;
      _reportFailure(
        RichTextWebViewFailure(
          stage: stage,
          message: '$error',
          cause: error,
          stackTrace: stack,
        ),
      );
      return;
    }
    if (!_isCurrentGeneration(generation) || _lifecycle == RichTextWebViewLifecycle.failed) {
      return;
    }

    if (!mounted) return;
    final brightness = Theme.of(context).brightness;
    final emojiDefinitions = <Map<String, String>>[
      for (final definition in widget.emojiDefinitions)
        if (definition.id.isNotEmpty)
          <String, String>{
            'id': definition.id,
            'src': Uri.base.resolve('assets/${definition.assetPath}').toString(),
          },
    ];
    final config = <String, Object?>{
      'toolbarMode': _toolbarMode,
      'mediaMaxSize': _mediaMaxSize,
      'visibleInsertActions': widget.visibleInsertActions,
      'showTitleInput': kRichTextWebShowTitleInput,
      'showCloseButton': widget.showCloseButton,
      'titlePlaceholder': widget.titlePlaceholder,
      // Body blank-state hint — required on Flutter Web (no native bootstrap
      // MutationObserver). Runtime also defaults when omitted.
      'placeholder': widget.placeholder,
      'theme': brightness == Brightness.dark ? 'dark' : 'light',
      'shellBackgroundColor': _shellBackgroundCss,
      'emojiDefinitions': emojiDefinitions,
    };

    try {
      await host.initializeRuntime(config);
    } on Object catch (error, stack) {
      if (!_isCurrentGeneration(generation)) return;
      _reportFailure(
        RichTextWebViewFailure(
          stage: RichTextWebViewFailureStage.channelInitialization,
          message: '$error',
          cause: error,
          stackTrace: stack,
        ),
      );
      return;
    }
    if (!_isCurrentGeneration(generation) || _lifecycle == RichTextWebViewLifecycle.failed) {
      return;
    }

    // Flutter Web never gets onPageStarted/onPageFinished (native-only). Lift
    // the shell cover now that RuntimeConfig (theme + shellBackgroundColor)
    // has been delivered; otherwise ColoredBox stays forever over the iframe
    // while typing/send still work underneath.
    if (mounted && !_shellPaintReady && _isCurrentGeneration(generation)) {
      setState(() => _shellPaintReady = true);
    }

    _armProtocolReadyTimeout(editorController, generation);
  }

  @override
  void dispose() {
    DesktopPlatformViewPointerGate.instance.blocked.removeListener(_onPointerGateChanged);
    DesktopPlatformViewPointerGate.instance.focusBlocked.removeListener(
      _onPointerGateFocusChanged,
    );
    unawaited(_disposeGenerationResources());
    _mediaRegistry.clear();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final shellColor = widget.shellBackgroundColor ?? widget.backgroundColor;
    final Widget core;
    if (_lifecycle == RichTextWebViewLifecycle.failed) {
      core = widget.failedPlaceholderBuilder?.call(context, _lastFailure, retry) ??
          RichTextWebViewFailedPlaceholder(
            failure: _lastFailure,
            backgroundColor: shellColor,
            onRetry: retry,
          );
    } else {
      final host = _host;
      final webSurface = host?.buildSurface() ?? const SizedBox.expand();
      // Cover until shell paint is ready (native: after CSS inject via page
      // callbacks; web iframe: after initializeRuntime). Platform views are
      // opaque; the Flutter parent color alone cannot show through — and on
      // Flutter Web a stuck cover paints over HtmlElementView while the
      // iframe underneath still receives keyboard/pointer input.
      core = shellColor == null
          ? webSurface
          : Stack(
              fit: StackFit.expand,
              children: [
                webSurface,
                if (host == null || !_shellPaintReady)
                  Positioned.fill(
                    child: ColoredBox(
                      key: const ValueKey<String>('richtext-shell-paint-cover'),
                      color: shellColor,
                    ),
                  ),
              ],
            );
    }
    final focusNode = widget.focusNode;
    if (focusNode == null) {
      return core;
    }
    // Windows InAppWebView is a composition texture with its own nested
    // FocusNode. Letting this parent take primary focus steals the plugin
    // node and leaves title/body unable to keep a caret. Descendants stay
    // focusable; overlay block still unfocuses the whole subtree.
    final windowsTextureHost = _hostKind == RichTextWebViewHostKind.windowsInAppWebView;
    return ValueListenableBuilder<bool>(
      valueListenable: DesktopPlatformViewPointerGate.instance.focusBlocked,
      builder: (context, focusBlocked, child) {
        return Focus(
          focusNode: focusNode,
          // While Menu/link dialog is open, refuse focus so Chrome iframe
          // cannot win the caret back from overlay TextFields.
          // On iOS, refuse Flutter FocusManager focus requests to prevent
          // WKWebView becomeFirstResponder from defaulting to the Title textarea.
          canRequestFocus: focusNode.canRequestFocus &&
              !focusBlocked &&
              !windowsTextureHost &&
              defaultTargetPlatform != TargetPlatform.iOS,
          child: child!,
        );
      },
      child: core,
    );
  }
}

/// Simple, non-interactive placeholder shown instead of the WebView surface
/// while [RichTextWebViewState.lifecycle] is `failed` (plan §5.6) — never a
/// blank/clickable WebView. Pages can additionally react via
/// [RichTextWebView.onFailure] (e.g. to disable their own toolbar); Phase 5
/// wires that into `RichTextInputPage`.
@visibleForTesting
class RichTextWebViewFailedPlaceholder extends StatelessWidget {
  const RichTextWebViewFailedPlaceholder({
    required this.failure,
    required this.onRetry,
    super.key,
    this.backgroundColor,
  });

  final RichTextWebViewFailure? failure;
  final Color? backgroundColor;
  final VoidCallback onRetry;

  bool get _canRetry {
    final stage = failure?.stage;
    return stage != RichTextWebViewFailureStage.unsupportedBrowser &&
        stage != RichTextWebViewFailureStage.runtimeMissing;
  }

  @override
  Widget build(BuildContext context) {
    final failure = this.failure;
    final unsupported = failure?.stage == RichTextWebViewFailureStage.unsupportedBrowser;
    return ColoredBox(
      color: backgroundColor ?? Theme.of(context).colorScheme.surface,
      child: Center(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              const Icon(Icons.error_outline, size: 32),
              const SizedBox(height: 12),
              Text(
                unsupported
                    ? 'This browser cannot run the editor. Please upgrade Chrome, Edge, or Safari.'
                    : failure == null
                    ? 'The editor failed to load.'
                    : 'The editor failed to load (${failure.stage.name}).',
                textAlign: TextAlign.center,
              ),
              if (_canRetry) ...[
                const SizedBox(height: 16),
                OutlinedButton(
                  onPressed: onRetry,
                  child: const Text('Retry'),
                ),
              ],
            ],
          ),
        ),
      ),
    );
  }
}
