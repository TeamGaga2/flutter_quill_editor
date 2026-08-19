import 'dart:convert';

import 'package:flutter_quill_editor/protocol/messages.dart';
import 'package:flutter_quill_editor/protocol/protocol_version.dart';

/// Result of decoding / parsing a protocol message.
sealed class ProtocolParseResult<T> {
  const ProtocolParseResult();
}

final class ProtocolParseSuccess<T> extends ProtocolParseResult<T> {
  const ProtocolParseSuccess(this.value);
  final T value;
}

final class ProtocolParseFailure<T> extends ProtocolParseResult<T> {
  const ProtocolParseFailure(this.error);
  final ProtocolParseError error;
}

class ProtocolParseError {
  const ProtocolParseError({
    required this.code,
    required this.message,
    this.issues = const <ProtocolValidationIssue>[],
  });

  final ProtocolErrorCode code;
  final String message;
  final List<ProtocolValidationIssue> issues;

  @override
  String toString() => 'ProtocolParseError($code, $message, issues: $issues)';
}

class ProtocolValidationIssue {
  const ProtocolValidationIssue({
    required this.code,
    required this.path,
    required this.message,
  });

  final ProtocolErrorCode code;
  final String path;
  final String message;

  @override
  String toString() => '[$code] $path: $message';
}

/// Thrown when [encodeProtocolMessage] is given an invalid message.
class ProtocolEncodeException implements Exception {
  ProtocolEncodeException(this.message);
  final String message;

  @override
  String toString() => 'ProtocolEncodeException: $message';
}

const _commandTypes = <String>{
  'set_snapshot',
  'get_snapshot',
  'set_selection',
  'get_selection',
  'toggle_inline_format',
  'toggle_block_format',
  'insert_emoji',
  'insert_mention',
  'insert_channel',
  'insert_image',
  'insert_video',
  'insert_link',
  'insert_divider',
  'indent',
  'outdent',
  'get_caret_rect',
  'undo',
  'redo',
  'focus',
  'blur',
  'open_link_form',
};

const _emptyCommandTypes = <String>{
  'get_snapshot',
  'get_selection',
  'get_caret_rect',
  'indent',
  'outdent',
  'undo',
  'redo',
  'focus',
  'blur',
  'open_link_form',
};

const _emptySuccessTypes = <String>{
  'set_snapshot',
  'set_selection',
  'toggle_inline_format',
  'toggle_block_format',
  'insert_emoji',
  'insert_mention',
  'insert_channel',
  'insert_image',
  'insert_video',
  'insert_link',
  'insert_divider',
  'indent',
  'outdent',
  'undo',
  'redo',
  'focus',
  'blur',
  'open_link_form',
};

const _eventTypes = <String>{
  'ready',
  'change',
  'selection_change',
  'focus',
  'blur',
  'title_focus',
  'title_blur',
  'state_change',
  'request_close',
};

/// Encode a protocol message to a JSON string.
///
/// Validates structure for required fields before serializing.
String encodeProtocolMessage(ProtocolMessage message) {
  final json = message.toJson();
  final parsed = parseProtocolMessage(json);
  if (parsed is ProtocolParseFailure<ProtocolMessage>) {
    final first = parsed.error.issues.isNotEmpty ? parsed.error.issues.first : null;
    throw ProtocolEncodeException(
      first != null
          ? 'Cannot encode invalid protocol message at ${first.path}: ${first.message}'
          : 'Cannot encode invalid protocol message.',
    );
  }
  return jsonEncode(json);
}

/// Decode a JSON string into a [ProtocolMessage].
ProtocolParseResult<ProtocolMessage> decodeProtocolMessage(String raw) {
  Object? input;
  try {
    input = jsonDecode(raw);
  } on Object {
    return const ProtocolParseFailure<ProtocolMessage>(
      ProtocolParseError(
        code: ProtocolErrorCode.invalidJson,
        message: 'Protocol message must be valid JSON.',
        issues: [
          ProtocolValidationIssue(
            code: ProtocolErrorCode.invalidJson,
            path: r'$',
            message: 'Protocol message must be valid JSON.',
          ),
        ],
      ),
    );
  }
  return parseProtocolMessage(input);
}

/// Parse an already-decoded JSON value into a [ProtocolMessage].
ProtocolParseResult<ProtocolMessage> parseProtocolMessage(Object? input) {
  try {
    final normalizedInput = _normalizeIntegralDoubles(input);
    if (normalizedInput is! Map) {
      return _fail(
        ProtocolErrorCode.invalidMessage,
        r'$',
        'Protocol message must be an object.',
      );
    }
    final map = _asJsonMap(normalizedInput);
    switch (map['kind']) {
      case 'command':
        return _parseCommand(map);
      case 'event':
        return _parseEvent(map);
      case 'response':
        return _parseResponse(map);
      default:
        return _fail(
          ProtocolErrorCode.invalidMessage,
          r'$.kind',
          'Unknown protocol message kind.',
        );
    }
  } on FormatException catch (e) {
    return _fail(
      ProtocolErrorCode.invalidMessage,
      r'$',
      e.message,
    );
  } on Object catch (e) {
    return _fail(
      ProtocolErrorCode.invalidMessage,
      r'$',
      'Protocol message validation failed: $e',
    );
  }
}

