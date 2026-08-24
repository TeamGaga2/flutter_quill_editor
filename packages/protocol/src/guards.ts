import {
  isAllowedLink,
  isAllowedMediaUri,
  isDecimalDimension,
  isNonNegativeInteger,
  validateSnapshot,
} from "@teamgaga/richtext-delta";
import type { EditorCommandMessage, EditorCommandType } from "./commands";
import type { ProtocolErrorCode, ProtocolParseResult, ProtocolValidationIssue } from "./errors";
import type { EditorEventMessage } from "./events";
import type { EditorResponseMessage } from "./responses";
import { PROTOCOL_VERSION } from "./version";

export type ProtocolMessage = EditorCommandMessage | EditorEventMessage | EditorResponseMessage;

type UnknownRecord = Record<string, unknown>;

const COMMAND_TYPES = new Set<EditorCommandType>([
  "set_snapshot",
  "get_snapshot",
  "set_selection",
  "get_selection",
  "toggle_inline_format",
  "toggle_block_format",
  "insert_emoji",
  "insert_mention",
  "insert_channel",
  "insert_image",
  "insert_video",
  "insert_link",
  "insert_divider",
  "indent",
  "outdent",
  "get_caret_rect",
  "undo",
  "redo",
  "focus",
  "blur",
  "open_link_form",
]);
const EMPTY_COMMAND_TYPES = new Set<EditorCommandType>([
  "get_snapshot",
  "get_selection",
  "get_caret_rect",
  "indent",
  "outdent",
  "undo",
  "redo",
  "focus",
  "blur",
  "open_link_form",
]);
const EMPTY_SUCCESS_TYPES = new Set<EditorCommandType>([
  "set_snapshot",
  "set_selection",
  "toggle_inline_format",
  "toggle_block_format",
  "insert_emoji",
  "insert_mention",
  "insert_channel",
  "insert_image",
  "insert_video",
  "insert_link",
  "insert_divider",
  "indent",
  "outdent",
  "undo",
  "redo",
  "focus",
  "blur",
  "open_link_form",
]);
const EVENT_TYPES = new Set([
  "ready",
  "change",
  "selection_change",
  "focus",
  "blur",
  "title_focus",
  "title_blur",
  "state_change",
  "request_close",
  "request_emoji",
  "request_mention",
  "request_channel",
  "request_image",
  "request_paste_media",
]);
const ERROR_CODES = new Set<ProtocolErrorCode>([
  "invalid_json",
  "invalid_message",
  "unsupported_version",
  "unsupported_command",
  "invalid_payload",
  "editor_not_ready",
  "command_failed",
]);

export function parseProtocolCommand(input: unknown): ProtocolParseResult<EditorCommandMessage> {
  return safelyParse(() => parseCommand(input));
}

export function parseProtocolMessage(input: unknown): ProtocolParseResult<ProtocolMessage> {
  return safelyParse(() => {
    if (!isRecord(input)) {
      return failure("invalid_message", "$", "Protocol message must be an object.");
    }

    switch (input.kind) {
      case "command":
        return parseCommand(input);
      case "event":
        return parseEvent(input);
      case "response":
        return parseResponse(input);
      default:
        return failure("invalid_message", "$.kind", "Unknown protocol message kind.");
    }
  });
}

export function isProtocolMessage(input: unknown): input is ProtocolMessage {
  return parseProtocolMessage(input).ok;
}

function safelyParse<Value>(parser: () => ProtocolParseResult<Value>): ProtocolParseResult<Value> {
  try {
    return parser();
  } catch {
    return failure("invalid_message", "$", "Protocol message validation failed.");
  }
}

function parseCommand(input: unknown): ProtocolParseResult<EditorCommandMessage> {
  const envelope = validateEnvelope(input, "command", ["version", "kind", "id", "type", "payload"]);

  if (!envelope.ok) {
    return envelope;
  }

  const message = envelope.value;
  const idIssue = validateRequestId(message.id);

  if (idIssue) {
    return fromIssues("invalid_message", "Invalid command envelope.", [idIssue]);
  }

  if (typeof message.type !== "string" || !COMMAND_TYPES.has(message.type as EditorCommandType)) {
    return failure("unsupported_command", "$.type", "Unsupported editor command.");
  }

  const type = message.type as EditorCommandType;
  const payloadIssues = validateCommandPayload(type, message.payload);

  if (payloadIssues.length > 0) {
    return fromIssues("invalid_payload", "Invalid command payload.", payloadIssues);
  }

  return { ok: true, value: message as unknown as EditorCommandMessage };
}

