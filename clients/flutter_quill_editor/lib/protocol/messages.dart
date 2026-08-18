import 'package:flutter_quill_editor/protocol/protocol_version.dart';
import 'package:flutter/foundation.dart';

/// JSON-compatible map used for protocol payloads and snapshots.
typedef ProtocolJsonMap = Map<String, Object?>;

/// Stable protocol error codes (match TS `ProtocolErrorCode`).
enum ProtocolErrorCode {
  invalidJson('invalid_json'),
  invalidMessage('invalid_message'),
  unsupportedVersion('unsupported_version'),
  unsupportedCommand('unsupported_command'),
  invalidPayload('invalid_payload'),
  editorNotReady('editor_not_ready'),
  commandFailed('command_failed');

  const ProtocolErrorCode(this.wire);
  final String wire;

  static ProtocolErrorCode? tryParse(String value) {
    for (final code in ProtocolErrorCode.values) {
      if (code.wire == value) return code;
    }
    return null;
  }
}

/// Inline format tokens for `toggle_inline_format`.
enum ProtocolInlineFormat {
  bold,
  italic,
  underline,
  strike;

  String get wire => name;

  static ProtocolInlineFormat? tryParse(String value) {
    for (final format in ProtocolInlineFormat.values) {
      if (format.wire == value) return format;
    }
    return null;
  }
}

/// Header levels for block format.
enum ProtocolHeaderLevel {
  h1(1),
  h2(2),
  h3(3);

  const ProtocolHeaderLevel(this.value);
  final int value;

  static ProtocolHeaderLevel? tryParse(Object? value) {
    if (value is! int) return null;
    for (final level in ProtocolHeaderLevel.values) {
      if (level.value == value) return level;
    }
    return null;
  }
}

/// List types for block format.
enum ProtocolListType {
  ordered,
  bullet;

  String get wire => name;

  static ProtocolListType? tryParse(String value) {
    for (final type in ProtocolListType.values) {
      if (type.wire == value) return type;
    }
    return null;
  }
}

/// Editor selection range (UTF-16 style offsets as used by the runtime).
@immutable
class ProtocolSelection {
  const ProtocolSelection({required this.start, required this.end});

  factory ProtocolSelection.fromJson(ProtocolJsonMap json) {
    return ProtocolSelection(
      start: json['start']! as int,
      end: json['end']! as int,
    );
  }

  final int start;
  final int end;

  ProtocolJsonMap toJson() => <String, Object?>{'start': start, 'end': end};

  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      other is ProtocolSelection && start == other.start && end == other.end;

  @override
  int get hashCode => Object.hash(start, end);
}

/// Payload for an atomic mention insertion.
///
/// When [selection] is provided, the runtime replaces that UTF-16 range as
/// part of the same editor operation. When it is omitted, the runtime uses
/// its current (or last known) selection.
final class InsertMentionPayload {
  const InsertMentionPayload({
    required this.id,
    required this.sign,
    required this.displayText,
    this.selection,
  });

  factory InsertMentionPayload.fromJson(ProtocolJsonMap json) {
    return InsertMentionPayload(
      id: json['id']! as String,
      sign: json['sign']! as String,
      displayText: json['displayText']! as String,
      selection: _optionalSelectionFromJson(json['selection']),
    );
  }

  final String id;
  final String sign;
  final String displayText;
  final ProtocolSelection? selection;

  ProtocolJsonMap toJson() => <String, Object?>{
    'id': id,
    'sign': sign,
    'displayText': displayText,
    if (selection != null) 'selection': selection!.toJson(),
  };
}

/// Payload for an atomic channel insertion.
final class InsertChannelPayload {
  const InsertChannelPayload({
    required this.id,
    required this.displayText,
    this.selection,
  });

  factory InsertChannelPayload.fromJson(ProtocolJsonMap json) {
    return InsertChannelPayload(
      id: json['id']! as String,
      displayText: json['displayText']! as String,
      selection: _optionalSelectionFromJson(json['selection']),
    );
  }

  final String id;
  final String displayText;
  final ProtocolSelection? selection;

