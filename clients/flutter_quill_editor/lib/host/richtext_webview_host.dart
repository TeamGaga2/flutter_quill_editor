import 'package:flutter/widgets.dart';

/// Stages the shared [RichTextWebView] orchestration can fail at.
///
/// Mirrors the implementation plan §5.6 failure taxonomy — keep in sync with
/// `docs/richtext-webview-windows-implementation-plan.md`.
enum RichTextWebViewFailureStage {
  /// Windows only: `WebViewEnvironment.getAvailableVersion()` found no
  /// installed WebView2 Runtime.
  runtimeMissing,

  /// Windows only: creating the shared [WebViewEnvironment] failed.
  environmentCreation,

  /// Creating the platform WebView / InAppWebView surface failed.
  webViewCreation,

  /// The host surface never became ready (e.g. Windows `onWebViewCreated`
  /// never fired) within [kRichTextWebViewHostSurfaceReadyTimeout].
  hostSurfaceReadyTimeout,

  /// Flutter Web: browser lacks MessageChannel / required editor capabilities.
  unsupportedBrowser,

  /// Flutter Web: iframe surfaceReady identity does not match the vendored
  /// Dart runtime manifest.
  runtimeMismatch,

  /// Flutter Web: MessagePort transfer / channel initialize failed.
  channelInitialization,

  /// Copying/patching the vendored web runtime into cache failed.
  runtimeMaterialization,

  /// The loopback HTTP server failed to bind or serve the runtime.
  localServer,

  /// The main-frame navigation was rejected or errored.
  navigation,

  /// Injecting the bridge/theme/emoji bootstrap script failed.
  bridgeBootstrap,

  /// The protocol `ready` event did not arrive within the ready timeout.
  protocolReadyTimeout,

  /// Draft media restore failed (missing Blob / IndexedDB record).
  draftMediaRestore,

  /// An inbound bridge message failed capability validation or protocol
  /// decoding in a way that indicates a broken host, not a one-off message.
  protocolMismatch,
}

/// Deadline for [RichTextWebViewHost.whenSurfaceReady] after the shared
/// orchestration begins waiting (ADR-0013 / plan §14). Measured from the
/// wait start, which is after the host widget is scheduled into the tree.
const Duration kRichTextWebViewHostSurfaceReadyTimeout = Duration(seconds: 10);

/// Deadline for Flutter Web MessagePort initialize → `initializeAck`
/// (plan §14 / ADR-0013).
const Duration kRichTextWebViewChannelInitTimeout = Duration(seconds: 5);

/// Structured failure surfaced to [RichTextWebView.onFailure].
///
/// [diagnostics] must never contain the bridge capability token, local media
/// file paths, or user content — only platform / stage / error-code style
/// values safe to show in a copyable diagnostics panel.
@immutable
class RichTextWebViewFailure {
  const RichTextWebViewFailure({
    required this.stage,
    required this.message,
    this.diagnostics = const <String, String>{},
    this.cause,
    this.stackTrace,
  });

  final RichTextWebViewFailureStage stage;
  final String message;
  final Map<String, String> diagnostics;
  final Object? cause;
  final StackTrace? stackTrace;

  @override
  String toString() => 'RichTextWebViewFailure(${stage.name}: $message)';
}

/// Outcome of evaluating a main-frame navigation request against the
/// loopback-only policy (plan §5.5, point 4–5).
enum RichTextWebViewNavigationDecision {
  /// Same-origin loopback navigation — let the WebView proceed.
  allow,

  /// Different origin / external link — cancel in the WebView and hand off
  /// to Flutter's existing link handling.
  cancelAndHandOff,
}

/// Evaluates a main-frame navigation [requestUrl] against the single
/// [allowedOrigin] this host generation is permitted to navigate within
/// (the loopback runtime origin, e.g. `http://127.0.0.1:54321`).
///
/// Pure function — safe to unit test without a real WebView.
RichTextWebViewNavigationDecision evaluateMainFrameNavigation({
  required Uri requestUrl,
  required Uri allowedOrigin,
}) {
  final sameOrigin =
      requestUrl.scheme == allowedOrigin.scheme &&
      requestUrl.host == allowedOrigin.host &&
      requestUrl.port == allowedOrigin.port;
  return sameOrigin
      ? RichTextWebViewNavigationDecision.allow
      : RichTextWebViewNavigationDecision.cancelAndHandOff;
}

/// Popup / new-window requests are always denied (plan §5.5, point 6) —
/// named function (rather than an inline `false`) so the policy is a single
/// testable, greppable decision point shared by both host backends.
bool shouldAllowPopupOrNewWindow() => false;

/// Callbacks a [RichTextWebViewHost] reports to the shared orchestration
/// layer ([RichTextWebView]'s state). Backend-neutral: neither Flutter host
/// nor Windows host callers know about the other's platform types.
@immutable
class RichTextWebViewHostCallbacks {
  const RichTextWebViewHostCallbacks({
    required this.onPageStarted,
    required this.onPageFinished,
    required this.onMainFrameFailure,
    required this.onRawBridgeMessage,
    required this.onPointerGateOutsidePointer,
    required this.onExternalNavigation,
  });

  /// Main-frame navigation started loading (used to (re)inject bootstrap).
  final void Function(Uri? url) onPageStarted;

  /// Main-frame navigation finished loading.
  final void Function(Uri? url) onPageFinished;