function parseEvent(input: unknown): ProtocolParseResult<EditorEventMessage> {
  const envelope = validateEnvelope(input, "event", ["version", "kind", "type", "payload"]);

  if (!envelope.ok) {
    return envelope;
  }

  const message = envelope.value;

  if (typeof message.type !== "string" || !EVENT_TYPES.has(message.type)) {
    return failure("invalid_message", "$.type", "Unknown editor event type.");
  }

  const payloadIssues = validateEventPayload(message.type, message.payload);

  if (payloadIssues.length > 0) {
    return fromIssues("invalid_payload", "Invalid event payload.", payloadIssues);
  }

  return { ok: true, value: message as unknown as EditorEventMessage };
}

function parseResponse(input: unknown): ProtocolParseResult<EditorResponseMessage> {
  if (!isRecord(input)) {
    return failure("invalid_message", "$", "Protocol message must be an object.");
  }

  if (input.ok !== true && input.ok !== false) {
    return failure("invalid_message", "$.ok", "Response ok must be a boolean.");
  }

  const expectedKeys = input.ok
    ? ["version", "kind", "id", "type", "ok", "value"]
    : ["version", "kind", "id", "ok", "error"];
  const envelope = validateEnvelope(input, "response", expectedKeys);

  if (!envelope.ok) {
    return envelope;
  }

  const message = envelope.value;
  const idIssue = validateRequestId(message.id);

  if (idIssue) {
    return fromIssues("invalid_message", "Invalid response envelope.", [idIssue]);
  }

  if (message.ok === true) {
    if (typeof message.type !== "string" || !COMMAND_TYPES.has(message.type as EditorCommandType)) {
      return failure("invalid_message", "$.type", "Unknown response type.");
    }

    const valueIssues = validateSuccessValue(message.type as EditorCommandType, message.value);

    if (valueIssues.length > 0) {
      return fromIssues("invalid_payload", "Invalid response value.", valueIssues);
    }
  } else if (message.ok === false) {
    const errorIssues = validateFailureError(message.error);

    if (errorIssues.length > 0) {
      return fromIssues("invalid_payload", "Invalid failure response.", errorIssues);
    }
  }

  return { ok: true, value: message as unknown as EditorResponseMessage };
}

function validateEnvelope(
  input: unknown,
  kind: "command" | "event" | "response",
  keys: readonly string[],
): ProtocolParseResult<UnknownRecord> {
  if (!isRecord(input)) {
    return failure("invalid_message", "$", "Protocol message must be an object.");
  }

  const keyIssues = validateExactKeys(input, keys, "$", "message", "invalid_message");

  if (keyIssues.length > 0) {
    return fromIssues("invalid_message", "Invalid protocol envelope.", keyIssues);
  }

  if (input.version !== PROTOCOL_VERSION) {
    return failure(
      "unsupported_version",
      "$.version",
      `Protocol version must be ${PROTOCOL_VERSION}.`,
    );
  }

  if (input.kind !== kind) {
    return failure("invalid_message", "$.kind", `Message kind must be ${kind}.`);
  }

  return { ok: true, value: input };
}

