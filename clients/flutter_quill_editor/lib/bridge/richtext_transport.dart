import 'dart:async';

/// Bidirectional transport between Flutter and the rich-text WebView runtime.
///
/// Wire messages are JSON **strings** matching `@teamgaga/richtext-protocol`.
abstract class RichTextTransport {
  /// Send a JSON protocol string to the Web runtime.
  Future<void> send(String message);

  /// Stream of inbound JSON protocol strings from the Web runtime.
  Stream<String> get inbound;

  /// Tear down channel listeners and release resources.
  Future<void> dispose();
}

/// In-memory transport for unit tests (mirrors host-web memory transport).
class MemoryRichTextTransport implements RichTextTransport {
  final _inboundController = StreamController<String>.broadcast();
  final _outboundController = StreamController<String>.broadcast();
  var _disposed = false;

  /// Messages Flutter sent to the "web" side.
  Stream<String> get outbound => _outboundController.stream;

  /// Inject a message as if it came from the Web runtime.
  void deliverFromWeb(String message) {
    if (_disposed) return;
    _inboundController.add(message);
  }

  @override
  Stream<String> get inbound => _inboundController.stream;

  @override
  Future<void> send(String message) async {
    if (_disposed) {
      throw StateError('MemoryRichTextTransport has been disposed.');
    }
    _outboundController.add(message);
  }

  @override
  Future<void> dispose() async {
    if (_disposed) return;
    _disposed = true;
    await _inboundController.close();
    await _outboundController.close();
  }
}