ProtocolParseResult<ProtocolMessage> _parseCommand(ProtocolJsonMap map) {
  final envelopeIssues = _validateEnvelope(
    map,
    kind: 'command',
    keys: const ['version', 'kind', 'id', 'type', 'payload'],
  );
  if (envelopeIssues.isNotEmpty) {
    return _fromIssues(
      ProtocolErrorCode.invalidMessage,
      'Invalid command envelope.',
      envelopeIssues,
    );
  }

  final id = map['id'];
  if (id is! String || id.trim().isEmpty) {
    return _fail(
      ProtocolErrorCode.invalidMessage,
      r'$.id',
      'Request id must be a non-empty string.',
    );
  }

  final type = map['type'];
  if (type is! String || !_commandTypes.contains(type)) {
    return _fail(
      ProtocolErrorCode.unsupportedCommand,
      r'$.type',
      'Unsupported editor command.',
    );
  }

  final payload = map['payload'];
  final payloadIssues = _validateCommandPayload(type, payload);
  if (payloadIssues.isNotEmpty) {
    return _fromIssues(
      ProtocolErrorCode.invalidPayload,
      'Invalid command payload.',
      payloadIssues,
    );
  }

  final version = map['version']! as int;
  final payloadMap = _asJsonMap(payload! as Map);

  final ProtocolCommand command;
  switch (type) {
    case 'set_snapshot':
      command = SetSnapshotCommand(
        id: id,
        version: version,
        snapshot: RichTextSnapshot.fromJson(payloadMap['snapshot']),
      );
    case 'get_snapshot':
      command = GetSnapshotCommand(id: id, version: version);
    case 'set_selection':
      command = SetSelectionCommand(
        id: id,
        version: version,
        selection: ProtocolSelection.fromJson(
          _asJsonMap(payloadMap['selection']! as Map),
        ),
      );
    case 'get_selection':
      command = GetSelectionCommand(id: id, version: version);
    case 'toggle_inline_format':
      final format = ProtocolInlineFormat.tryParse(payloadMap['format']! as String);
      if (format == null) {
        return _fail(
          ProtocolErrorCode.invalidPayload,
          r'$.payload.format',
          'Unknown inline format.',
        );
      }
      command = ToggleInlineFormatCommand(
        id: id,
        version: version,
        format: format,
      );
    case 'toggle_block_format':
      final format = payloadMap['format']! as String;
      if (format == 'header') {
        final level = ProtocolHeaderLevel.tryParse(payloadMap['value']);
        if (level == null) {
          return _fail(
            ProtocolErrorCode.invalidPayload,
            r'$.payload.value',
            'Header value must be 1, 2, or 3.',
          );
        }
        command = ToggleBlockFormatCommand.header(
          id: id,
          level: level,
          version: version,
        );
      } else if (format == 'list') {
        final listType = ProtocolListType.tryParse(payloadMap['value']! as String);
        if (listType == null) {
          return _fail(
            ProtocolErrorCode.invalidPayload,
            r'$.payload.value',
            'Unknown list value.',
          );
        }
        command = ToggleBlockFormatCommand.list(
          id: id,
          listType: listType,
          version: version,
        );
      } else if (format == 'blockquote') {
        command = ToggleBlockFormatCommand.blockquote(id: id, version: version);
      } else {
        return _fail(
          ProtocolErrorCode.invalidPayload,
          r'$.payload.format',
          'Unknown block format.',
        );
      }
    case 'insert_emoji':
      command = InsertEmojiCommand(
        id: id,
        version: version,
        emojiId: payloadMap['id']! as String,
      );
    case 'insert_mention':
      command = InsertMentionCommand(
        id: id,
        version: version,
        typedPayload: InsertMentionPayload.fromJson(payloadMap),
      );
    case 'insert_channel':
      command = InsertChannelCommand(
        id: id,
        version: version,
        typedPayload: InsertChannelPayload.fromJson(payloadMap),
      );
    case 'insert_image':
      command = InsertImageCommand(
        id: id,
        version: version,
        typedPayload: InsertImagePayload.fromJson(payloadMap),
      );
    case 'insert_video':
      command = InsertVideoCommand(
        id: id,
        version: version,
        typedPayload: InsertVideoPayload.fromJson(payloadMap),
      );
    case 'insert_link':
      command = InsertLinkCommand(
        id: id,
        version: version,
        typedPayload: InsertLinkPayload.fromJson(payloadMap),
      );
    case 'insert_divider':
      command = InsertDividerCommand(
        id: id,
        version: version,
        typedPayload: InsertDividerPayload.fromJson(payloadMap),
      );
    case 'indent':
      command = IndentCommand(id: id, version: version);
    case 'outdent':
      command = OutdentCommand(id: id, version: version);
    case 'get_caret_rect':
      command = GetCaretRectCommand(id: id, version: version);
    case 'undo':
      command = UndoCommand(id: id, version: version);
    case 'redo':
      command = RedoCommand(id: id, version: version);
    case 'focus':
      command = FocusCommand(id: id, version: version);
    case 'blur':
      command = BlurCommand(id: id, version: version);
    case 'open_link_form':
      command = OpenLinkFormCommand(id: id, version: version);
    default:
      return _fail(
        ProtocolErrorCode.unsupportedCommand,
        r'$.type',
        'Unsupported editor command.',
      );
  }

  return ProtocolParseSuccess(command);
}

ProtocolParseResult<ProtocolMessage> _parseEvent(ProtocolJsonMap map) {
  final envelopeIssues = _validateEnvelope(
    map,
    kind: 'event',
    keys: const ['version', 'kind', 'type', 'payload'],
  );
  if (envelopeIssues.isNotEmpty) {
    return _fromIssues(
      ProtocolErrorCode.invalidMessage,
      'Invalid event envelope.',
      envelopeIssues,
    );
  }

  final type = map['type'];
  if (type is! String || !_eventTypes.contains(type)) {
    return _fail(
      ProtocolErrorCode.invalidMessage,
      r'$.type',
      'Unknown editor event type.',
    );
  }

  final payload = map['payload'];
  final payloadIssues = _validateEventPayload(type, payload);
  if (payloadIssues.isNotEmpty) {
    return _fromIssues(
      ProtocolErrorCode.invalidPayload,
      'Invalid event payload.',
      payloadIssues,
    );
  }

  final version = map['version']! as int;
  final payloadMap = payload is Map ? _asJsonMap(payload) : const <String, Object?>{};

  final ProtocolEvent event;
  switch (type) {
    case 'ready':
      event = ReadyEvent(
        version: version,
        protocolVersion: payloadMap['protocol_version']! as int,
      );
    case 'change':
      event = ChangeEvent(
        version: version,
        snapshot: RichTextSnapshot.fromJson(payloadMap['snapshot']),
      );
    case 'selection_change':
      final selectionRaw = payloadMap['selection'];
      event = SelectionChangeEvent(
        version: version,
        selection: selectionRaw == null
            ? null
            : ProtocolSelection.fromJson(_asJsonMap(selectionRaw as Map)),
      );
    case 'focus':
      event = FocusEvent(version: version);
    case 'blur':
      event = BlurEvent(version: version);
    case 'title_focus':
      event = TitleFocusEvent(version: version);
    case 'title_blur':
      event = TitleBlurEvent(version: version);
    case 'state_change':
      event = StateChangeEvent(
        version: version,
        state: ProtocolEditorState.fromJson(
          _asJsonMap(payloadMap['state']! as Map),
        ),
      );
    case 'request_close':
      event = RequestCloseEvent(version: version);
    default:
      return _fail(
        ProtocolErrorCode.invalidMessage,
        r'$.type',
        'Unknown editor event type.',
      );
  }

  return ProtocolParseSuccess(event);
}

ProtocolParseResult<ProtocolMessage> _parseResponse(ProtocolJsonMap map) {
  final ok = map['ok'];
  if (ok is! bool) {
    return _fail(
      ProtocolErrorCode.invalidMessage,
      r'$.ok',
      'Response ok must be a boolean.',
    );
  }

  final expectedKeys = ok
      ? const ['version', 'kind', 'id', 'type', 'ok', 'value']
      : const ['version', 'kind', 'id', 'ok', 'error'];

  final envelopeIssues = _validateEnvelope(
    map,
    kind: 'response',
    keys: expectedKeys,
  );
  if (envelopeIssues.isNotEmpty) {
    return _fromIssues(
      ProtocolErrorCode.invalidMessage,
      'Invalid response envelope.',
      envelopeIssues,
    );
  }

  final id = map['id'];
  if (id is! String || id.trim().isEmpty) {
    return _fail(
      ProtocolErrorCode.invalidMessage,
      r'$.id',
      'Request id must be a non-empty string.',
    );
  }

  final version = map['version']! as int;

  if (ok) {
    final type = map['type'];
    if (type is! String || !_commandTypes.contains(type)) {
      return _fail(
        ProtocolErrorCode.invalidMessage,
        r'$.type',
        'Unknown response type.',
      );
    }
    final value = map['value'];
    final valueIssues = _validateSuccessValue(type, value);
    if (valueIssues.isNotEmpty) {
      return _fromIssues(
        ProtocolErrorCode.invalidPayload,
        'Invalid response value.',
        valueIssues,
      );
    }
    return ProtocolParseSuccess(
      ProtocolSuccessResponse(
        id: id,
        version: version,
        type: type,
        value: value is Map ? _asJsonMap(value) : const <String, Object?>{},
      ),
    );
  }

  final errorRaw = map['error'];
  final errorIssues = _validateFailureError(errorRaw);
  if (errorIssues.isNotEmpty) {
    return _fromIssues(
      ProtocolErrorCode.invalidPayload,
      'Invalid failure response.',
      errorIssues,
    );
  }
  return ProtocolParseSuccess(
    ProtocolFailureResponse(
      id: id,
      version: version,
      error: ProtocolFailureError.fromJson(_asJsonMap(errorRaw! as Map)),
    ),
  );
}

// ---------------------------------------------------------------------------
// Validation helpers (required fields strict; unknown keys flagged)
// ---------------------------------------------------------------------------