function validateCommandPayload(
  type: EditorCommandType,
  payload: unknown,
): ProtocolValidationIssue[] {
  if (EMPTY_COMMAND_TYPES.has(type)) {
    return validateEmptyObject(payload, "$.payload");
  }

  if (!isRecord(payload)) {
    return [issue("invalid_payload", "$.payload", "Command payload must be an object.")];
  }

  switch (type) {
    case "set_snapshot":
      return validateSnapshotValue(payload, "$.payload", "snapshot");
    case "set_selection":
      return validateSelectionContainer(payload, "$.payload");
    case "toggle_inline_format":
      return validateInlineFormatPayload(payload);
    case "toggle_block_format":
      return validateBlockFormatPayload(payload);
    case "insert_emoji":
      return validateEmojiPayload(payload);
    case "insert_mention":
      return validateMentionPayload(payload);
    case "insert_channel":
      return validateChannelPayload(payload);
    case "insert_image":
      return validateImagePayload(payload);
    case "insert_video":
      return validateVideoPayload(payload);
    case "insert_link":
      return validateLinkPayload(payload);
    case "insert_divider":
      return validateDividerPayload(payload);
    case "get_snapshot":
    case "get_selection":
    case "get_caret_rect":
    case "indent":
    case "outdent":
    case "undo":
    case "redo":
    case "focus":
    case "blur":
    case "open_link_form":
      return validateEmptyObject(payload, "$.payload");
  }
}

function validateEventPayload(type: string, payload: unknown): ProtocolValidationIssue[] {
  switch (type) {
    case "ready": {
      if (!isRecord(payload)) {
        return [issue("invalid_payload", "$.payload", "Event payload must be an object.")];
      }
      const issues = validateExactKeys(payload, ["protocol_version"], "$.payload", "ready payload");
      if (payload.protocol_version !== PROTOCOL_VERSION) {
        issues.push(
          issue(
            "unsupported_version",
            "$.payload.protocol_version",
            `Ready event protocol_version must be ${PROTOCOL_VERSION}.`,
          ),
        );
      }
      return issues;
    }
    case "change":
      return isRecord(payload)
        ? validateSnapshotValue(payload, "$.payload", "snapshot")
        : [issue("invalid_payload", "$.payload", "Event payload must be an object.")];
    case "selection_change":
    case "request_emoji":
    case "request_mention":
    case "request_channel":
    case "request_image":
      return validateNullableSelectionContainer(payload, "$.payload");
    case "focus":
    case "blur":
    case "title_focus":
    case "title_blur":
    case "request_close":
      return validateEmptyObject(payload, "$.payload");
    case "state_change":
      return validateStateContainer(payload);
    case "request_paste_media":
      return validateRequestPasteMediaPayload(payload);
    default:
      return [issue("invalid_message", "$.type", "Unknown editor event type.")];
  }
}

function validateSuccessValue(type: EditorCommandType, value: unknown): ProtocolValidationIssue[] {
  if (EMPTY_SUCCESS_TYPES.has(type)) {
    return validateEmptyObject(value, "$.value");
  }

  if (!isRecord(value)) {
    return [issue("invalid_payload", "$.value", "Response value must be an object.")];
  }

  switch (type) {
    case "get_snapshot":
      return validateSnapshotValue(value, "$.value", "snapshot");
    case "get_selection":
      return validateNullableSelectionContainer(value, "$.value");
    case "get_caret_rect":
      return validateNullableCaretRectContainer(value, "$.value");
    default:
      return validateEmptyObject(value, "$.value");
  }
}

function validateSnapshotValue(
  container: UnknownRecord,
  path: string,
  key: "snapshot",
): ProtocolValidationIssue[] {
  const issues = validateExactKeys(container, [key], path, `${key} container`);

  if (!isJsonValue(container[key])) {
    issues.push(
      issue("invalid_payload", `${path}.${key}`, "Snapshot must contain only JSON values."),
    );
    return issues;
  }

  const result = validateSnapshot(container[key], { context: "editor" });

  if (!result.ok) {
    for (const snapshotIssue of result.issues) {
      const suffix = snapshotIssue.path === "$" ? "" : snapshotIssue.path.slice(1);
      issues.push(issue("invalid_payload", `${path}.${key}${suffix}`, snapshotIssue.message));
    }
  }

  return issues;
}

function validateSelectionContainer(
  container: UnknownRecord,
  path: string,
): ProtocolValidationIssue[] {
  const issues = validateExactKeys(container, ["selection"], path, "selection container");
  issues.push(...validateSelection(container.selection, `${path}.selection`));
  return issues;
}

