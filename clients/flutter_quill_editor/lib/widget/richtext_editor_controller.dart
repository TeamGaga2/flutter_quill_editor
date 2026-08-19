import 'dart:async';

import 'package:flutter_quill_editor/bridge/richtext_transport.dart';
import 'package:flutter_quill_editor/protocol/codec.dart';
import 'package:flutter_quill_editor/protocol/messages.dart';
import 'package:flutter/foundation.dart';

/// High-level editor API over the v1 rich-text protocol.
///
/// Correlates command responses by `id`. Completes [ready] when a `ready`
/// event is received (or when [markReadyExternally] is used in tests).
///
/// Backend-neutral: this class only depends on [RichTextTransport], never on
/// a concrete WebView plugin type. macOS's focus-recovery quirk is injected
/// via [wakeEditingSessionAction] instead of a `transport is SomeConcreteType`
/// check, so any transport (webview_flutter-backed, InAppWebView-backed, or
/// the in-memory test transport) works identically here.
class RichTextEditorController {
  RichTextEditorController({
    required RichTextTransport transport,
    this.commandTimeout = const Duration(seconds: 10),
    String Function()? idGenerator,
    Future<void> Function({bool keepTitle})? wakeEditingSessionAction,
  }) : _transport = transport,
       _idGenerator = idGenerator ?? _defaultIdGenerator,
       _wakeEditingSessionAction = wakeEditingSessionAction {
    _inboundSub = _transport.inbound.listen(_onInbound, onError: _onInboundError);
  }

  final RichTextTransport _transport;
  final Duration commandTimeout;
  final String Function() _idGenerator;
  final Future<void> Function({bool keepTitle})? _wakeEditingSessionAction;

  final _readyCompleter = Completer<void>();
  final _pending = <String, Completer<ProtocolResponse>>{};
  final _changeController = StreamController<ChangeEvent>.broadcast();
  final _stateController = StreamController<StateChangeEvent>.broadcast();
  final _eventController = StreamController<ProtocolEvent>.broadcast();
  final _selectionController = StreamController<SelectionChangeEvent>.broadcast();
  final _requestCloseController = StreamController<RequestCloseEvent>.broadcast();

  StreamSubscription<String>? _inboundSub;
  ProtocolEditorState? _latestState;
  var _disposed = false;
  var _seq = 0;

  /// Completes once the Web runtime emits `event:ready`.
  Future<void> get ready => _readyCompleter.future;

  bool get isReady => _readyCompleter.isCompleted;

  /// Content change events from the editor.
  Stream<ChangeEvent> get onChange => _changeController.stream;

  /// Toolbar / history state updates.
  Stream<StateChangeEvent> get onState => _stateController.stream;

  /// Most recently received toolbar / history state.
  ProtocolEditorState? get latestState => _latestState;

  /// Selection updates.
  Stream<SelectionChangeEvent> get onSelectionChange => _selectionController.stream;

  /// Host should dismiss the composition panel (Web→Flutter UI intent).
  Stream<RequestCloseEvent> get onRequestClose => _requestCloseController.stream;

  /// All protocol events (including ready/focus/blur/request_close).
  Stream<ProtocolEvent> get onEvent => _eventController.stream;

  // ---------------------------------------------------------------------------
  // Commands
  // ---------------------------------------------------------------------------

  Future<void> setSnapshot(RichTextSnapshot snapshot) async {
    final response = await _request(
      SetSnapshotCommand(id: _nextId('set_snapshot'), snapshot: snapshot),
    );
    _ensureOk(response);
  }

  Future<RichTextSnapshot> getSnapshot() async {
    final response = await _request(
      GetSnapshotCommand(id: _nextId('get_snapshot')),
    );
    final success = _ensureOk(response);
    final snapshot = success.snapshotOrNull;
    if (snapshot == null) {
      throw RichTextEditorException(
        code: ProtocolErrorCode.invalidPayload,
        message: 'get_snapshot response missing snapshot.',
      );
    }
    return snapshot;
  }

