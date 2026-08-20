import 'dart:async';
import 'dart:convert';
import 'dart:js_interop';
import 'dart:ui_web' as ui_web;

import 'package:flutter_quill_editor/host/iframe_host_envelope.dart';
import 'package:flutter_quill_editor/host/richtext_webview_host.dart';
import 'package:flutter_quill_editor/host/runtime_manifest.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter/widgets.dart';
import 'package:web/web.dart' as web;

/// Flutter Web [RichTextWebViewHost] backed by a same-origin iframe.
///
/// Lifecycle (ADR-0005 / plan §6):
/// 1. [buildSurface] mounts a sandboxed iframe (no src yet).
/// 2. [loadUrl] sets the content-addressed entry URL and waits for bootstrap
///    `surfaceReady` → completes [whenSurfaceReady].
/// 3. [initializeRuntime] transfers a MessagePort + capability token.
/// 4. Protocol traffic uses [deliverProtocol] on the host-envelope protocol plane.
class WebIframeRichTextHost extends RichTextWebViewHost {
  WebIframeRichTextHost({
    required super.callbacks,
    required String capabilityToken,
    RichTextRuntimeManifest manifest = kRichTextRuntimeManifest,
  }) : _manifest = manifest,
       _capabilityToken = capabilityToken {
    _viewType = 'tg-richtext-iframe-${identityHashCode(this)}';
    ui_web.platformViewRegistry.registerViewFactory(_viewType, (int viewId) {
      _iframe = web.HTMLIFrameElement()
        ..id = 'tg-richtext-iframe-$viewId'
        ..style.border = 'none'
        ..style.width = '100%'
        ..style.height = '100%'
        ..setAttribute('sandbox', 'allow-scripts allow-same-origin allow-forms')
        ..referrerPolicy = 'no-referrer';
      if (!_iframeMounted.isCompleted) {
        _iframeMounted.complete();
      }
      return _iframe!;
    });
  }

  final RichTextRuntimeManifest _manifest;
  final String _capabilityToken;
  late final String _viewType;

  web.HTMLIFrameElement? _iframe;
  web.MessagePort? _port;
  StreamSubscription<web.Event>? _windowMessageSub;
  web.EventListener? _portMessageListener;

  final Completer<void> _iframeMounted = Completer<void>();
  final Completer<void> _surfaceReady = Completer<void>();
  final Completer<void> _initializeAck = Completer<void>();
  var _initialized = false;
  var _disposed = false;

  @override
  Future<void> get whenSurfaceReady => _surfaceReady.future;

  @override
  Widget buildSurface() => HtmlElementView(viewType: _viewType);

  @override
  Future<void> loadUrl(Uri url) async {
    if (_disposed) {
      throw StateError('WebIframeRichTextHost.loadUrl called after dispose.');
    }

    await _iframeMounted.future;

    if (_disposed) {
      throw StateError('WebIframeRichTextHost.loadUrl called after dispose.');
    }

    final iframe = _iframe;
    if (iframe == null) {
      throw StateError('WebIframeRichTextHost.loadUrl called before buildSurface mounted.');
    }

    _installWindowHandshakeListener();
    iframe.src = url.toString();
  }

  void _installWindowHandshakeListener() {
    _windowMessageSub?.cancel();
    _windowMessageSub = web.window.onMessage.listen((event) {
      if (_disposed || _surfaceReady.isCompleted) return;
      if (event.origin != web.window.location.origin) return;
      if (event.source != _iframe?.contentWindow) return;

      final data = _jsAnyToMap(event.data);
      if (data == null || !isSurfaceReadyHandshake(data)) return;

      final protocolVersion = data['protocolVersion'] as int;
      final hostEnvelopeVersion = data['hostEnvelopeVersion'] as int;
      final buildId = data['buildId'] as String;

      if (protocolVersion != _manifest.protocolVersion ||
          hostEnvelopeVersion != _manifest.hostEnvelopeVersion ||
          buildId != _manifest.buildId) {
        callbacks.onMainFrameFailure(
          RichTextWebViewFailure(
            stage: RichTextWebViewFailureStage.runtimeMismatch,
            message: 'iframe surfaceReady identity does not match vendored manifest.',
            diagnostics: <String, String>{
              'expectedBuildId': _manifest.buildId,
              'actualBuildId': buildId,
              'expectedProtocol': '${_manifest.protocolVersion}',
              'actualProtocol': '$protocolVersion',
            },
          ),
        );
        if (!_surfaceReady.isCompleted) {
          _surfaceReady.completeError(
            StateError('runtimeMismatch'),
            StackTrace.current,
          );
        }
        return;
      }

      if (!_surfaceReady.isCompleted) {
        _surfaceReady.complete();
      }
    });
  }