function validateNullableSelectionContainer(
  input: unknown,
  path: string,
): ProtocolValidationIssue[] {
  if (!isRecord(input)) {
    return [issue("invalid_payload", path, "Selection container must be an object.")];
  }

  const issues = validateExactKeys(input, ["selection"], path, "selection container");

  if (input.selection !== null) {
    issues.push(...validateSelection(input.selection, `${path}.selection`));
  }

  return issues;
}

function validateSelection(input: unknown, path: string): ProtocolValidationIssue[] {
  if (!isRecord(input)) {
    return [issue("invalid_payload", path, "Selection must be an object.")];
  }

  const issues = validateExactKeys(input, ["start", "end"], path, "selection");

  if (!Number.isSafeInteger(input.start) || (input.start as number) < 0) {
    issues.push(
      issue("invalid_payload", `${path}.start`, "Selection start must be a non-negative integer."),
    );
  }

  if (
    !Number.isSafeInteger(input.end) ||
    !Number.isSafeInteger(input.start) ||
    (input.end as number) < (input.start as number)
  ) {
    issues.push(
      issue(
        "invalid_payload",
        `${path}.end`,
        "Selection end must be an integer greater than or equal to start.",
      ),
    );
  }

  return issues;
}

function validateInlineFormatPayload(payload: UnknownRecord): ProtocolValidationIssue[] {
  const issues = validateExactKeys(payload, ["format"], "$.payload", "inline format payload");

  if (!new Set(["bold", "italic", "underline", "strike"]).has(payload.format as string)) {
    issues.push(issue("invalid_payload", "$.payload.format", "Unknown inline format."));
  }

  return issues;
}

function validateBlockFormatPayload(payload: UnknownRecord): ProtocolValidationIssue[] {
  if (payload.format === "blockquote") {
    return validateExactKeys(payload, ["format"], "$.payload", "blockquote payload");
  }

  const issues = validateExactKeys(
    payload,
    ["format", "value"],
    "$.payload",
    "block format payload",
  );

  if (payload.format === "header") {
    if (payload.value !== 1 && payload.value !== 2 && payload.value !== 3) {
      issues.push(issue("invalid_payload", "$.payload.value", "Header value must be 1, 2, or 3."));
    }
  } else if (payload.format === "list") {
    if (payload.value !== "ordered" && payload.value !== "bullet") {
      issues.push(issue("invalid_payload", "$.payload.value", "Unknown list value."));
    }
  } else {
    issues.push(issue("invalid_payload", "$.payload.format", "Unknown block format."));
  }

  return issues;
}

function validateEmojiPayload(payload: UnknownRecord): ProtocolValidationIssue[] {
  const issues = validateExactKeys(payload, ["id"], "$.payload", "emoji payload");

  if (typeof payload.id !== "string" || payload.id.trim().length === 0) {
    issues.push(issue("invalid_payload", "$.payload.id", "Emoji id must be a non-empty string."));
  }

  return issues;
}

function validateMentionPayload(payload: UnknownRecord): ProtocolValidationIssue[] {
  const issues = validateExactKeysWithOptional(
    payload,
    ["id", "sign", "displayText"],
    ["selection"],
    "$.payload",
    "mention payload",
  );

  if (typeof payload.id !== "string" || payload.id.trim().length === 0) {
    issues.push(issue("invalid_payload", "$.payload.id", "Mention id must be a non-empty string."));
  }

  if (payload.sign !== "!" && payload.sign !== "&") {
    issues.push(issue("invalid_payload", "$.payload.sign", 'Mention sign must be "!" or "&".'));
  }

  if (typeof payload.displayText !== "string" || payload.displayText.trim().length === 0) {
    issues.push(
      issue("invalid_payload", "$.payload.displayText", "Mention displayText must be non-empty."),
    );
  }

  issues.push(...validateOptionalSelection(payload, "$.payload"));
  return issues;
}

