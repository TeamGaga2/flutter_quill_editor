import type { JsonValue, ProtocolErrorCode } from "./errors";
import type { ProtocolVersion } from "./version";

export interface ProtocolCommand<Type extends string, Payload> {
  version: ProtocolVersion;
  kind: "command";
  id: string;
  type: Type;
  payload: Payload;
}

export interface ProtocolSuccess<Type extends string, Value> {
  version: ProtocolVersion;
  kind: "response";
  id: string;
  type: Type;
  ok: true;
  value: Value;
}

export interface ProtocolFailure<Details extends JsonValue = JsonValue> {
  version: ProtocolVersion;
  kind: "response";
  id: string;
  ok: false;
  error: {
    code: ProtocolErrorCode;
    message: string;
    details?: Details;
  };
}

export interface ProtocolEvent<Type extends string, Payload> {
  version: ProtocolVersion;
  kind: "event";
  type: Type;
  payload: Payload;
}