List<ProtocolValidationIssue> _validateEnvelope(
  ProtocolJsonMap map, {
  required String kind,
  required List<String> keys,
}) {
  final issues = _validateExactKeys(
    map,
    keys,
    path: r'$',
    label: 'message',
    code: ProtocolErrorCode.invalidMessage,
  );

  final version = map['version'];
  if (version != kRichTextProtocolVersion) {
    issues.add(
      const ProtocolValidationIssue(
        code: ProtocolErrorCode.unsupportedVersion,
        path: r'$.version',
        message: 'Protocol version must be $kRichTextProtocolVersion.',
      ),
    );
  }

  if (map['kind'] != kind) {
    issues.add(
      ProtocolValidationIssue(
        code: ProtocolErrorCode.invalidMessage,
        path: r'$.kind',
        message: 'Message kind must be $kind.',
      ),
    );
  }

  return issues;
}

List<ProtocolValidationIssue> _validateCommandPayload(
  String type,
  Object? payload,
) {
  if (_emptyCommandTypes.contains(type)) {
    return _validateEmptyObject(payload, r'$.payload');
  }
  if (payload is! Map) {
    return [
      const ProtocolValidationIssue(
        code: ProtocolErrorCode.invalidPayload,
        path: r'$.payload',
        message: 'Command payload must be an object.',
      ),
    ];
  }
  final map = _asJsonMap(payload);

  switch (type) {
    case 'set_snapshot':
      return _validateSnapshotContainer(map, r'$.payload');
    case 'set_selection':
      return _validateSelectionContainer(map, r'$.payload', nullable: false);
    case 'toggle_inline_format':
      final issues = _validateExactKeys(
        map,
        const ['format'],
        path: r'$.payload',
        label: 'inline format payload',
      );
      if (ProtocolInlineFormat.tryParse('${map['format']}') == null) {
        issues.add(
          const ProtocolValidationIssue(
            code: ProtocolErrorCode.invalidPayload,
            path: r'$.payload.format',
            message: 'Unknown inline format.',
          ),
        );
      }
      return issues;
    case 'toggle_block_format':
      return _validateBlockFormatPayload(map);
    case 'insert_emoji':
      final issues = _validateExactKeys(
        map,
        const ['id'],
        path: r'$.payload',
        label: 'emoji payload',
      );
      final emojiId = map['id'];
      if (emojiId is! String || emojiId.trim().isEmpty) {
        issues.add(
          const ProtocolValidationIssue(
            code: ProtocolErrorCode.invalidPayload,
            path: r'$.payload.id',
            message: 'Emoji id must be a non-empty string.',
          ),
        );
      }
      return issues;
    case 'insert_mention':
      return _validateMentionInsertPayload(map);
    case 'insert_channel':
      return _validateChannelInsertPayload(map);
    case 'insert_image':
      return _validateImageInsertPayload(map);
    case 'insert_video':
      return _validateVideoInsertPayload(map);
    case 'insert_link':
      return _validateLinkInsertPayload(map);
    case 'insert_divider':
      return _validateDividerInsertPayload(map);
    default:
      return _validateEmptyObject(payload, r'$.payload');
  }
}

List<ProtocolValidationIssue> _validateMentionInsertPayload(
  ProtocolJsonMap map,
) {
  final issues = _validateRequiredAndOptionalKeys(
    map,
    requiredKeys: const ['id', 'sign', 'displayText'],
    optionalKeys: const ['selection'],
    path: r'$.payload',
    label: 'mention payload',
  );

  _addNonEmptyStringIssue(issues, map['id'], r'$.payload.id', 'Mention id');
  final sign = map['sign'];
  if (sign != '!' && sign != '&') {
    issues.add(
      const ProtocolValidationIssue(
        code: ProtocolErrorCode.invalidPayload,
        path: r'$.payload.sign',
        message: 'Mention sign must be "!" or "&".',
      ),
    );
  }
  _addNonEmptyStringIssue(
    issues,
    map['displayText'],
    r'$.payload.displayText',
    'Mention displayText',
  );
  _addOptionalSelectionIssues(issues, map, r'$.payload');
  return issues;
}

List<ProtocolValidationIssue> _validateChannelInsertPayload(
  ProtocolJsonMap map,
) {
  final issues = _validateRequiredAndOptionalKeys(
    map,
    requiredKeys: const ['id', 'displayText'],
    optionalKeys: const ['selection'],
    path: r'$.payload',
    label: 'channel payload',
  );

  _addNonEmptyStringIssue(issues, map['id'], r'$.payload.id', 'Channel id');
  _addNonEmptyStringIssue(
    issues,
    map['displayText'],
    r'$.payload.displayText',
    'Channel displayText',
  );
  _addOptionalSelectionIssues(issues, map, r'$.payload');
  return issues;
}

List<ProtocolValidationIssue> _validateImageInsertPayload(
  ProtocolJsonMap map,
) {
  final issues = _validateRequiredAndOptionalKeys(
    map,
    requiredKeys: const ['src', 'width', 'height', 'mimeType', 'fileSize'],
    optionalKeys: const ['selection'],
    path: r'$.payload',
    label: 'image payload',
  );
  _validateMediaFields(issues, map, r'$.payload');
  _addOptionalSelectionIssues(issues, map, r'$.payload');
  return issues;
}

List<ProtocolValidationIssue> _validateVideoInsertPayload(
  ProtocolJsonMap map,
) {
  final issues = _validateRequiredAndOptionalKeys(
    map,
    requiredKeys: const ['src', 'width', 'height', 'mimeType', 'fileSize'],
    optionalKeys: const ['poster', 'duration', 'selection'],
    path: r'$.payload',
    label: 'video payload',
  );
  _validateMediaFields(issues, map, r'$.payload');

  if (map.containsKey('poster') && !_isAllowedMediaUri(map['poster'])) {
    issues.add(
      const ProtocolValidationIssue(
        code: ProtocolErrorCode.invalidPayload,
        path: r'$.payload.poster',
        message: 'Video poster must be an HTTPS or tgg-local-media URI.',
      ),
    );
  }
  if (map.containsKey('duration') && !_isSafeNonNegativeInteger(map['duration'])) {
    issues.add(
      const ProtocolValidationIssue(
        code: ProtocolErrorCode.invalidPayload,
        path: r'$.payload.duration',
        message: 'Video duration must be a non-negative integer.',
      ),
    );
  }
  _addOptionalSelectionIssues(issues, map, r'$.payload');
  return issues;
}

List<ProtocolValidationIssue> _validateLinkInsertPayload(
  ProtocolJsonMap map,
) {
  final issues = _validateRequiredAndOptionalKeys(
    map,
    requiredKeys: const ['url', 'text'],
    optionalKeys: const ['selection'],
    path: r'$.payload',
    label: 'link payload',
  );
  if (!_isAllowedLink(map['url'])) {
    issues.add(
      const ProtocolValidationIssue(
        code: ProtocolErrorCode.invalidPayload,
        path: r'$.payload.url',
        message: 'Link scheme is not allowed.',
      ),
    );
  }
  _addNonEmptyStringIssue(
    issues,
    map['text'],
    r'$.payload.text',
    'Link text',
  );
  _addOptionalSelectionIssues(issues, map, r'$.payload');
  return issues;
}

List<ProtocolValidationIssue> _validateDividerInsertPayload(
  ProtocolJsonMap map,
) {
  final issues = _validateRequiredAndOptionalKeys(
    map,
    requiredKeys: const [],
    optionalKeys: const ['selection'],
    path: r'$.payload',
    label: 'divider payload',
  );
  _addOptionalSelectionIssues(issues, map, r'$.payload');
  return issues;
}