function validateChannelPayload(payload: UnknownRecord): ProtocolValidationIssue[] {
  const issues = validateExactKeysWithOptional(
    payload,
    ["id", "displayText"],
    ["selection"],
    "$.payload",
    "channel payload",
  );

  if (typeof payload.id !== "string" || payload.id.trim().length === 0) {
    issues.push(issue("invalid_payload", "$.payload.id", "Channel id must be a non-empty string."));
  }

  if (typeof payload.displayText !== "string" || payload.displayText.trim().length === 0) {
    issues.push(
      issue("invalid_payload", "$.payload.displayText", "Channel displayText must be non-empty."),
    );
  }

  issues.push(...validateOptionalSelection(payload, "$.payload"));
  return issues;
}

function validateImagePayload(payload: UnknownRecord): ProtocolValidationIssue[] {
  const issues = validateExactKeysWithOptional(
    payload,
    ["src", "width", "height", "mimeType", "fileSize"],
    ["selection"],
    "$.payload",
    "image payload",
  );

  issues.push(...validateMediaPayload(payload, "image"));
  issues.push(...validateOptionalSelection(payload, "$.payload"));
  return issues;
}

function validateVideoPayload(payload: UnknownRecord): ProtocolValidationIssue[] {
  const issues = validateExactKeysWithOptional(
    payload,
    ["src", "width", "height", "mimeType", "fileSize"],
    ["poster", "duration", "selection"],
    "$.payload",
    "video payload",
  );

  issues.push(...validateMediaPayload(payload, "video"));

  if (
    Object.prototype.hasOwnProperty.call(payload, "poster") &&
    !isAllowedMediaUri(payload.poster)
  ) {
    issues.push(
      issue(
        "invalid_payload",
        "$.payload.poster",
        "Video poster must be HTTPS or tgg-local-media.",
      ),
    );
  }

  if (
    Object.prototype.hasOwnProperty.call(payload, "duration") &&
    !isNonNegativeInteger(payload.duration)
  ) {
    issues.push(
      issue(
        "invalid_payload",
        "$.payload.duration",
        "Video duration must be a non-negative integer.",
      ),
    );
  }

  issues.push(...validateOptionalSelection(payload, "$.payload"));
  return issues;
}

function validateLinkPayload(payload: UnknownRecord): ProtocolValidationIssue[] {
  const issues = validateExactKeysWithOptional(
    payload,
    ["url", "text"],
    ["selection"],
    "$.payload",
    "link payload",
  );

  if (!isAllowedLink(payload.url)) {
    issues.push(issue("invalid_payload", "$.payload.url", "Link scheme is not allowed."));
  }

  if (typeof payload.text !== "string" || payload.text.trim().length === 0) {
    issues.push(issue("invalid_payload", "$.payload.text", "Link text must be non-empty."));
  }

  issues.push(...validateOptionalSelection(payload, "$.payload"));
  return issues;
}

function validateDividerPayload(payload: UnknownRecord): ProtocolValidationIssue[] {
  const issues = validateExactKeysWithOptional(
    payload,
    [],
    ["selection"],
    "$.payload",
    "divider payload",
  );
  issues.push(...validateOptionalSelection(payload, "$.payload"));
  return issues;
}

function validateMediaPayload(
  payload: UnknownRecord,
  kind: "image" | "video",
): ProtocolValidationIssue[] {
  const issues: ProtocolValidationIssue[] = [];

  if (!isAllowedMediaUri(payload.src)) {
    issues.push(
      issue("invalid_payload", "$.payload.src", "Media src must be HTTPS or tgg-local-media."),
    );
  }

  if (!isDecimalDimension(payload.width)) {
    issues.push(
      issue("invalid_payload", "$.payload.width", "Media width must be a decimal integer string."),
    );
  }

  if (!isDecimalDimension(payload.height)) {
    issues.push(
      issue(
        "invalid_payload",
        "$.payload.height",
        "Media height must be a decimal integer string.",
      ),
    );
  }

  if (typeof payload.mimeType !== "string" || payload.mimeType.trim().length === 0) {
    issues.push(
      issue("invalid_payload", "$.payload.mimeType", "Media mimeType must be non-empty."),
    );
  }

  if (!isNonNegativeInteger(payload.fileSize)) {
    issues.push(
      issue(
        "invalid_payload",
        "$.payload.fileSize",
        "Media fileSize must be a non-negative integer.",
      ),
    );
  }

  if (kind === "image" && Object.prototype.hasOwnProperty.call(payload, "poster")) {
    issues.push(
      issue("invalid_payload", "$.payload.poster", "Image payload must not contain poster."),
    );
  }

  return issues;
}