  /// One-shot initialize after [whenSurfaceReady]. Transfers the MessagePort.
  @override
  Future<void> initializeRuntime(Map<String, Object?> config) async {
    if (_disposed) return;
    if (_initialized) {
      throw StateError('WebIframeRichTextHost.initializeRuntime may only run once.');
    }
    await whenSurfaceReady;
    final contentWindow = _iframe?.contentWindow;
    if (contentWindow == null) {
      throw StateError('iframe contentWindow is null during initialize.');
    }

    final channel = web.MessageChannel();
    _port = channel.port1;
    _portMessageListener = ((web.Event event) {
      _onPortMessage(event as web.MessageEvent);
    }).toJS;
    _port!.addEventListener('message', _portMessageListener);
    _port!.start();

    final handshake = encodeInitializeHandshake(
      token: _capabilityToken,
      config: config,
    );
    contentWindow.postMessage(
      _mapToJs(handshake),
      web.window.location.origin.toJS,
      <JSObject>[channel.port2].toJS,
    );
    _initialized = true;

    // Handshake listener is no longer needed for protocol traffic.
    await _windowMessageSub?.cancel();
    _windowMessageSub = null;

    try {
      await _initializeAck.future.timeout(kRichTextWebViewChannelInitTimeout);
    } on TimeoutException {
      throw StateError(
        'initializeAck was not received within $kRichTextWebViewChannelInitTimeout.',
      );
    }
  }

  void _onPortMessage(web.MessageEvent event) {
    if (_disposed) return;
    final data = _jsAnyToMap(event.data);
    if (data == null) return;
    if (data['namespace'] != kHostEnvelopeNamespace) return;
    if (data['version'] != kHostEnvelopeVersion) return;
    if (data['token'] != _capabilityToken) return;

    final plane = data['plane'];
    if (plane == 'protocol') {
      final payload = data['payload'];
      if (payload is String && payload.isNotEmpty) {
        // Web MessagePort protocol plane carries bare protocol JSON — no
        // native bridge capability envelope wrapper.
        callbacks.onRawBridgeMessage(_wrapAsNativeCapabilityEnvelope(payload));
      }
      return;
    }

    if (plane == 'host-control') {
      final payload = data['payload'];
      if (payload is Map && payload['type'] == 'initializeAck') {
        if (!_initializeAck.isCompleted) {
          _initializeAck.complete();
        }
      }
      if (kDebugMode) {
        debugPrint('WebIframeRichTextHost host-control: ${data['payload']}');
      }
    }
  }

  /// Native transport validates a capability envelope; MessagePort already
  /// authenticated via token, so wrap for [HostedRichTextTransport].
  String _wrapAsNativeCapabilityEnvelope(String protocolJson) {
    return jsonEncode(<String, Object?>{
      'v': 1,
      't': _capabilityToken,
      'p': protocolJson,
    });
  }

  @override
  Future<void> deliverProtocol(String protocolJson) async {
    final port = _port;
    if (port == null) {
      throw StateError('deliverProtocol called before initializeRuntime.');
    }
    port.postMessage(
      _mapToJs(
        encodeProtocolEnvelope(token: _capabilityToken, protocolJson: protocolJson),
      ),
    );
  }

  @override
  Future<void> runJavaScript(String script) async {
    throw UnsupportedError(
      'WebIframeRichTextHost does not support runJavaScript; use typed host APIs.',
    );
  }

  @override
  Future<void> setBackgroundColor(Color color) async {
    final iframe = _iframe;
    if (iframe == null) return;
    final hex = '#${color.toARGB32().toRadixString(16).padLeft(8, '0').substring(2)}';
    iframe.style.background = hex;
  }