  ProtocolJsonMap toJson() => <String, Object?>{
    'id': id,
    'displayText': displayText,
    if (selection != null) 'selection': selection!.toJson(),
  };
}

/// Payload for an atomic image insertion.
final class InsertImagePayload {
  const InsertImagePayload({
    required this.src,
    required this.width,
    required this.height,
    required this.mimeType,
    required this.fileSize,
    this.selection,
  });

  factory InsertImagePayload.fromJson(ProtocolJsonMap json) {
    return InsertImagePayload(
      src: json['src']! as String,
      width: json['width']! as String,
      height: json['height']! as String,
      mimeType: json['mimeType']! as String,
      fileSize: json['fileSize']! as int,
      selection: _optionalSelectionFromJson(json['selection']),
    );
  }

  final String src;
  final String width;
  final String height;
  final String mimeType;
  final int fileSize;
  final ProtocolSelection? selection;

  ProtocolJsonMap toJson() => <String, Object?>{
    'src': src,
    'width': width,
    'height': height,
    'mimeType': mimeType,
    'fileSize': fileSize,
    if (selection != null) 'selection': selection!.toJson(),
  };
}

/// Payload for an atomic video insertion.
final class InsertVideoPayload {
  const InsertVideoPayload({
    required this.src,
    required this.width,
    required this.height,
    required this.mimeType,
    required this.fileSize,
    this.poster,
    this.duration,
    this.selection,
  });

  factory InsertVideoPayload.fromJson(ProtocolJsonMap json) {
    return InsertVideoPayload(
      src: json['src']! as String,
      width: json['width']! as String,
      height: json['height']! as String,
      mimeType: json['mimeType']! as String,
      fileSize: json['fileSize']! as int,
      poster: json['poster'] as String?,
      duration: json['duration'] as int?,
      selection: _optionalSelectionFromJson(json['selection']),
    );
  }

  final String src;
  final String width;
  final String height;
  final String mimeType;
  final int fileSize;
  final String? poster;
  final int? duration;
  final ProtocolSelection? selection;

  ProtocolJsonMap toJson() => <String, Object?>{
    'src': src,
    'width': width,
    'height': height,
    'mimeType': mimeType,
    'fileSize': fileSize,
    if (poster != null) 'poster': poster,
    if (duration != null) 'duration': duration,
    if (selection != null) 'selection': selection!.toJson(),
  };
}

/// Payload for atomically replacing a selection with linked text.
final class InsertLinkPayload {
  const InsertLinkPayload({
    required this.url,
    required this.text,
    this.selection,
  });

  factory InsertLinkPayload.fromJson(ProtocolJsonMap json) {
    return InsertLinkPayload(
      url: json['url']! as String,
      text: json['text']! as String,
      selection: _optionalSelectionFromJson(json['selection']),
    );
  }

  final String url;
  final String text;
  final ProtocolSelection? selection;

  ProtocolJsonMap toJson() => <String, Object?>{
    'url': url,
    'text': text,
    if (selection != null) 'selection': selection!.toJson(),
  };
}

/// Payload for atomically inserting a divider at a selection.
final class InsertDividerPayload {
  const InsertDividerPayload({this.selection});

  factory InsertDividerPayload.fromJson(ProtocolJsonMap json) {
    return InsertDividerPayload(
      selection: _optionalSelectionFromJson(json['selection']),
    );
  }

  final ProtocolSelection? selection;

  ProtocolJsonMap toJson() => <String, Object?>{
    if (selection != null) 'selection': selection!.toJson(),
  };
}

/// Pixel rect relative to the WebView viewport (CSS pixels).
@immutable
class ProtocolCaretRect {
  const ProtocolCaretRect({
    required this.x,
    required this.y,
    required this.width,
    required this.height,
  });

  factory ProtocolCaretRect.fromJson(ProtocolJsonMap json) {
    return ProtocolCaretRect(
      x: json['x']! as num,
      y: json['y']! as num,
      width: json['width']! as num,
      height: json['height']! as num,
    );
  }

  final num x;
  final num y;
  final num width;
  final num height;