  Future<void> setSelection(ProtocolSelection selection) async {
    final response = await _request(
      SetSelectionCommand(id: _nextId('set_selection'), selection: selection),
    );
    _ensureOk(response);
  }

  Future<ProtocolSelection?> getSelection() async {
    final response = await _request(
      GetSelectionCommand(id: _nextId('get_selection')),
    );
    final success = _ensureOk(response);
    return success.selectionOrNull;
  }

  Future<void> toggleInlineFormat(ProtocolInlineFormat format) async {
    final response = await _request(
      ToggleInlineFormatCommand(
        id: _nextId('toggle_inline_format'),
        format: format,
      ),
    );
    _ensureOk(response);
  }

  Future<void> toggleBlockFormatHeader(ProtocolHeaderLevel level) async {
    final response = await _request(
      ToggleBlockFormatCommand.header(
        id: _nextId('toggle_block_format'),
        level: level,
      ),
    );
    _ensureOk(response);
  }

  Future<void> toggleBlockFormatList(ProtocolListType listType) async {
    final response = await _request(
      ToggleBlockFormatCommand.list(
        id: _nextId('toggle_block_format'),
        listType: listType,
      ),
    );
    _ensureOk(response);
  }

  Future<void> toggleBlockFormatBlockquote() async {
    final response = await _request(
      ToggleBlockFormatCommand.blockquote(
        id: _nextId('toggle_block_format'),
      ),
    );
    _ensureOk(response);
  }

  Future<void> insertEmoji(String emojiId) async {
    final response = await _request(
      InsertEmojiCommand(id: _nextId('insert_emoji'), emojiId: emojiId),
    );
    _ensureOk(response);
  }

  /// Inserts a mention, atomically replacing [selection] when supplied.
  Future<void> insertMention({
    required String id,
    required String sign,
    required String displayText,
    ProtocolSelection? selection,
  }) async {
    final response = await _request(
      InsertMentionCommand(
        id: _nextId('insert_mention'),
        typedPayload: InsertMentionPayload(
          id: id,
          sign: sign,
          displayText: displayText,
          selection: selection,
        ),
      ),
    );
    _ensureOk(response);
  }

  /// Inserts a channel, atomically replacing [selection] when supplied.
  Future<void> insertChannel({
    required String id,
    required String displayText,
    ProtocolSelection? selection,
  }) async {
    final response = await _request(
      InsertChannelCommand(
        id: _nextId('insert_channel'),
        typedPayload: InsertChannelPayload(
          id: id,
          displayText: displayText,
          selection: selection,
        ),
      ),
    );
    _ensureOk(response);
  }

  /// Inserts an image, atomically replacing [selection] when supplied.
  Future<void> insertImage({
    required String src,
    required String width,
    required String height,
    required String mimeType,
    required int fileSize,
    ProtocolSelection? selection,
  }) async {
    final response = await _request(
      InsertImageCommand(
        id: _nextId('insert_image'),
        typedPayload: InsertImagePayload(
          src: src,
          width: width,
          height: height,
          mimeType: mimeType,
          fileSize: fileSize,
          selection: selection,
        ),
      ),
    );
    _ensureOk(response);
  }

  /// Inserts a video, atomically replacing [selection] when supplied.
  Future<void> insertVideo({
    required String src,
    required String width,
    required String height,
    required String mimeType,
    required int fileSize,
    String? poster,
    int? duration,
    ProtocolSelection? selection,
  }) async {
    final response = await _request(
      InsertVideoCommand(
        id: _nextId('insert_video'),
        typedPayload: InsertVideoPayload(
          src: src,
          width: width,
          height: height,
          mimeType: mimeType,
          fileSize: fileSize,
          poster: poster,
          duration: duration,
          selection: selection,
        ),
      ),
    );
    _ensureOk(response);
  }