  /// Main-frame failed to load, was cancelled due to navigation policy, or
  /// the host surface itself failed to create.
  final void Function(RichTextWebViewFailure failure) onMainFrameFailure;

  /// A raw string arrived from the Web bridge, **before** capability
  /// envelope validation — [HostedRichTextTransport] validates it.
  final void Function(String rawMessage) onRawBridgeMessage;

  /// The in-page `TgPointerGate` channel/handler reported an outside
  /// pointer while the desktop pointer gate is active.
  final VoidCallback onPointerGateOutsidePointer;

  /// A main-frame navigation to a non-runtime origin was cancelled; the
  /// requested [url] should be handed off to Flutter's link handling.
  final void Function(Uri url) onExternalNavigation;
}

/// Minimal, backend-neutral WebView host contract for the rich-text editor.
///
/// Implementations:
/// - [WebViewFlutterRichTextHost] for Android / iOS / macOS.
/// - [InAppWebViewWindowsRichTextHost] for Windows.
/// - [WebIframeRichTextHost] for Flutter Web.
///
/// This is intentionally not a general-purpose browser abstraction — it only
/// covers the capabilities the shared [RichTextWebView] orchestration needs
/// (see plan §5.2 / Flutter Web plan §8). Runtime materialization, the
/// loopback HTTP server, theme sync, and pointer-gate JS stay in the shared
/// layer on native; Web uses typed host-control over MessagePort instead.
abstract class RichTextWebViewHost {
  RichTextWebViewHost({required this.callbacks});

  final RichTextWebViewHostCallbacks callbacks;

  /// Completes when this host generation's embedded document surface can
  /// safely receive initialization (Host Surface Ready).
  ///
  /// - Windows InAppWebView: completes in `onWebViewCreated`.
  /// - webview_flutter: completes once the controller exists (construction).
  /// - Flutter Web iframe: completes on validated bootstrap `surfaceReady`.
  ///
  /// Shared orchestration must await this before runtime materialize, local
  /// server bind, or [loadUrl]. Retry creates a new host with a fresh future.
  Future<void> get whenSurfaceReady;

  /// Builds the Flutter widget hosting the native WebView / iframe surface.
  ///
  /// Must be idempotent-safe to call once and embed in the widget tree; the
  /// shared layer does not rebuild this per frame.
  Widget buildSurface();

  /// Loads [url] as the main-frame document / iframe entry.
  ///
  /// Implementations that defer controller creation until the surface mounts
  /// must await [whenSurfaceReady] before navigating — except Flutter Web,
  /// where setting `iframe.src` *produces* surfaceReady; that host documents
  /// the order in [WebIframeRichTextHost].
  Future<void> loadUrl(Uri url);

  /// Delivers an unchanged protocol JSON string to the runtime.
  Future<void> deliverProtocol(String protocolJson);

  /// Flutter Web only: one-shot MessagePort initialize after surfaceReady.
  ///
  /// Native hosts throw; shared orchestration calls this only on the web path.
  Future<void> initializeRuntime(Map<String, Object?> config) async {
    throw UnsupportedError(
      '$runtimeType.initializeRuntime is only supported on Flutter Web.',
    );
  }

  /// Executes [script] in the page's main world (native adapters only).
  ///
  /// Prefer typed methods ([deliverProtocol], presentation/interaction APIs).
  /// Flutter Web throws; do not call from shared orchestration on web.
  Future<void> runJavaScript(String script);

  /// Sets the native WebView background color where the platform supports
  /// it. Platforms without a native API (e.g. Windows stable / macOS
  /// WKWebView) may no-op — the shared layer also paints an early CSS +
  /// Flutter cover fallback.
  Future<void> setBackgroundColor(Color color);

  /// Toggles WebView content inspectability (debug builds only).
  Future<void> setInspectable(bool inspectable);

  /// Platform-specific editing-session wakeup (e.g. macOS AppKit reclaim).
  Future<void> wakeEditingSession({bool keepTitle = false});

  /// Flutter Web: register a Blob object URL for an opaque local-media token.
  ///
  /// Native hosts no-op — loopback `/__tg_media__/` resolves paths instead.
  Future<void> registerMedia({
    required String token,
    required String objectUrl,
    String? mimeType,
  }) async {}

  /// Flutter Web: drop a previously registered media rendering URL.
  Future<void> revokeMedia({required String token}) async {}

  /// Flutter Web / typed hosts: update theme, placeholders, shell color.
  Future<void> updatePresentation({
    String? theme,
    String? titlePlaceholder,
    String? placeholder,
    String? shellBackgroundColor,
  }) async {}

  /// Block only host-surface pointer interaction while an overlay is open.
  /// The editor may keep keyboard/IME focus (live @/# trigger menus).
  Future<void> setPointerEventsBlocked(bool blocked) async {}

  /// Block editor focus/keyboard interaction while a focus-owning Flutter
  /// overlay is open (for example a dialog with TextFields).
  Future<void> setInteractionBlocked(bool blocked) async {}

  /// Releases controller, channel/handler, and surface resources.
  Future<void> dispose();
}

/// Thrown by [createRichTextWebViewHost] when host creation fails before any
/// surface widget exists. Carries a fully-formed [RichTextWebViewFailure] so
/// callers can transition straight to the failed state without
/// re-classifying a generic error.
class RichTextWebViewHostCreationException implements Exception {
  RichTextWebViewHostCreationException(this.failure);

  final RichTextWebViewFailure failure;

  @override
  String toString() => 'RichTextWebViewHostCreationException($failure)';
}