List<ProtocolValidationIssue> _validateNullableCaretRectContainer(
  ProtocolJsonMap container,
  String path,
) {
  final issues = _validateExactKeys(
    container,
    const ['rect'],
    path: path,
    label: 'caret rect container',
  );

  final rect = container['rect'];
  if (rect != null) {
    issues.addAll(_validateCaretRect(rect, '$path.rect'));
  }
  return issues;
}

List<ProtocolValidationIssue> _validateCaretRect(Object? input, String path) {
  if (input is! Map) {
    return [
      ProtocolValidationIssue(
        code: ProtocolErrorCode.invalidPayload,
        path: path,
        message: 'Caret rect must be an object.',
      ),
    ];
  }
  final map = _asJsonMap(input);
  final issues = _validateExactKeys(
    map,
    const ['x', 'y', 'width', 'height'],
    path: path,
    label: 'caret rect',
  );

  for (final key in const ['x', 'y', 'width', 'height']) {
    final value = map[key];
    if (value is! num || !value.isFinite) {
      issues.add(
        ProtocolValidationIssue(
          code: ProtocolErrorCode.invalidPayload,
          path: '$path.$key',
          message: 'Caret rect $key must be a finite number.',
        ),
      );
    }
  }

  final width = map['width'];
  if (width is num && width.isFinite && width < 0) {
    issues.add(
      ProtocolValidationIssue(
        code: ProtocolErrorCode.invalidPayload,
        path: '$path.width',
        message: 'Caret rect width must be >= 0.',
      ),
    );
  }

  final height = map['height'];
  if (height is num && height.isFinite && height < 0) {
    issues.add(
      ProtocolValidationIssue(
        code: ProtocolErrorCode.invalidPayload,
        path: '$path.height',
        message: 'Caret rect height must be >= 0.',
      ),
    );
  }

  return issues;
}

List<ProtocolValidationIssue> _validateRequiredAndOptionalKeys(
  ProtocolJsonMap map, {
  required List<String> requiredKeys,
  required List<String> optionalKeys,
  required String path,
  required String label,
}) {
  final issues = <ProtocolValidationIssue>[];
  final allowedKeys = {...requiredKeys, ...optionalKeys};

  for (final key in map.keys) {
    if (!allowedKeys.contains(key)) {
      issues.add(
        ProtocolValidationIssue(
          code: ProtocolErrorCode.invalidPayload,
          path: '$path.$key',
          message: 'Unknown $label property: $key.',
        ),
      );
    }
  }
  for (final key in requiredKeys) {
    if (!map.containsKey(key)) {
      issues.add(
        ProtocolValidationIssue(
          code: ProtocolErrorCode.invalidPayload,
          path: '$path.$key',
          message: 'Missing $label property: $key.',
        ),
      );
    }
  }
  return issues;
}

void _validateMediaFields(
  List<ProtocolValidationIssue> issues,
  ProtocolJsonMap map,
  String path,
) {
  final src = map['src'];
  if (!_isAllowedMediaUri(src)) {
    issues.add(
      ProtocolValidationIssue(
        code: ProtocolErrorCode.invalidPayload,
        path: '$path.src',
        message: 'Media src must be an HTTPS or tgg-local-media URI.',
      ),
    );
  }
  for (final key in const ['width', 'height']) {
    final value = map[key];
    if (value is! String || !_decimalDimensionPattern.hasMatch(value)) {
      issues.add(
        ProtocolValidationIssue(
          code: ProtocolErrorCode.invalidPayload,
          path: '$path.$key',
          message: 'Media $key must be a decimal integer string.',
        ),
      );
    }
  }
  _addNonEmptyStringIssue(issues, map['mimeType'], '$path.mimeType', 'Media mimeType');
  final fileSize = map['fileSize'];
  if (!_isSafeNonNegativeInteger(fileSize)) {
    issues.add(
      ProtocolValidationIssue(
        code: ProtocolErrorCode.invalidPayload,
        path: '$path.fileSize',
        message: 'Media fileSize must be a non-negative integer.',
      ),
    );
  }
}

void _addOptionalSelectionIssues(
  List<ProtocolValidationIssue> issues,
  ProtocolJsonMap map,
  String path,
) {
  if (map.containsKey('selection')) {
    issues.addAll(_validateSelection(map['selection'], '$path.selection'));
  }
}

void _addNonEmptyStringIssue(
  List<ProtocolValidationIssue> issues,
  Object? value,
  String path,
  String label,
) {
  if (value is! String || value.trim().isEmpty) {
    issues.add(
      ProtocolValidationIssue(
        code: ProtocolErrorCode.invalidPayload,
        path: path,
        message: '$label must be a non-empty string.',
      ),
    );
  }
}

final _decimalDimensionPattern = RegExp(r'^(0|[1-9]\d*)$');
final _localMediaUriPattern = RegExp(r'^tgg-local-media://[^/\s?#]+$');

bool _isAllowedMediaUri(Object? value) {
  if (value is! String) return false;
  if (_localMediaUriPattern.hasMatch(value)) return true;
  final uri = Uri.tryParse(value);
  return uri != null && uri.scheme == 'https' && uri.host.isNotEmpty;
}

List<ProtocolValidationIssue> _validateEventPayload(
  String type,
  Object? payload,
) {
  switch (type) {
    case 'ready':
      if (payload is! Map) {
        return [
          const ProtocolValidationIssue(
            code: ProtocolErrorCode.invalidPayload,
            path: r'$.payload',
            message: 'Event payload must be an object.',
          ),
        ];
      }
      final map = _asJsonMap(payload);
      final issues = _validateExactKeys(
        map,
        const ['protocol_version'],
        path: r'$.payload',
        label: 'ready payload',
      );
      if (map['protocol_version'] != kRichTextProtocolVersion) {
        issues.add(
          const ProtocolValidationIssue(
            code: ProtocolErrorCode.unsupportedVersion,
            path: r'$.payload.protocol_version',
            message: 'Ready event protocol_version must be $kRichTextProtocolVersion.',
          ),
        );
      }
      return issues;
    case 'change':
      if (payload is! Map) {
        return [
          const ProtocolValidationIssue(
            code: ProtocolErrorCode.invalidPayload,
            path: r'$.payload',
            message: 'Event payload must be an object.',
          ),
        ];
      }
      return _validateSnapshotContainer(_asJsonMap(payload), r'$.payload');
    case 'selection_change':
      return _validateSelectionContainer(
        payload is Map ? _asJsonMap(payload) : null,
        r'$.payload',
        nullable: true,
        requireContainer: true,
      );
    case 'focus':
    case 'blur':
    case 'title_focus':
    case 'title_blur':
    case 'request_close':
      return _validateEmptyObject(payload, r'$.payload');
    case 'state_change':
      return _validateStateContainer(payload);
    default:
      return [
        const ProtocolValidationIssue(
          code: ProtocolErrorCode.invalidMessage,
          path: r'$.type',
          message: 'Unknown editor event type.',
        ),
      ];
  }
}

List<ProtocolValidationIssue> _validateSuccessValue(
  String type,
  Object? value,
) {
  if (_emptySuccessTypes.contains(type)) {
    return _validateEmptyObject(value, r'$.value');
  }
  if (value is! Map) {
    return [
      const ProtocolValidationIssue(
        code: ProtocolErrorCode.invalidPayload,
        path: r'$.value',
        message: 'Response value must be an object.',
      ),
    ];
  }
  final map = _asJsonMap(value);
  switch (type) {
    case 'get_snapshot':
      return _validateSnapshotContainer(map, r'$.value');
    case 'get_selection':
      return _validateSelectionContainer(
        map,
        r'$.value',
        nullable: true,
      );
    case 'get_caret_rect':
      return _validateNullableCaretRectContainer(map, r'$.value');
    default:
      return _validateEmptyObject(value, r'$.value');
  }
}

