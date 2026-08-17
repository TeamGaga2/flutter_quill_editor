export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | { [key: string]: JsonValue } | JsonValue[];

export type ProtocolErrorCode =
  | "invalid_json"
  | "invalid_message"
  | "unsupported_version"
  | "unsupported_command"
  | "invalid_payload"
  | "editor_not_ready"
  | "command_failed";

export interface ProtocolValidationIssue {
  code: ProtocolErrorCode;
  path: string;
  message: string;
}

export interface ProtocolParseError {
  code: ProtocolErrorCode;
  message: string;
  issues: readonly ProtocolValidationIssue[];
}

export type ProtocolParseResult<Value> =
  | { ok: true; value: Value }
  | { ok: false; error: ProtocolParseError };