  ProtocolJsonMap toJson() => <String, Object?>{
    'x': x,
    'y': y,
    'width': width,
    'height': height,
  };

  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      other is ProtocolCaretRect &&
          x == other.x &&
          y == other.y &&
          width == other.width &&
          height == other.height;

  @override
  int get hashCode => Object.hash(x, y, width, height);
}

ProtocolSelection? _optionalSelectionFromJson(Object? raw) {
  if (raw == null) return null;
  return ProtocolSelection.fromJson(
    (raw as Map).map((key, value) => MapEntry(key.toString(), value as Object?)),
  );
}

/// Delta snapshot wire object. Kept as a JSON map so unknown optional fields
/// (title/size/theme) round-trip without a full Delta port on the Dart side.
@immutable
class RichTextSnapshot {
  const RichTextSnapshot(this.json);

  factory RichTextSnapshot.fromJson(Object? raw) {
    if (raw is! Map) {
      throw const FormatException('Snapshot must be an object.');
    }
    return RichTextSnapshot(
      raw.map((key, value) => MapEntry(key.toString(), value as Object?)),
    );
  }

  final ProtocolJsonMap json;

  List<Object?> get content {
    final value = json['content'];
    if (value is List) {
      return value.cast<Object?>();
    }
    return const <Object?>[];
  }

  /// Optional document title (WebView PC shell or legacy snapshot field).
  String? get title {
    final value = json['title'];
    return value is String ? value : null;
  }

  ProtocolJsonMap toJson() => Map<String, Object?>.from(json);

  @override
  bool operator ==(Object other) {
    if (identical(this, other)) return true;
    if (other is! RichTextSnapshot) return false;
    return _deepEquals(json, other.json);
  }

  @override
  int get hashCode => Object.hashAll(json.entries.map((e) => Object.hash(e.key, e.value)));
}

/// Active formats reported in `state_change`.
class ProtocolEditorFormats {
  const ProtocolEditorFormats({
    required this.bold,
    required this.italic,
    required this.underline,
    required this.strike,
    required this.header,
    required this.list,
    required this.blockquote,
  });

  factory ProtocolEditorFormats.fromJson(ProtocolJsonMap json) {
    return ProtocolEditorFormats(
      bold: json['bold']! as bool,
      italic: json['italic']! as bool,
      underline: json['underline']! as bool,
      strike: json['strike']! as bool,
      header: json['header']!,
      list: json['list']!,
      blockquote: json['blockquote']! as bool,
    );
  }

  final bool bold;
  final bool italic;
  final bool underline;
  final bool strike;

  /// `false` or header level 1–3.
  final Object header;

  /// `false`, `"ordered"`, or `"bullet"`.
  final Object list;
  final bool blockquote;

  ProtocolJsonMap toJson() => <String, Object?>{
    'bold': bold,
    'italic': italic,
    'underline': underline,
    'strike': strike,
    'header': header,
    'list': list,
    'blockquote': blockquote,
  };
}

/// Aggregated editor state for toolbar / history buttons.
class ProtocolEditorState {
  const ProtocolEditorState({
    required this.focused,
    required this.selection,
    required this.canUndo,
    required this.canRedo,
    required this.formats,
  });

  factory ProtocolEditorState.fromJson(ProtocolJsonMap json) {
    final selectionRaw = json['selection'];
    return ProtocolEditorState(
      focused: json['focused']! as bool,
      selection: selectionRaw == null
          ? null
          : ProtocolSelection.fromJson(
              (selectionRaw as Map).map(
                (key, value) => MapEntry(key.toString(), value as Object?),
              ),
            ),
      canUndo: json['canUndo']! as bool,
      canRedo: json['canRedo']! as bool,
      formats: ProtocolEditorFormats.fromJson(
        (json['formats']! as Map).map(
          (key, value) => MapEntry(key.toString(), value as Object?),
        ),
      ),
    );
  }

  final bool focused;
  final ProtocolSelection? selection;
  final bool canUndo;
  final bool canRedo;