List<ProtocolValidationIssue> _validateSnapshotContainer(
  ProtocolJsonMap container,
  String path,
) {
  final issues = _validateExactKeys(
    container,
    const ['snapshot'],
    path: path,
    label: 'snapshot container',
  );
  final snapshot = container['snapshot'];
  if (snapshot is! Map) {
    issues.add(
      ProtocolValidationIssue(
        code: ProtocolErrorCode.invalidPayload,
        path: '$path.snapshot',
        message: 'Snapshot must be an object.',
      ),
    );
    return issues;
  }
  issues.addAll(_validateSnapshot(_asJsonMap(snapshot), '$path.snapshot'));
  return issues;
}

const _snapshotKeys = <String>{'title', 'content', 'size', 'theme'};
const _snapshotThemes = <String>{
  'yellow',
  'purple',
  'pink',
  'red',
  'blue',
  'green',
};
const _operationKeys = <String>{'insert', 'attributes'};
const _inlineAttributeKeys = <String>{
  'bold',
  'italic',
  'underline',
  'strike',
  'link',
};
const _blockAttributeKeys = <String>{'header', 'list', 'indent', 'blockquote'};
const _embedKeys = <String>{
  'mention',
  'channel',
  'emoji',
  'divider',
  'image',
  'video',
};
const _maxSafeInteger = 9007199254740991;

List<ProtocolValidationIssue> _validateSnapshot(
  ProtocolJsonMap snapshot,
  String path,
) {
  final issues = <ProtocolValidationIssue>[];

  for (final key in snapshot.keys) {
    if (!_snapshotKeys.contains(key)) {
      issues.add(
        ProtocolValidationIssue(
          code: ProtocolErrorCode.invalidPayload,
          path: '$path.$key',
          message: 'Unknown snapshot property: $key.',
        ),
      );
    }
  }

  if (snapshot.containsKey('title') && snapshot['title'] is! String) {
    issues.add(
      ProtocolValidationIssue(
        code: ProtocolErrorCode.invalidPayload,
        path: '$path.title',
        message: 'Title must be a string.',
      ),
    );
  }
  if (snapshot.containsKey('size') && snapshot['size'] != 'medium') {
    issues.add(
      ProtocolValidationIssue(
        code: ProtocolErrorCode.invalidPayload,
        path: '$path.size',
        message: 'Size must be "medium".',
      ),
    );
  }
  if (snapshot.containsKey('theme') && !_snapshotThemes.contains(snapshot['theme'])) {
    issues.add(
      ProtocolValidationIssue(
        code: ProtocolErrorCode.invalidPayload,
        path: '$path.theme',
        message: 'Unknown theme.',
      ),
    );
  }

  final content = snapshot['content'];
  if (content is! List) {
    issues.add(
      ProtocolValidationIssue(
        code: ProtocolErrorCode.invalidPayload,
        path: '$path.content',
        message: 'Content must be an array.',
      ),
    );
    return issues;
  }

  for (var index = 0; index < content.length; index++) {
    issues.addAll(
      _validateOperation(content[index], '$path.content[$index]'),
    );
  }

  final last = content.isEmpty ? null : content.last;
  final hasTerminalNewline =
      last is Map &&
      _asJsonMap(last)['insert'] is String &&
      (_asJsonMap(last)['insert']! as String).endsWith('\n');
  if (!hasTerminalNewline) {
    issues.add(
      ProtocolValidationIssue(
        code: ProtocolErrorCode.invalidPayload,
        path: '$path.content',
        message: 'Delta document must end with a newline.',
      ),
    );
  }
  return issues;
}

List<ProtocolValidationIssue> _validateOperation(Object? input, String path) {
  if (input is! Map) {
    return [
      ProtocolValidationIssue(
        code: ProtocolErrorCode.invalidPayload,
        path: path,
        message: 'Operation must be an object.',
      ),
    ];
  }

  final operation = _asJsonMap(input);
  final issues = <ProtocolValidationIssue>[];
  for (final key in operation.keys) {
    if (!_operationKeys.contains(key)) {
      issues.add(
        ProtocolValidationIssue(
          code: ProtocolErrorCode.invalidPayload,
          path: '$path.$key',
          message: 'Unknown operation property: $key.',
        ),
      );
    }
  }

  if (!operation.containsKey('insert')) {
    issues.add(
      ProtocolValidationIssue(
        code: ProtocolErrorCode.invalidPayload,
        path: '$path.insert',
        message: 'Operation must contain insert.',
      ),
    );
    return issues;
  }

  final insert = operation['insert'];
  if (insert is String) {
    issues.addAll(_validateTextOperation(operation, path));
  } else if (insert is Map) {
    issues.addAll(_validateEmbedOperation(operation, path));
  } else {
    issues.add(
      ProtocolValidationIssue(
        code: ProtocolErrorCode.invalidPayload,
        path: '$path.insert',
        message: 'Insert must be a string or embed object.',
      ),
    );
  }
  return issues;
}

List<ProtocolValidationIssue> _validateTextOperation(
  ProtocolJsonMap operation,
  String path,
) {
  final issues = <ProtocolValidationIssue>[];
  final insert = operation['insert']! as String;
  if (insert.isEmpty) {
    issues.add(
      ProtocolValidationIssue(
        code: ProtocolErrorCode.invalidPayload,
        path: '$path.insert',
        message: 'Text insert must not be empty.',
      ),
    );
  }
  if (!operation.containsKey('attributes')) return issues;

  final attributes = operation['attributes'];
  if (attributes is! Map) {
    issues.add(
      ProtocolValidationIssue(
        code: ProtocolErrorCode.invalidPayload,
        path: '$path.attributes',
        message: 'Attributes must be an object.',
      ),
    );
    return issues;
  }
  final attrs = _asJsonMap(attributes);
  final containsNewline = insert.contains('\n');
  final isOnlyNewlines = RegExp(r'^[\n]+$').hasMatch(insert);
  if (containsNewline && !isOnlyNewlines) {
    issues.add(
      ProtocolValidationIssue(
        code: ProtocolErrorCode.invalidPayload,
        path: '$path.insert',
        message: 'Text and newline characters must be split into separate operations.',
      ),
    );
    return issues;
  }
  issues.addAll(
    isOnlyNewlines
        ? _validateBlockAttributes(attrs, '$path.attributes')
        : _validateInlineAttributes(attrs, '$path.attributes'),
  );
  return issues;
}

List<ProtocolValidationIssue> _validateInlineAttributes(
  ProtocolJsonMap attributes,
  String path,
) {
  final issues = <ProtocolValidationIssue>[];
  for (final entry in attributes.entries) {
    if (!_inlineAttributeKeys.contains(entry.key)) {
      issues.add(
        ProtocolValidationIssue(
          code: ProtocolErrorCode.invalidPayload,
          path: '$path.${entry.key}',
          message: 'Unknown inline attribute: ${entry.key}.',
        ),
      );
      continue;
    }
    if (entry.key == 'link') {
      if (!_isAllowedLink(entry.value)) {
        issues.add(
          ProtocolValidationIssue(
            code: ProtocolErrorCode.invalidPayload,
            path: '$path.link',
            message: 'Link scheme is not allowed.',
          ),
        );
      }
    } else if (entry.value != true) {
      issues.add(
        ProtocolValidationIssue(
          code: ProtocolErrorCode.invalidPayload,
          path: '$path.${entry.key}',
          message: '${entry.key} must be true.',
        ),
      );
    }
  }
  return issues;
}