  /// Atomically replaces [selection] with linked [text].
  Future<void> insertLink({
    required String url,
    required String text,
    ProtocolSelection? selection,
  }) async {
    final response = await _request(
      InsertLinkCommand(
        id: _nextId('insert_link'),
        typedPayload: InsertLinkPayload(
          url: url,
          text: text,
          selection: selection,
        ),
      ),
    );
    _ensureOk(response);
  }

  /// Atomically inserts a divider at [selection], or at the current selection.
  Future<void> insertDivider({ProtocolSelection? selection}) async {
    final response = await _request(
      InsertDividerCommand(
        id: _nextId('insert_divider'),
        typedPayload: InsertDividerPayload(selection: selection),
      ),
    );
    _ensureOk(response);
  }

  Future<void> indent() async {
    final response = await _request(IndentCommand(id: _nextId('indent')));
    _ensureOk(response);
  }

  Future<void> outdent() async {
    final response = await _request(OutdentCommand(id: _nextId('outdent')));
    _ensureOk(response);
  }

  /// Returns the caret rect in CSS pixels relative to the WebView viewport,
  /// or `null` when the caret position is unavailable.
  Future<ProtocolCaretRect?> getCaretRect() async {
    final response = await _request(
      GetCaretRectCommand(id: _nextId('get_caret_rect')),
    );
    final success = _ensureOk(response);
    return success.caretRectOrNull;
  }

  Future<void> undo() async {
    final response = await _request(UndoCommand(id: _nextId('undo')));
    _ensureOk(response);
  }

  Future<void> redo() async {
    final response = await _request(RedoCommand(id: _nextId('redo')));
    _ensureOk(response);
  }

  Future<void> focus() async {
    final response = await _request(FocusCommand(id: _nextId('focus')));
    _ensureOk(response);
  }

  Future<void> blur() async {
    final response = await _request(BlurCommand(id: _nextId('blur')));
    _ensureOk(response);
  }

  /// Ask the web runtime to open its in-webview link form popover.
  Future<void> openLinkForm() async {
    final response = await _request(
      OpenLinkFormCommand(id: _nextId('open_link_form')),
    );
    _ensureOk(response);
  }

  /// Reclaim macOS WKWebView editing via title→body focus handoff.
  ///
  /// No-op when no [wakeEditingSessionAction] was injected (e.g. the memory
  /// transport in tests, or non-macOS hosts that never need this recovery).
  Future<void> wakeEditingSession({bool keepTitle = false}) async {
    if (_disposed) return;
    await _wakeEditingSessionAction?.call(keepTitle: keepTitle);
  }

  /// Test/helper: complete [ready] without a real Web event.
  @visibleForTesting
  void markReadyExternally() {
    if (!_readyCompleter.isCompleted) {
      _readyCompleter.complete();
    }
  }

  Future<void> dispose() async {
    if (_disposed) return;
    _disposed = true;
    await _inboundSub?.cancel();
    _inboundSub = null;

    for (final completer in _pending.values) {
      if (!completer.isCompleted) {
        completer.completeError(
          RichTextEditorException(
            code: ProtocolErrorCode.commandFailed,
            message: 'Controller disposed before response.',
          ),
        );
      }
    }
    _pending.clear();

    await _changeController.close();
    await _stateController.close();
    await _eventController.close();
    await _selectionController.close();
    await _requestCloseController.close();
  }

  // ---------------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------------