  /// Formats at the active selection, or the last valid selection while blurred.
  final ProtocolEditorFormats formats;

  ProtocolJsonMap toJson() => <String, Object?>{
    'focused': focused,
    'selection': selection?.toJson(),
    'canUndo': canUndo,
    'canRedo': canRedo,
    'formats': formats.toJson(),
  };
}

// ---------------------------------------------------------------------------
// Messages
// ---------------------------------------------------------------------------

/// Top-level protocol message (command | response | event).
sealed class ProtocolMessage {
  const ProtocolMessage();

  int get version;
  String get kind;

  ProtocolJsonMap toJson();
}

/// Command sent Flutter → Web. Every command has a non-empty [id].
sealed class ProtocolCommand extends ProtocolMessage {
  const ProtocolCommand({required this.id});

  final String id;

  @override
  String get kind => 'command';

  String get type;
  ProtocolJsonMap get payload;

  @override
  ProtocolJsonMap toJson() => <String, Object?>{
    'version': version,
    'kind': kind,
    'id': id,
    'type': type,
    'payload': payload,
  };
}

final class SetSnapshotCommand extends ProtocolCommand {
  SetSnapshotCommand({
    required super.id,
    required this.snapshot,
    this.version = kRichTextProtocolVersion,
  });

  @override
  final int version;
  final RichTextSnapshot snapshot;

  @override
  String get type => 'set_snapshot';

  @override
  ProtocolJsonMap get payload => <String, Object?>{'snapshot': snapshot.toJson()};
}

final class GetSnapshotCommand extends ProtocolCommand {
  GetSnapshotCommand({
    required super.id,
    this.version = kRichTextProtocolVersion,
  });

  @override
  final int version;

  @override
  String get type => 'get_snapshot';

  @override
  ProtocolJsonMap get payload => const <String, Object?>{};
}

final class SetSelectionCommand extends ProtocolCommand {
  SetSelectionCommand({
    required super.id,
    required this.selection,
    this.version = kRichTextProtocolVersion,
  });

  @override
  final int version;
  final ProtocolSelection selection;

  @override
  String get type => 'set_selection';

  @override
  ProtocolJsonMap get payload => <String, Object?>{'selection': selection.toJson()};
}

final class GetSelectionCommand extends ProtocolCommand {
  GetSelectionCommand({
    required super.id,
    this.version = kRichTextProtocolVersion,
  });

  @override
  final int version;

  @override
  String get type => 'get_selection';

  @override
  ProtocolJsonMap get payload => const <String, Object?>{};
}

final class ToggleInlineFormatCommand extends ProtocolCommand {
  ToggleInlineFormatCommand({
    required super.id,
    required this.format,
    this.version = kRichTextProtocolVersion,
  });

  @override
  final int version;
  final ProtocolInlineFormat format;

  @override
  String get type => 'toggle_inline_format';

  @override
  ProtocolJsonMap get payload => <String, Object?>{'format': format.wire};
}

/// Block format toggle. Use factories for typed variants.
final class ToggleBlockFormatCommand extends ProtocolCommand {
  ToggleBlockFormatCommand._({
    required super.id,
    required this.format,
    this.value,
    this.version = kRichTextProtocolVersion,
  });

  factory ToggleBlockFormatCommand.header({
    required String id,
    required ProtocolHeaderLevel level,
    int version = kRichTextProtocolVersion,
  }) {
    return ToggleBlockFormatCommand._(
      id: id,
      format: 'header',
      value: level.value,
      version: version,
    );
  }

  factory ToggleBlockFormatCommand.list({
    required String id,
    required ProtocolListType listType,
    int version = kRichTextProtocolVersion,
  }) {
    return ToggleBlockFormatCommand._(
      id: id,
      format: 'list',
      value: listType.wire,
      version: version,
    );
  }

  factory ToggleBlockFormatCommand.blockquote({
    required String id,
    int version = kRichTextProtocolVersion,
  }) {
    return ToggleBlockFormatCommand._(
      id: id,
      format: 'blockquote',
      version: version,
    );
  }

  @override
  final int version;
  final String format;
  final Object? value;