List<ProtocolValidationIssue> _validateBlockAttributes(
  ProtocolJsonMap attributes,
  String path,
) {
  final issues = <ProtocolValidationIssue>[];
  for (final key in attributes.keys) {
    if (!_blockAttributeKeys.contains(key)) {
      issues.add(
        ProtocolValidationIssue(
          code: ProtocolErrorCode.invalidPayload,
          path: '$path.$key',
          message: 'Unknown block attribute: $key.',
        ),
      );
    }
  }

  final hasHeader = attributes.containsKey('header');
  final hasList = attributes.containsKey('list');
  final hasIndent = attributes.containsKey('indent');
  final hasBlockquote = attributes.containsKey('blockquote');
  final header = attributes['header'];
  final list = attributes['list'];
  final indent = attributes['indent'];
  final blockquote = attributes['blockquote'];

  if (hasHeader && header != 1 && header != 2 && header != 3) {
    issues.add(
      ProtocolValidationIssue(
        code: ProtocolErrorCode.invalidPayload,
        path: '$path.header',
        message: 'Header must be 1, 2 or 3.',
      ),
    );
  }
  if (hasList && list != 'ordered' && list != 'bullet') {
    issues.add(
      ProtocolValidationIssue(
        code: ProtocolErrorCode.invalidPayload,
        path: '$path.list',
        message: 'List must be "ordered" or "bullet".',
      ),
    );
  }
  if (hasIndent && !_isIntegerInRange(indent, 1, 5)) {
    issues.add(
      ProtocolValidationIssue(
        code: ProtocolErrorCode.invalidPayload,
        path: '$path.indent',
        message: 'Indent must be an integer from 1 to 5.',
      ),
    );
  }
  if (hasBlockquote && blockquote != true) {
    issues.add(
      ProtocolValidationIssue(
        code: ProtocolErrorCode.invalidPayload,
        path: '$path.blockquote',
        message: 'Blockquote must be true.',
      ),
    );
  }
  if ([hasHeader, hasList, hasBlockquote].where((present) => present).length > 1) {
    issues.add(
      ProtocolValidationIssue(
        code: ProtocolErrorCode.invalidPayload,
        path: path,
        message: 'Header, list and blockquote are mutually exclusive.',
      ),
    );
  }
  if (hasIndent && !hasList && !hasBlockquote) {
    issues.add(
      ProtocolValidationIssue(
        code: ProtocolErrorCode.invalidPayload,
        path: '$path.indent',
        message: 'Indent may only be combined with list or blockquote.',
      ),
    );
  }
  return issues;
}

List<ProtocolValidationIssue> _validateEmbedOperation(
  ProtocolJsonMap operation,
  String path,
) {
  final insert = _asJsonMap(operation['insert']! as Map);
  final issues = <ProtocolValidationIssue>[];
  if (insert.length != 1) {
    issues.add(
      ProtocolValidationIssue(
        code: ProtocolErrorCode.invalidPayload,
        path: '$path.insert',
        message: 'Embed object must contain exactly one key.',
      ),
    );
    return issues;
  }
  final embedKey = insert.keys.single;
  if (!_embedKeys.contains(embedKey)) {
    issues.add(
      ProtocolValidationIssue(
        code: ProtocolErrorCode.invalidPayload,
        path: '$path.insert',
        message: 'Unknown embed: $embedKey.',
      ),
    );
    return issues;
  }

  switch (embedKey) {
    case 'mention':
      _validateMentionEmbed(operation, insert, path, issues);
    case 'channel':
      _validateChannelEmbed(operation, insert, path, issues);
    case 'emoji':
      _validateSimpleEmbed(operation, insert, 'emoji', path, issues);
    case 'divider':
      _validateDividerEmbed(operation, insert, path, issues);
    case 'image':
      _validateImageEmbed(operation, insert, path, issues);
    case 'video':
      _validateVideoEmbed(operation, insert, path, issues);
  }
  return issues;
}

void _validateMentionEmbed(
  ProtocolJsonMap operation,
  ProtocolJsonMap insert,
  String path,
  List<ProtocolValidationIssue> issues,
) {
  _addNonEmptyStringIssue(
    issues,
    insert['mention'],
    '$path.insert.mention',
    'Mention id',
  );
  final attributes = operation['attributes'];
  if (attributes is! Map) {
    issues.add(
      ProtocolValidationIssue(
        code: ProtocolErrorCode.invalidPayload,
        path: '$path.attributes',
        message: 'Mention attributes are required.',
      ),
    );
    return;
  }
  final attrs = _asJsonMap(attributes);
  for (final key in attrs.keys) {
    if (key != 'sign' && key != 'displayText') {
      issues.add(
        ProtocolValidationIssue(
          code: ProtocolErrorCode.invalidPayload,
          path: '$path.attributes.$key',
          message: 'Unknown mention attribute: $key.',
        ),
      );
    }
  }
  if (attrs['sign'] != '!' && attrs['sign'] != '&') {
    issues.add(
      ProtocolValidationIssue(
        code: ProtocolErrorCode.invalidPayload,
        path: '$path.attributes.sign',
        message: 'Mention sign must be "!" or "&".',
      ),
    );
  }
  _addNonEmptyStringIssue(
    issues,
    attrs['displayText'],
    '$path.attributes.displayText',
    'Mention displayText',
  );
}

void _validateChannelEmbed(
  ProtocolJsonMap operation,
  ProtocolJsonMap insert,
  String path,
  List<ProtocolValidationIssue> issues,
) {
  _addNonEmptyStringIssue(
    issues,
    insert['channel'],
    '$path.insert.channel',
    'Channel id',
  );
  final attributes = operation['attributes'];
  if (attributes is! Map) {
    issues.add(
      ProtocolValidationIssue(
        code: ProtocolErrorCode.invalidPayload,
        path: '$path.attributes',
        message: 'Channel attributes are required.',
      ),
    );
    return;
  }
  final attrs = _asJsonMap(attributes);
  for (final key in attrs.keys) {
    if (key != 'displayText') {
      issues.add(
        ProtocolValidationIssue(
          code: ProtocolErrorCode.invalidPayload,
          path: '$path.attributes.$key',
          message: 'Unknown channel attribute: $key.',
        ),
      );
    }
  }
  _addNonEmptyStringIssue(
    issues,
    attrs['displayText'],
    '$path.attributes.displayText',
    'Channel displayText',
  );
}

void _validateSimpleEmbed(
  ProtocolJsonMap operation,
  ProtocolJsonMap insert,
  String key,
  String path,
  List<ProtocolValidationIssue> issues,
) {
  _addNonEmptyStringIssue(issues, insert[key], '$path.insert.$key', 'Emoji id');
  if (operation.containsKey('attributes')) {
    issues.add(
      ProtocolValidationIssue(
        code: ProtocolErrorCode.invalidPayload,
        path: '$path.attributes',
        message: 'Emoji must not contain attributes.',
      ),
    );
  }
}

void _validateDividerEmbed(
  ProtocolJsonMap operation,
  ProtocolJsonMap insert,
  String path,
  List<ProtocolValidationIssue> issues,
) {
  if (insert['divider'] != 'true' && insert['divider'] != true) {
    issues.add(
      ProtocolValidationIssue(
        code: ProtocolErrorCode.invalidPayload,
        path: '$path.insert.divider',
        message: 'Divider value must be "true".',
      ),
    );
  }
  if (operation.containsKey('attributes')) {
    issues.add(
      ProtocolValidationIssue(
        code: ProtocolErrorCode.invalidPayload,
        path: '$path.attributes',
        message: 'Divider must not contain attributes.',
      ),
    );
  }
}