function validateOptionalSelection(
  container: UnknownRecord,
  path: string,
): ProtocolValidationIssue[] {
  return Object.prototype.hasOwnProperty.call(container, "selection")
    ? validateSelection(container.selection, `${path}.selection`)
    : [];
}

function validateNullableCaretRectContainer(
  input: unknown,
  path: string,
): ProtocolValidationIssue[] {
  if (!isRecord(input)) {
    return [issue("invalid_payload", path, "Caret rect container must be an object.")];
  }

  const issues = validateExactKeys(input, ["rect"], path, "caret rect container");

  if (input.rect !== null) {
    issues.push(...validateCaretRect(input.rect, `${path}.rect`));
  }

  return issues;
}

function validateCaretRect(input: unknown, path: string): ProtocolValidationIssue[] {
  if (!isRecord(input)) {
    return [issue("invalid_payload", path, "Caret rect must be an object.")];
  }

  const issues = validateExactKeys(input, ["x", "y", "width", "height"], path, "caret rect");

  for (const key of ["x", "y", "width", "height"] as const) {
    if (typeof input[key] !== "number" || !Number.isFinite(input[key] as number)) {
      issues.push(
        issue("invalid_payload", `${path}.${key}`, `Caret rect ${key} must be a finite number.`),
      );
    }
  }

  if (
    typeof input.width === "number" &&
    Number.isFinite(input.width) &&
    (input.width as number) < 0
  ) {
    issues.push(issue("invalid_payload", `${path}.width`, "Caret rect width must be >= 0."));
  }

  if (
    typeof input.height === "number" &&
    Number.isFinite(input.height) &&
    (input.height as number) < 0
  ) {
    issues.push(issue("invalid_payload", `${path}.height`, "Caret rect height must be >= 0."));
  }

  return issues;
}

function validateExactKeysWithOptional(
  input: UnknownRecord,
  required: readonly string[],
  optional: readonly string[],
  path: string,
  label: string,
): ProtocolValidationIssue[] {
  const optionalPaths = new Set(optional.map((key) => `${path}.${key}`));

  return validateExactKeys(input, [...required, ...optional], path, label).filter(
    (validationIssue) =>
      !(optionalPaths.has(validationIssue.path) && validationIssue.message.startsWith("Missing ")),
  );
}

function validateStateContainer(payload: unknown): ProtocolValidationIssue[] {
  if (!isRecord(payload)) {
    return [issue("invalid_payload", "$.payload", "State payload must be an object.")];
  }

  const issues = validateExactKeys(payload, ["state"], "$.payload", "state payload");
  issues.push(...validateEditorState(payload.state, "$.payload.state"));
  return issues;
}

function validateEditorState(input: unknown, path: string): ProtocolValidationIssue[] {
  if (!isRecord(input)) {
    return [issue("invalid_payload", path, "Editor state must be an object.")];
  }

  const issues = validateExactKeys(
    input,
    ["focused", "selection", "canUndo", "canRedo", "formats"],
    path,
    "editor state",
  );

  if (typeof input.focused !== "boolean") {
    issues.push(issue("invalid_payload", `${path}.focused`, "focused must be a boolean."));
  }

  if (typeof input.canUndo !== "boolean") {
    issues.push(issue("invalid_payload", `${path}.canUndo`, "canUndo must be a boolean."));
  }

  if (typeof input.canRedo !== "boolean") {
    issues.push(issue("invalid_payload", `${path}.canRedo`, "canRedo must be a boolean."));
  }

  if (input.selection !== null) {
    issues.push(...validateSelection(input.selection, `${path}.selection`));
  }

  issues.push(...validateFormats(input.formats, `${path}.formats`));
  return issues;
}

