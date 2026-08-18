import 'dart:async';

import 'package:flutter_quill_editor/bridge/richtext_transport.dart';
import 'package:flutter_quill_editor/host/bridge_capability.dart';
import 'package:flutter_quill_editor/host/richtext_webview_host.dart';
import 'package:flutter/foundation.dart';

/// Backend-neutral [RichTextTransport] implementation sitting on top of a
/// [RichTextWebViewHost].
///
/// Neither the wire contract nor [RichTextEditorController] know which
/// concrete host backs this transport:
/// - Flutter → Web: [RichTextWebViewHost.deliverProtocol] (native JS deliver
///   or Flutter Web MessagePort protocol plane).
/// - Web → Flutter: raw strings arrive via
///   [RichTextWebViewHostCallbacks.onRawBridgeMessage] (wired by the host);
///   this class validates the [BridgeCapability] envelope and only forwards
///   the inner protocol JSON string on [inbound]. Invalid/missing tokens are
///   dropped silently (debug-log only) per plan §5.5.
class HostedRichTextTransport implements RichTextTransport {
  HostedRichTextTransport({
    required RichTextWebViewHost host,
    required BridgeCapability capability,
  }) : _host = host,
       _capability = capability;

  final RichTextWebViewHost _host;
  final BridgeCapability _capability;
  final _inboundController = StreamController<String>.broadcast();
  var _disposed = false;

  /// Called by the owning host wiring whenever a raw bridge string arrives.
  ///
  /// Kept as an explicit method (rather than having this class subscribe to
  /// a stream itself) so hosts can forward messages the moment they arrive
  /// from a platform channel/handler callback without an extra stream hop.
  void handleRawBridgeMessage(String raw) {
    if (_disposed || _inboundController.isClosed) return;
    final payload = _capability.decodeAndValidate(raw);
    if (payload == null) {
      if (kDebugMode) {
        debugPrint(
          'HostedRichTextTransport: dropped bridge message with missing/invalid capability token.',
        );
      }
      return;
    }
    _inboundController.add(payload);
  }

  /// Forwards a protocol JSON string that already passed host-side validation
  /// (e.g. MessagePort protocol plane on Flutter Web).
  void handleValidatedProtocolMessage(String protocolJson) {
    if (_disposed || _inboundController.isClosed) return;
    _inboundController.add(protocolJson);
  }

  @override
  Stream<String> get inbound => _inboundController.stream;

  @override
  Future<void> send(String message) async {
    if (_disposed) {
      throw StateError('HostedRichTextTransport has been disposed.');
    }
    await _host.deliverProtocol(message);
  }

  /// macOS: briefly focus the in-Web title textarea, then the body editor.
  ///
  /// Mirrors the manual recovery (title click wakes WKWebView, then body
  /// works). No-op on backends without a wake implementation.
  Future<void> wakeEditingSession({bool keepTitle = false}) async {
    if (_disposed) return;
    await _host.wakeEditingSession(keepTitle: keepTitle);
  }

  @override
  Future<void> dispose() async {
    if (_disposed) return;
    _disposed = true;
    await _inboundController.close();
  }
}
