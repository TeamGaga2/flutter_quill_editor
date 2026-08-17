import {
  decodeProtocolMessage,
  PROTOCOL_VERSION,
  type EditorCommandMessage,
  type EditorResponseMessage,
  type ProtocolErrorCode,
} from "@teamgaga/richtext-protocol";
import { createHostError, type RichTextHostError } from "../errors";

export type InboundMessageResult =
  | { kind: "command"; command: EditorCommandMessage }
  | { kind: "validation_failure"; response: EditorResponseMessage; error: RichTextHostError }
  | { kind: "ignored"; error: RichTextHostError };

const REQUEST_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;

/**
 * Safely extract a request id only when the raw payload is clearly a command-shaped
 * object with a trustworthy string id. Never used for event/response replies.
 */
export function extractSafeRequestId(input: unknown): string | undefined {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return undefined;
  }

  const record = input as Record<string, unknown>;
  if (record.kind !== "command") {
    return undefined;
  }

  if (typeof record.id !== "string" || !REQUEST_ID_PATTERN.test(record.id)) {
    return undefined;
  }

  return record.id;
}

export function processInboundMessage(raw: unknown): InboundMessageResult {
  if (typeof raw !== "string") {
    return {
      kind: "ignored",
      error: createHostError("decode", "invalid_message", "Inbound message must be a JSON string."),
    };
  }

  const decoded = decodeProtocolMessage(raw);

  if (!decoded.ok) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw) as unknown;
    } catch {
      parsed = undefined;
    }

    const requestId = extractSafeRequestId(parsed);
    const code = decoded.error.code;
    const message = decoded.error.message;
    const hostError = createHostError("decode", code, message);

    if (requestId !== undefined) {
      return {
        kind: "validation_failure",
        response: failureResponse(requestId, code, message),
        error: hostError,
      };
    }

    return { kind: "ignored", error: hostError };
  }

  const message = decoded.value;

  if (message.kind === "command") {
    return { kind: "command", command: message };
  }

  // event / response arriving inbound: report only, never reply (no response loop).
  return {
    kind: "ignored",
    error: createHostError(
      "decode",
      "invalid_message",
      message.kind === "event"
        ? "Inbound event messages are not accepted."
        : "Inbound response messages are not accepted.",
    ),
  };
}

export function createEditorNotReadyResponse(requestId: string): EditorResponseMessage {
  return failureResponse(requestId, "editor_not_ready", "Editor is not ready.");
}

function failureResponse(
  id: string,
  code: ProtocolErrorCode,
  message: string,
): EditorResponseMessage {
  return {
    version: PROTOCOL_VERSION,
    kind: "response",
    id,
    ok: false,
    error: {
      code,
      message,
    },
  };
}