function validateFormats(input: unknown, path: string): ProtocolValidationIssue[] {
  if (!isRecord(input)) {
    return [issue("invalid_payload", path, "Editor formats must be an object.")];
  }

  const issues = validateExactKeys(
    input,
    ["bold", "italic", "underline", "strike", "header", "list", "blockquote"],
    path,
    "editor formats",
  );

  for (const key of ["bold", "italic", "underline", "strike", "blockquote"] as const) {
    if (typeof input[key] !== "boolean") {
      issues.push(issue("invalid_payload", `${path}.${key}`, `${key} must be a boolean.`));
    }
  }

  if (input.header !== false && input.header !== 1 && input.header !== 2 && input.header !== 3) {
    issues.push(issue("invalid_payload", `${path}.header`, "header must be false, 1, 2, or 3."));
  }

  if (input.list !== false && input.list !== "ordered" && input.list !== "bullet") {
    issues.push(
      issue("invalid_payload", `${path}.list`, "list must be false, ordered, or bullet."),
    );
  }

  return issues;
}

function validateRequestPasteMediaPayload(payload: unknown): ProtocolValidationIssue[] {
  if (!isRecord(payload)) {
    return [issue("invalid_payload", "$.payload", "Event payload must be an object.")];
  }

  const issues = validateExactKeysWithOptional(
    payload,
    ["mimeType", "fileSize", "dataBase64", "selection"],
    ["width", "height", "fileName", "isVideo", "duration"],
    "$.payload",
    "request_paste_media payload",
  );

  if (typeof payload.mimeType !== "string" || payload.mimeType.trim().length === 0) {
    issues.push(
      issue("invalid_payload", "$.payload.mimeType", "mimeType must be a non-empty string."),
    );
  }

  if (!isNonNegativeInteger(payload.fileSize)) {
    issues.push(
      issue("invalid_payload", "$.payload.fileSize", "fileSize must be a non-negative integer."),
    );
  }

  if (typeof payload.dataBase64 !== "string" || payload.dataBase64.length === 0) {
    issues.push(
      issue("invalid_payload", "$.payload.dataBase64", "dataBase64 must be a non-empty string."),
    );
  }

  if (
    Object.prototype.hasOwnProperty.call(payload, "width") &&
    !isDecimalDimension(payload.width)
  ) {
    issues.push(
      issue("invalid_payload", "$.payload.width", "width must be a decimal integer string."),
    );
  }

  if (
    Object.prototype.hasOwnProperty.call(payload, "height") &&
    !isDecimalDimension(payload.height)
  ) {
    issues.push(
      issue("invalid_payload", "$.payload.height", "height must be a decimal integer string."),
    );
  }

  if (
    Object.prototype.hasOwnProperty.call(payload, "fileName") &&
    typeof payload.fileName !== "string"
  ) {
    issues.push(issue("invalid_payload", "$.payload.fileName", "fileName must be a string."));
  }

  if (
    Object.prototype.hasOwnProperty.call(payload, "isVideo") &&
    typeof payload.isVideo !== "boolean"
  ) {
    issues.push(issue("invalid_payload", "$.payload.isVideo", "isVideo must be a boolean."));
  }

  if (
    Object.prototype.hasOwnProperty.call(payload, "duration") &&
    !isNonNegativeInteger(payload.duration)
  ) {
    issues.push(
      issue("invalid_payload", "$.payload.duration", "duration must be a non-negative integer."),
    );
  }

  if (payload.selection !== null) {
    issues.push(...validateSelection(payload.selection, "$.payload.selection"));
  }

  return issues;
}

function validateFailureError(input: unknown): ProtocolValidationIssue[] {
  if (!isRecord(input)) {
    return [issue("invalid_payload", "$.error", "Response error must be an object.")];
  }

  const keys = Object.prototype.hasOwnProperty.call(input, "details")
    ? ["code", "message", "details"]
    : ["code", "message"];
  const issues = validateExactKeys(input, keys, "$.error", "response error");

  if (typeof input.code !== "string" || !ERROR_CODES.has(input.code as ProtocolErrorCode)) {
    issues.push(issue("invalid_payload", "$.error.code", "Unknown protocol error code."));
  }

  if (typeof input.message !== "string" || input.message.length === 0) {
    issues.push(issue("invalid_payload", "$.error.message", "Error message must be non-empty."));
  }

  if (Object.prototype.hasOwnProperty.call(input, "details") && !isJsonValue(input.details)) {
    issues.push(
      issue("invalid_payload", "$.error.details", "Error details must be JSON-serializable."),
    );
  }

  return issues;
}