  @override
  String get type => 'toggle_block_format';

  @override
  ProtocolJsonMap get payload {
    if (format == 'blockquote') {
      return <String, Object?>{'format': format};
    }
    return <String, Object?>{'format': format, 'value': value};
  }
}

final class InsertEmojiCommand extends ProtocolCommand {
  InsertEmojiCommand({
    required super.id,
    required this.emojiId,
    this.version = kRichTextProtocolVersion,
  });

  @override
  final int version;

  /// Wire field is `id` inside payload.
  final String emojiId;

  @override
  String get type => 'insert_emoji';

  @override
  ProtocolJsonMap get payload => <String, Object?>{'id': emojiId};
}

final class InsertMentionCommand extends ProtocolCommand {
  InsertMentionCommand({
    required super.id,
    required this.typedPayload,
    this.version = kRichTextProtocolVersion,
  });

  @override
  final int version;
  final InsertMentionPayload typedPayload;

  @override
  String get type => 'insert_mention';

  @override
  ProtocolJsonMap get payload => typedPayload.toJson();
}

final class InsertChannelCommand extends ProtocolCommand {
  InsertChannelCommand({
    required super.id,
    required this.typedPayload,
    this.version = kRichTextProtocolVersion,
  });

  @override
  final int version;
  final InsertChannelPayload typedPayload;

  @override
  String get type => 'insert_channel';

  @override
  ProtocolJsonMap get payload => typedPayload.toJson();
}

final class InsertImageCommand extends ProtocolCommand {
  InsertImageCommand({
    required super.id,
    required this.typedPayload,
    this.version = kRichTextProtocolVersion,
  });

  @override
  final int version;
  final InsertImagePayload typedPayload;

  @override
  String get type => 'insert_image';

  @override
  ProtocolJsonMap get payload => typedPayload.toJson();
}

final class InsertVideoCommand extends ProtocolCommand {
  InsertVideoCommand({
    required super.id,
    required this.typedPayload,
    this.version = kRichTextProtocolVersion,
  });

  @override
  final int version;
  final InsertVideoPayload typedPayload;

  @override
  String get type => 'insert_video';

  @override
  ProtocolJsonMap get payload => typedPayload.toJson();
}

final class InsertLinkCommand extends ProtocolCommand {
  InsertLinkCommand({
    required super.id,
    required this.typedPayload,
    this.version = kRichTextProtocolVersion,
  });

  @override
  final int version;
  final InsertLinkPayload typedPayload;

  @override
  String get type => 'insert_link';

  @override
  ProtocolJsonMap get payload => typedPayload.toJson();
}

final class InsertDividerCommand extends ProtocolCommand {
  InsertDividerCommand({
    required super.id,
    required this.typedPayload,
    this.version = kRichTextProtocolVersion,
  });

  @override
  final int version;
  final InsertDividerPayload typedPayload;

  @override
  String get type => 'insert_divider';

  @override
  ProtocolJsonMap get payload => typedPayload.toJson();
}

final class IndentCommand extends ProtocolCommand {
  IndentCommand({required super.id, this.version = kRichTextProtocolVersion});

  @override
  final int version;

  @override
  String get type => 'indent';

  @override
  ProtocolJsonMap get payload => const <String, Object?>{};
}

final class OutdentCommand extends ProtocolCommand {
  OutdentCommand({required super.id, this.version = kRichTextProtocolVersion});

  @override
  final int version;

  @override
  String get type => 'outdent';

  @override
  ProtocolJsonMap get payload => const <String, Object?>{};
}

final class GetCaretRectCommand extends ProtocolCommand {
  GetCaretRectCommand({
    required super.id,
    this.version = kRichTextProtocolVersion,
  });

  @override
  final int version;

  @override
  String get type => 'get_caret_rect';

  @override
  ProtocolJsonMap get payload => const <String, Object?>{};
}

final class UndoCommand extends ProtocolCommand {
  UndoCommand({required super.id, this.version = kRichTextProtocolVersion});

  @override
  final int version;

  @override
  String get type => 'undo';