void _validateImageEmbed(
  ProtocolJsonMap operation,
  ProtocolJsonMap insert,
  String path,
  List<ProtocolValidationIssue> issues,
) {
  _validateMediaUri(insert['image'], '$path.insert.image', issues);
  final attributes = _validateBaseMediaAttributes(
    operation['attributes'],
    '$path.attributes',
    issues,
  );
  if (attributes == null) return;
  for (final key in attributes.keys) {
    if (!{'width', 'height', 'mimeType', 'fileSize'}.contains(key)) {
      issues.add(
        ProtocolValidationIssue(
          code: ProtocolErrorCode.invalidPayload,
          path: '$path.attributes.$key',
          message: 'Unknown image attribute: $key.',
        ),
      );
    }
  }
}

void _validateVideoEmbed(
  ProtocolJsonMap operation,
  ProtocolJsonMap insert,
  String path,
  List<ProtocolValidationIssue> issues,
) {
  _validateMediaUri(insert['video'], '$path.insert.video', issues);
  final attributes = _validateBaseMediaAttributes(
    operation['attributes'],
    '$path.attributes',
    issues,
  );
  if (attributes == null) return;
  for (final key in attributes.keys) {
    if (!{
      'width',
      'height',
      'mimeType',
      'fileSize',
      'poster',
      'duration',
    }.contains(key)) {
      issues.add(
        ProtocolValidationIssue(
          code: ProtocolErrorCode.invalidPayload,
          path: '$path.attributes.$key',
          message: 'Unknown video attribute: $key.',
        ),
      );
    }
  }
  if (attributes.containsKey('poster')) {
    _validateMediaUri(attributes['poster'], '$path.attributes.poster', issues);
  }
  if (attributes.containsKey('duration') && !_isSafeNonNegativeInteger(attributes['duration'])) {
    issues.add(
      ProtocolValidationIssue(
        code: ProtocolErrorCode.invalidPayload,
        path: '$path.attributes.duration',
        message: 'Video duration must be a non-negative integer.',
      ),
    );
  }
}

ProtocolJsonMap? _validateBaseMediaAttributes(
  Object? input,
  String path,
  List<ProtocolValidationIssue> issues,
) {
  if (input is! Map) {
    issues.add(
      ProtocolValidationIssue(
        code: ProtocolErrorCode.invalidPayload,
        path: path,
        message: 'Media attributes are required.',
      ),
    );
    return null;
  }
  final attributes = _asJsonMap(input);
  for (final key in const ['width', 'height']) {
    if (attributes[key] is! String ||
        !_decimalDimensionPattern.hasMatch(attributes[key]! as String)) {
      issues.add(
        ProtocolValidationIssue(
          code: ProtocolErrorCode.invalidPayload,
          path: '$path.$key',
          message: 'Media $key must be a decimal integer string.',
        ),
      );
    }
  }
  _addNonEmptyStringIssue(
    issues,
    attributes['mimeType'],
    '$path.mimeType',
    'Media mimeType',
  );
  if (!_isSafeNonNegativeInteger(attributes['fileSize'])) {
    issues.add(
      ProtocolValidationIssue(
        code: ProtocolErrorCode.invalidPayload,
        path: '$path.fileSize',
        message: 'Media fileSize must be a non-negative integer.',
      ),
    );
  }
  return attributes;
}

void _validateMediaUri(
  Object? value,
  String path,
  List<ProtocolValidationIssue> issues,
) {
  if (!_isAllowedMediaUri(value)) {
    issues.add(
      ProtocolValidationIssue(
        code: ProtocolErrorCode.invalidPayload,
        path: path,
        message: 'Media URI must be HTTPS or tgg-local-media.',
      ),
    );
  }
}

bool _isAllowedLink(Object? value) {
  if (value is! String) return false;
  final uri = Uri.tryParse(value.trim());
  if (uri == null) return false;
  final scheme = uri.scheme.toLowerCase();
  if (!const {'http', 'https', 'mp', 'mps'}.contains(scheme)) return false;
  if (scheme == 'http' || scheme == 'https') return uri.host.isNotEmpty;
  return uri.host.isNotEmpty || uri.path.isNotEmpty;
}

int? _safeIntegerValue(Object? value) {
  if (value is int) {
    return value >= -_maxSafeInteger && value <= _maxSafeInteger ? value : null;
  }
  if (value is double && value.isFinite && value >= -_maxSafeInteger && value <= _maxSafeInteger) {
    if (value != value.truncateToDouble()) return null;
    return value.toInt();
  }
  return null;
}

bool _isSafeNonNegativeInteger(Object? value) {
  final integer = _safeIntegerValue(value);
  return integer != null && integer >= 0;
}

bool _isIntegerInRange(Object? value, int min, int max) {
  if (value is int) return value >= min && value <= max;
  if (value is double && value.isFinite && value == value.truncateToDouble()) {
    return value >= min && value <= max;
  }
  return false;
}

Object? _normalizeIntegralDoubles(Object? input) {
  if (input is double &&
      input.isFinite &&
      input >= -_maxSafeInteger &&
      input <= _maxSafeInteger &&
      input == input.truncateToDouble()) {
    return input.toInt();
  }
  if (input is List) {
    return input.map(_normalizeIntegralDoubles).toList();
  }
  if (input is Map) {
    return <String, Object?>{
      for (final entry in input.entries)
        entry.key.toString(): _normalizeIntegralDoubles(entry.value),
    };
  }
  return input;
}

List<ProtocolValidationIssue> _validateSelectionContainer(
  ProtocolJsonMap? container,
  String path, {
  required bool nullable,
  bool requireContainer = false,
}) {
  if (container == null) {
    if (requireContainer) {
      return [
        ProtocolValidationIssue(
          code: ProtocolErrorCode.invalidPayload,
          path: path,
          message: 'Selection container must be an object.',
        ),
      ];
    }
    return const [];
  }

  final issues = _validateExactKeys(
    container,
    const ['selection'],
    path: path,
    label: 'selection container',
  );

  final selection = container['selection'];
  if (selection == null) {
    if (!nullable) {
      issues.add(
        ProtocolValidationIssue(
          code: ProtocolErrorCode.invalidPayload,
          path: '$path.selection',
          message: 'Selection must be an object.',
        ),
      );
    }
    return issues;
  }
  issues.addAll(_validateSelection(selection, '$path.selection'));
  return issues;
}

List<ProtocolValidationIssue> _validateSelection(Object? input, String path) {
  if (input is! Map) {
    return [
      ProtocolValidationIssue(
        code: ProtocolErrorCode.invalidPayload,
        path: path,
        message: 'Selection must be an object.',
      ),
    ];
  }
  final map = _asJsonMap(input);
  final issues = _validateExactKeys(
    map,
    const ['start', 'end'],
    path: path,
    label: 'selection',
  );

  final start = map['start'];
  final end = map['end'];
  final startInteger = _safeIntegerValue(start);
  final endInteger = _safeIntegerValue(end);
  if (startInteger == null || startInteger < 0) {
    issues.add(
      ProtocolValidationIssue(
        code: ProtocolErrorCode.invalidPayload,
        path: '$path.start',
        message: 'Selection start must be a non-negative integer.',
      ),
    );
  }
  if (endInteger == null || startInteger == null || endInteger < startInteger) {
    issues.add(
      ProtocolValidationIssue(
        code: ProtocolErrorCode.invalidPayload,
        path: '$path.end',
        message: 'Selection end must be an integer greater than or equal to start.',
      ),
    );
  }
  return issues;
}