  @override
  Future<void> setInspectable(bool inspectable) async {}

  @override
  Future<void> wakeEditingSession({bool keepTitle = false}) async {
    final port = _port;
    if (port == null) return;
    port.postMessage(
      _mapToJs(
        encodeHostControlEnvelope(
          token: _capabilityToken,
          operation: <String, Object?>{
            'type': 'wakeEditingSession',
            'keepTitle': keepTitle,
          },
        ),
      ),
    );
  }

  @override
  Future<void> registerMedia({
    required String token,
    required String objectUrl,
    String? mimeType,
  }) async {
    final port = _port;
    if (port == null) {
      throw StateError('registerMedia called before initializeRuntime.');
    }
    port.postMessage(
      _mapToJs(
        encodeHostControlEnvelope(
          token: _capabilityToken,
          operation: <String, Object?>{
            'type': 'registerMedia',
            'token': token,
            'objectUrl': objectUrl,
            'mimeType': ?mimeType,
          },
        ),
      ),
    );
  }

  @override
  Future<void> revokeMedia({required String token}) async {
    final port = _port;
    if (port == null) return;
    port.postMessage(
      _mapToJs(
        encodeHostControlEnvelope(
          token: _capabilityToken,
          operation: <String, Object?>{
            'type': 'revokeMedia',
            'token': token,
          },
        ),
      ),
    );
  }

  @override
  Future<void> setPointerEventsBlocked(bool blocked) async {
    final iframe = _iframe;
    if (iframe != null) {
      iframe.style.pointerEvents = blocked ? 'none' : '';
    }
  }

  @override
  Future<void> setInteractionBlocked(bool blocked) async {
    final iframe = _iframe;
    if (iframe != null) {
      // Drop iframe browsing-context focus so parent Flutter TextFields (link
      // dialog inputs) can keep the caret. Pointer-only trigger menus do not
      // call this path and therefore preserve contentEditable + IME focus.
      if (blocked) {
        try {
          iframe.blur();
        } catch (_) {}
      }
    }
    final port = _port;
    if (port == null) return;
    port.postMessage(
      _mapToJs(
        encodeHostControlEnvelope(
          token: _capabilityToken,
          operation: <String, Object?>{
            'type': 'setInteractionBlocked',
            'blocked': blocked,
          },
        ),
      ),
    );
  }

  @override
  Future<void> updatePresentation({
    String? theme,
    String? titlePlaceholder,
    String? placeholder,
    String? shellBackgroundColor,
  }) async {
    final port = _port;
    if (port == null) return;
    port.postMessage(
      _mapToJs(
        encodeHostControlEnvelope(
          token: _capabilityToken,
          operation: <String, Object?>{
            'type': 'updatePresentation',
            'theme': ?theme,
            'titlePlaceholder': ?titlePlaceholder,
            'placeholder': ?placeholder,
            'shellBackgroundColor': ?shellBackgroundColor,
          },
        ),
      ),
    );
  }

  @override
  Future<void> dispose() async {
    if (_disposed) return;
    _disposed = true;
    if (!_iframeMounted.isCompleted) {
      _iframeMounted.completeError(StateError('WebIframeRichTextHost disposed before mount.'));
    }
    await _windowMessageSub?.cancel();
    _windowMessageSub = null;
    final port = _port;
    final listener = _portMessageListener;
    if (port != null && listener != null) {
      port.removeEventListener('message', listener);
    }
    _portMessageListener = null;
    try {
      port?.close();
    } catch (_) {}
    _port = null;
    if (_iframe != null) {
      _iframe!.src = 'about:blank';
    }
    if (!_surfaceReady.isCompleted) {
      _surfaceReady.complete();
    }
  }
}

Map<String, dynamic>? _jsAnyToMap(JSAny? data) {
  if (data == null) return null;
  try {
    final decoded = data.dartify();
    if (decoded is Map) {
      return decoded.map((key, value) => MapEntry('$key', value));
    }
  } catch (_) {}
  return null;
}

JSAny _mapToJs(Map<String, Object?> map) => map.jsify()!;