  @override
  ProtocolJsonMap get payload => const <String, Object?>{};
}

final class RedoCommand extends ProtocolCommand {
  RedoCommand({required super.id, this.version = kRichTextProtocolVersion});

  @override
  final int version;

  @override
  String get type => 'redo';

  @override
  ProtocolJsonMap get payload => const <String, Object?>{};
}

final class FocusCommand extends ProtocolCommand {
  FocusCommand({required super.id, this.version = kRichTextProtocolVersion});

  @override
  final int version;

  @override
  String get type => 'focus';

  @override
  ProtocolJsonMap get payload => const <String, Object?>{};
}

final class BlurCommand extends ProtocolCommand {
  BlurCommand({required super.id, this.version = kRichTextProtocolVersion});

  @override
  final int version;

  @override
  String get type => 'blur';

  @override
  ProtocolJsonMap get payload => const <String, Object?>{};
}

// ---------------------------------------------------------------------------
// Responses
// ---------------------------------------------------------------------------

sealed class ProtocolResponse extends ProtocolMessage {
  const ProtocolResponse({required this.id});

  final String id;
  bool get ok;

  @override
  String get kind => 'response';
}

final class ProtocolSuccessResponse extends ProtocolResponse {
  const ProtocolSuccessResponse({
    required super.id,
    required this.type,
    required this.value,
    this.version = kRichTextProtocolVersion,
  });

  @override
  final int version;
  final String type;
  final ProtocolJsonMap value;

  @override
  bool get ok => true;

  @override
  ProtocolJsonMap toJson() => <String, Object?>{
    'version': version,
    'kind': kind,
    'id': id,
    'type': type,
    'ok': true,
    'value': value,
  };

  RichTextSnapshot? get snapshotOrNull {
    if (type != 'get_snapshot') return null;
    final raw = value['snapshot'];
    if (raw == null) return null;
    return RichTextSnapshot.fromJson(raw);
  }

  ProtocolSelection? get selectionOrNull {
    if (type != 'get_selection') return null;
    final raw = value['selection'];
    if (raw == null) return null;
    return ProtocolSelection.fromJson(
      (raw as Map).map((key, v) => MapEntry(key.toString(), v as Object?)),
    );
  }

  ProtocolCaretRect? get caretRectOrNull {
    if (type != 'get_caret_rect') return null;
    final raw = value['rect'];
    if (raw == null) return null;
    return ProtocolCaretRect.fromJson(
      (raw as Map).map((key, v) => MapEntry(key.toString(), v as Object?)),
    );
  }
}

final class ProtocolFailureResponse extends ProtocolResponse {
  const ProtocolFailureResponse({
    required super.id,
    required this.error,
    this.version = kRichTextProtocolVersion,
  });

  @override
  final int version;
  final ProtocolFailureError error;

  @override
  bool get ok => false;

  @override
  ProtocolJsonMap toJson() => <String, Object?>{
    'version': version,
    'kind': kind,
    'id': id,
    'ok': false,
    'error': error.toJson(),
  };
}

class ProtocolFailureError {
  const ProtocolFailureError({
    required this.code,
    required this.message,
    this.details,
  });

  factory ProtocolFailureError.fromJson(ProtocolJsonMap json) {
    final code = ProtocolErrorCode.tryParse(json['code']! as String);
    if (code == null) {
      throw FormatException('Unknown protocol error code: ${json['code']}');
    }
    return ProtocolFailureError(
      code: code,
      message: json['message']! as String,
      details: json['details'],
    );
  }

  final ProtocolErrorCode code;
  final String message;
  final Object? details;

  ProtocolJsonMap toJson() {
    final map = <String, Object?>{
      'code': code.wire,
      'message': message,
    };
    if (details != null) {
      map['details'] = details;
    }
    return map;
  }
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

sealed class ProtocolEvent extends ProtocolMessage {
  const ProtocolEvent();

  @override
  String get kind => 'event';

  String get type;
  ProtocolJsonMap get payload;