function validateEmptyObject(input: unknown, path: string): ProtocolValidationIssue[] {
  if (!isRecord(input)) {
    return [issue("invalid_payload", path, "Value must be an empty object.")];
  }

  return validateExactKeys(input, [], path, "empty object");
}

function validateExactKeys(
  input: UnknownRecord,
  expected: readonly string[],
  path: string,
  label: string,
  code: ProtocolErrorCode = "invalid_payload",
): ProtocolValidationIssue[] {
  const issues: ProtocolValidationIssue[] = [];
  const expectedKeys = new Set(expected);

  for (const key of Object.keys(input)) {
    if (!expectedKeys.has(key)) {
      issues.push(issue(code, `${path}.${key}`, `Unknown ${label} property: ${key}.`));
    }
  }

  for (const key of expected) {
    if (!Object.prototype.hasOwnProperty.call(input, key)) {
      issues.push(issue(code, `${path}.${key}`, `Missing ${label} property: ${key}.`));
    }
  }

  return issues;
}

function validateRequestId(input: unknown): ProtocolValidationIssue | undefined {
  if (typeof input !== "string" || input.trim().length === 0) {
    return issue("invalid_message", "$.id", "Request id must be a non-empty string.");
  }

  return undefined;
}

function isJsonValue(input: unknown, ancestors = new Set<object>()): boolean {
  if (input === null || typeof input === "string" || typeof input === "boolean") {
    return true;
  }

  if (typeof input === "number") {
    return Number.isFinite(input);
  }

  if (typeof input !== "object" || ancestors.has(input)) {
    return false;
  }

  const prototype = Object.getPrototypeOf(input);

  if (!Array.isArray(input) && prototype !== Object.prototype && prototype !== null) {
    return false;
  }

  const descriptors = Object.getOwnPropertyDescriptors(input);
  const ownKeys = Reflect.ownKeys(input);

  if (Object.values(descriptors).some((descriptor) => !("value" in descriptor))) {
    return false;
  }

  if (Array.isArray(input)) {
    const enumerableKeys = Object.keys(input);

    if (
      ownKeys.some((key) => typeof key !== "string") ||
      enumerableKeys.length !== input.length ||
      enumerableKeys.some((key, index) => key !== String(index)) ||
      ownKeys.some((key) => key !== "length" && !enumerableKeys.includes(key as string))
    ) {
      return false;
    }
  } else if (
    ownKeys.some((key) => typeof key !== "string") ||
    Object.values(descriptors).some((descriptor) => !descriptor.enumerable)
  ) {
    return false;
  }

  ancestors.add(input);
  const valid = Array.isArray(input)
    ? input.every((value) => isJsonValue(value, ancestors))
    : Object.values(descriptors).every((descriptor) => isJsonValue(descriptor.value, ancestors));
  ancestors.delete(input);
  return valid;
}

function isRecord(input: unknown): input is UnknownRecord {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return false;
  }

  const prototype = Object.getPrototypeOf(input);

  if (prototype !== Object.prototype && prototype !== null) {
    return false;
  }

  const descriptors = Object.getOwnPropertyDescriptors(input);

  return (
    Reflect.ownKeys(input).every((key) => typeof key === "string") &&
    Object.values(descriptors).every((descriptor) => "value" in descriptor && descriptor.enumerable)
  );
}

function issue(code: ProtocolErrorCode, path: string, message: string): ProtocolValidationIssue {
  return { code, path, message };
}

function failure<Value>(
  code: ProtocolErrorCode,
  path: string,
  message: string,
): ProtocolParseResult<Value> {
  return fromIssues(code, message, [issue(code, path, message)]);
}

function fromIssues<Value>(
  code: ProtocolErrorCode,
  message: string,
  issues: ProtocolValidationIssue[],
): ProtocolParseResult<Value> {
  return { ok: false, error: { code, message, issues } };
}