  Future<ProtocolResponse> _request(ProtocolCommand command) async {
    if (_disposed) {
      throw RichTextEditorException(
        code: ProtocolErrorCode.commandFailed,
        message: 'Controller is disposed.',
      );
    }

    // Host may still be mounting; commands sent before ready are easy to lose
    // (or hang) when the deliver bridge is not wired yet.
    if (!_readyCompleter.isCompleted) {
      try {
        await _readyCompleter.future.timeout(commandTimeout);
      } on TimeoutException {
        throw RichTextEditorException(
          code: ProtocolErrorCode.editorNotReady,
          message: 'Editor not ready after $commandTimeout; cannot run ${command.type}.',
        );
      }
    }
    if (_disposed) {
      throw RichTextEditorException(
        code: ProtocolErrorCode.commandFailed,
        message: 'Controller is disposed.',
      );
    }

    final completer = Completer<ProtocolResponse>();
    _pending[command.id] = completer;

    try {
      final encoded = encodeProtocolMessage(command);
      await _transport.send(encoded);
    } on Object catch (error, stack) {
      _pending.remove(command.id);
      if (!completer.isCompleted) {
        completer.completeError(error, stack);
      }
      rethrow;
    }

    try {
      return await completer.future.timeout(
        commandTimeout,
        onTimeout: () {
          _pending.remove(command.id);
          throw RichTextEditorException(
            code: ProtocolErrorCode.commandFailed,
            message: 'Command ${command.type} timed out after $commandTimeout.',
          );
        },
      );
    } finally {
      _pending.remove(command.id);
    }
  }

  void _onInbound(String raw) {
    final parsed = decodeProtocolMessage(raw);
    if (parsed is ProtocolParseFailure<ProtocolMessage>) {
      debugPrint(
        'RichTextEditorController: failed to decode inbound message: '
        '${parsed.error}',
      );
      return;
    }
    final message = (parsed as ProtocolParseSuccess<ProtocolMessage>).value;

    switch (message) {
      case ProtocolResponse():
        final pending = _pending.remove(message.id);
        if (pending != null && !pending.isCompleted) {
          pending.complete(message);
        }
      case ProtocolEvent():
        _handleEvent(message);
      case ProtocolCommand():
        debugPrint(
          'RichTextEditorController: unexpected inbound command ${message.type}',
        );
    }
  }

  void _handleEvent(ProtocolEvent event) {
    if (!_eventController.isClosed) {
      _eventController.add(event);
    }

    switch (event) {
      case ReadyEvent():
        if (!_readyCompleter.isCompleted) {
          _readyCompleter.complete();
        }
      case ChangeEvent():
        if (!_changeController.isClosed) {
          _changeController.add(event);
        }
      case StateChangeEvent():
        _latestState = event.state;
        if (!_stateController.isClosed) {
          _stateController.add(event);
        }
      case SelectionChangeEvent():
        if (!_selectionController.isClosed) {
          _selectionController.add(event);
        }
      case RequestCloseEvent():
        if (!_requestCloseController.isClosed) {
          _requestCloseController.add(event);
        }
      case FocusEvent():
      case BlurEvent():
      case TitleFocusEvent():
      case TitleBlurEvent():
        break;
    }
  }

  void _onInboundError(Object error, StackTrace stack) {
    debugPrint('RichTextEditorController inbound error: $error\n$stack');
  }

  ProtocolSuccessResponse _ensureOk(ProtocolResponse response) {
    switch (response) {
      case ProtocolSuccessResponse():
        return response;
      case ProtocolFailureResponse():
        throw RichTextEditorException(
          code: response.error.code,
          message: response.error.message,
          details: response.error.details,
          responseId: response.id,
        );
    }
  }

  String _nextId(String prefix) {
    _seq += 1;
    return '${_idGenerator()}_${prefix}_$_seq';
  }

  static String _defaultIdGenerator() => 'rt_${DateTime.now().microsecondsSinceEpoch}';
}

/// Error thrown by [RichTextEditorController] for failed / timed-out commands.
class RichTextEditorException implements Exception {
  RichTextEditorException({
    required this.code,
    required this.message,
    this.details,
    this.responseId,
  });

  final ProtocolErrorCode code;
  final String message;
  final Object? details;
  final String? responseId;

  @override
  String toString() => 'RichTextEditorException($code, $message, id: $responseId)';
}