  @override
  ProtocolJsonMap toJson() => <String, Object?>{
    'version': version,
    'kind': kind,
    'type': type,
    'payload': payload,
  };
}

final class ReadyEvent extends ProtocolEvent {
  ReadyEvent({
    required this.protocolVersion,
    this.version = kRichTextProtocolVersion,
  });

  @override
  final int version;
  final int protocolVersion;

  @override
  String get type => 'ready';

  @override
  ProtocolJsonMap get payload => <String, Object?>{
    'protocol_version': protocolVersion,
  };
}

final class ChangeEvent extends ProtocolEvent {
  ChangeEvent({
    required this.snapshot,
    this.version = kRichTextProtocolVersion,
  });

  @override
  final int version;
  final RichTextSnapshot snapshot;

  @override
  String get type => 'change';

  @override
  ProtocolJsonMap get payload => <String, Object?>{'snapshot': snapshot.toJson()};
}

final class SelectionChangeEvent extends ProtocolEvent {
  SelectionChangeEvent({
    required this.selection,
    this.version = kRichTextProtocolVersion,
  });

  @override
  final int version;
  final ProtocolSelection? selection;

  @override
  String get type => 'selection_change';

  @override
  ProtocolJsonMap get payload => <String, Object?>{
    'selection': selection?.toJson(),
  };
}

final class FocusEvent extends ProtocolEvent {
  FocusEvent({this.version = kRichTextProtocolVersion});

  @override
  final int version;

  @override
  String get type => 'focus';

  @override
  ProtocolJsonMap get payload => const <String, Object?>{};
}

final class BlurEvent extends ProtocolEvent {
  BlurEvent({this.version = kRichTextProtocolVersion});

  @override
  final int version;

  @override
  String get type => 'blur';

  @override
  ProtocolJsonMap get payload => const <String, Object?>{};
}

final class TitleFocusEvent extends ProtocolEvent {
  TitleFocusEvent({this.version = kRichTextProtocolVersion});

  @override
  final int version;

  @override
  String get type => 'title_focus';

  @override
  ProtocolJsonMap get payload => const <String, Object?>{};
}

final class TitleBlurEvent extends ProtocolEvent {
  TitleBlurEvent({this.version = kRichTextProtocolVersion});

  @override
  final int version;

  @override
  String get type => 'title_blur';

  @override
  ProtocolJsonMap get payload => const <String, Object?>{};
}

final class StateChangeEvent extends ProtocolEvent {
  StateChangeEvent({
    required this.state,
    this.version = kRichTextProtocolVersion,
  });

  @override
  final int version;
  final ProtocolEditorState state;

  @override
  String get type => 'state_change';

  @override
  ProtocolJsonMap get payload => <String, Object?>{'state': state.toJson()};
}

/// Web→Flutter UI intent: open host link dialog (e.g. desktop Solid toolbar).
final class RequestLinkEvent extends ProtocolEvent {
  RequestLinkEvent({
    this.selection,
    this.version = kRichTextProtocolVersion,
  });

  @override
  final int version;
  final ProtocolSelection? selection;

  @override
  String get type => 'request_link';

  @override
  ProtocolJsonMap get payload => <String, Object?>{
    if (selection != null) 'selection': selection!.toJson(),
  };
}

/// Web→Flutter UI intent: dismiss the host composition panel (In-Web close).
final class RequestCloseEvent extends ProtocolEvent {
  RequestCloseEvent({this.version = kRichTextProtocolVersion});

  @override
  final int version;

  @override
  String get type => 'request_close';

  @override
  ProtocolJsonMap get payload => const <String, Object?>{};
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

bool _deepEquals(Object? a, Object? b) {
  if (identical(a, b)) return true;
  if (a is Map && b is Map) {
    if (a.length != b.length) return false;
    for (final key in a.keys) {
      if (!b.containsKey(key) || !_deepEquals(a[key], b[key])) return false;
    }
    return true;
  }
  if (a is List && b is List) {
    if (a.length != b.length) return false;
    for (var i = 0; i < a.length; i++) {
      if (!_deepEquals(a[i], b[i])) return false;
    }
    return true;
  }
  return a == b;
}