List<ProtocolValidationIssue> _validateBlockFormatPayload(ProtocolJsonMap map) {
  final format = map['format'];
  if (format == 'blockquote') {
    return _validateExactKeys(
      map,
      const ['format'],
      path: r'$.payload',
      label: 'blockquote payload',
    );
  }

  final issues = _validateExactKeys(
    map,
    const ['format', 'value'],
    path: r'$.payload',
    label: 'block format payload',
  );

  if (format == 'header') {
    if (ProtocolHeaderLevel.tryParse(map['value']) == null) {
      issues.add(
        const ProtocolValidationIssue(
          code: ProtocolErrorCode.invalidPayload,
          path: r'$.payload.value',
          message: 'Header value must be 1, 2, or 3.',
        ),
      );
    }
  } else if (format == 'list') {
    if (map['value'] is! String || ProtocolListType.tryParse(map['value']! as String) == null) {
      issues.add(
        const ProtocolValidationIssue(
          code: ProtocolErrorCode.invalidPayload,
          path: r'$.payload.value',
          message: 'Unknown list value.',
        ),
      );
    }
  } else {
    issues.add(
      const ProtocolValidationIssue(
        code: ProtocolErrorCode.invalidPayload,
        path: r'$.payload.format',
        message: 'Unknown block format.',
      ),
    );
  }
  return issues;
}

List<ProtocolValidationIssue> _validateStateContainer(Object? payload) {
  if (payload is! Map) {
    return [
      const ProtocolValidationIssue(
        code: ProtocolErrorCode.invalidPayload,
        path: r'$.payload',
        message: 'State payload must be an object.',
      ),
    ];
  }
  final map = _asJsonMap(payload);
  final issues = _validateExactKeys(
    map,
    const ['state'],
    path: r'$.payload',
    label: 'state payload',
  )..addAll(_validateEditorState(map['state'], r'$.payload.state'));
  return issues;
}

List<ProtocolValidationIssue> _validateEditorState(Object? input, String path) {
  if (input is! Map) {
    return [
      ProtocolValidationIssue(
        code: ProtocolErrorCode.invalidPayload,
        path: path,
        message: 'Editor state must be an object.',
      ),
    ];
  }
  final map = _asJsonMap(input);
  final issues = _validateExactKeys(
    map,
    const ['focused', 'selection', 'canUndo', 'canRedo', 'formats'],
    path: path,
    label: 'editor state',
  );

  if (map['focused'] is! bool) {
    issues.add(
      ProtocolValidationIssue(
        code: ProtocolErrorCode.invalidPayload,
        path: '$path.focused',
        message: 'focused must be a boolean.',
      ),
    );
  }
  if (map['canUndo'] is! bool) {
    issues.add(
      ProtocolValidationIssue(
        code: ProtocolErrorCode.invalidPayload,
        path: '$path.canUndo',
        message: 'canUndo must be a boolean.',
      ),
    );
  }
  if (map['canRedo'] is! bool) {
    issues.add(
      ProtocolValidationIssue(
        code: ProtocolErrorCode.invalidPayload,
        path: '$path.canRedo',
        message: 'canRedo must be a boolean.',
      ),
    );
  }
  if (map['selection'] != null) {
    issues.addAll(_validateSelection(map['selection'], '$path.selection'));
  }
  issues.addAll(_validateFormats(map['formats'], '$path.formats'));
  return issues;
}

List<ProtocolValidationIssue> _validateFormats(Object? input, String path) {
  if (input is! Map) {
    return [
      ProtocolValidationIssue(
        code: ProtocolErrorCode.invalidPayload,
        path: path,
        message: 'Editor formats must be an object.',
      ),
    ];
  }
  final map = _asJsonMap(input);
  final issues = _validateExactKeys(
    map,
    const ['bold', 'italic', 'underline', 'strike', 'header', 'list', 'blockquote'],
    path: path,
    label: 'editor formats',
  );

  for (final key in const ['bold', 'italic', 'underline', 'strike', 'blockquote']) {
    if (map[key] is! bool) {
      issues.add(
        ProtocolValidationIssue(
          code: ProtocolErrorCode.invalidPayload,
          path: '$path.$key',
          message: '$key must be a boolean.',
        ),
      );
    }
  }

  final header = map['header'];
  if (header != false && header != 1 && header != 2 && header != 3) {
    issues.add(
      ProtocolValidationIssue(
        code: ProtocolErrorCode.invalidPayload,
        path: '$path.header',
        message: 'header must be false, 1, 2, or 3.',
      ),
    );
  }

  final list = map['list'];
  if (list != false && list != 'ordered' && list != 'bullet') {
    issues.add(
      ProtocolValidationIssue(
        code: ProtocolErrorCode.invalidPayload,
        path: '$path.list',
        message: 'list must be false, ordered, or bullet.',
      ),
    );
  }

  return issues;
}

List<ProtocolValidationIssue> _validateFailureError(Object? input) {
  if (input is! Map) {
    return [
      const ProtocolValidationIssue(
        code: ProtocolErrorCode.invalidPayload,
        path: r'$.error',
        message: 'Response error must be an object.',
      ),
    ];
  }
  final map = _asJsonMap(input);
  final keys = map.containsKey('details')
      ? const ['code', 'message', 'details']
      : const ['code', 'message'];
  final issues = _validateExactKeys(
    map,
    keys,
    path: r'$.error',
    label: 'response error',
  );

  final code = map['code'];
  if (code is! String || ProtocolErrorCode.tryParse(code) == null) {
    issues.add(
      const ProtocolValidationIssue(
        code: ProtocolErrorCode.invalidPayload,
        path: r'$.error.code',
        message: 'Unknown protocol error code.',
      ),
    );
  }

  final message = map['message'];
  if (message is! String || message.isEmpty) {
    issues.add(
      const ProtocolValidationIssue(
        code: ProtocolErrorCode.invalidPayload,
        path: r'$.error.message',
        message: 'Error message must be non-empty.',
      ),
    );
  }

  return issues;
}

List<ProtocolValidationIssue> _validateEmptyObject(Object? input, String path) {
  if (input is! Map) {
    return [
      ProtocolValidationIssue(
        code: ProtocolErrorCode.invalidPayload,
        path: path,
        message: 'Value must be an empty object.',
      ),
    ];
  }
  return _validateExactKeys(
    _asJsonMap(input),
    const [],
    path: path,
    label: 'empty object',
  );
}

List<ProtocolValidationIssue> _validateExactKeys(
  ProtocolJsonMap input,
  List<String> expected, {
  required String path,
  required String label,
  ProtocolErrorCode code = ProtocolErrorCode.invalidPayload,
}) {
  final issues = <ProtocolValidationIssue>[];
  final expectedKeys = expected.toSet();

  for (final key in input.keys) {
    if (!expectedKeys.contains(key)) {
      issues.add(
        ProtocolValidationIssue(
          code: code,
          path: '$path.$key',
          message: 'Unknown $label property: $key.',
        ),
      );
    }
  }
  for (final key in expected) {
    if (!input.containsKey(key)) {
      issues.add(
        ProtocolValidationIssue(
          code: code,
          path: '$path.$key',
          message: 'Missing $label property: $key.',
        ),
      );
    }
  }
  return issues;
}

ProtocolJsonMap _asJsonMap(Map<dynamic, dynamic> map) {
  return map.map((key, value) => MapEntry(key.toString(), value as Object?));
}

ProtocolParseFailure<ProtocolMessage> _fail(
  ProtocolErrorCode code,
  String path,
  String message,
) {
  return ProtocolParseFailure(
    ProtocolParseError(
      code: code,
      message: message,
      issues: [
        ProtocolValidationIssue(code: code, path: path, message: message),
      ],
    ),
  );
}

ProtocolParseFailure<ProtocolMessage> _fromIssues(
  ProtocolErrorCode code,
  String message,
  List<ProtocolValidationIssue> issues,
) {
  return ProtocolParseFailure(
    ProtocolParseError(code: code, message: message, issues: issues),
  );
}
