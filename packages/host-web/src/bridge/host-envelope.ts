/**
 * Host-control / protocol dual-plane envelope carried on a MessagePort.
 *
 * This is intentionally **not** part of `@teamgaga/richtext-protocol`. Protocol
 * plane payloads remain raw protocol JSON strings; host-control uses a closed
 * discriminated union (ADR-0006 / ADR-0014).
 */

export const HOST_ENVELOPE_NAMESPACE = "tg.richtext.host" as const;
export const HOST_ENVELOPE_VERSION = 1 as const;

export type HostMessagePlane = "protocol" | "host-control";

export type HostControlOperation =
  | { type: "initializeAck" }
  | {
      type: "updatePresentation";
      theme?: string;
      shellBackgroundColor?: string;
      titlePlaceholder?: string;
      /** Body editor blank-state placeholder (Quill data-placeholder). */
      placeholder?: string;
    }
  | { type: "setInteractionBlocked"; blocked: boolean }
  | { type: "wakeEditingSession"; keepTitle?: boolean }
  | {
      type: "registerMedia";
      token: string;
      objectUrl: string;
      mimeType?: string;
    }
  | { type: "revokeMedia"; token: string }
  | { type: "dispose" };

export interface HostEnvelope {
  namespace: typeof HOST_ENVELOPE_NAMESPACE;
  version: typeof HOST_ENVELOPE_VERSION;
  plane: HostMessagePlane;
  token: string;
  payload: string | HostControlOperation;
}

export function encodeProtocolEnvelope(token: string, protocolJson: string): HostEnvelope {
  return {
    namespace: HOST_ENVELOPE_NAMESPACE,
    version: HOST_ENVELOPE_VERSION,
    plane: "protocol",
    token,
    payload: protocolJson,
  };
}

export function encodeHostControlEnvelope(
  token: string,
  operation: HostControlOperation,
): HostEnvelope {
  return {
    namespace: HOST_ENVELOPE_NAMESPACE,
    version: HOST_ENVELOPE_VERSION,
    plane: "host-control",
    token,
    payload: operation,
  };
}

export type DecodeHostEnvelopeResult =
  | { ok: true; envelope: HostEnvelope }
  | { ok: false; reason: string };

export function decodeHostEnvelope(data: unknown, expectedToken: string): DecodeHostEnvelopeResult {
  if (data === null || typeof data !== "object") {
    return { ok: false, reason: "envelope must be an object" };
  }

  const record = data as Record<string, unknown>;
  if (record.namespace !== HOST_ENVELOPE_NAMESPACE) {
    return { ok: false, reason: "unknown namespace" };
  }
  if (record.version !== HOST_ENVELOPE_VERSION) {
    return { ok: false, reason: "unsupported envelope version" };
  }
  if (record.plane !== "protocol" && record.plane !== "host-control") {
    return { ok: false, reason: "unknown message plane" };
  }
  if (typeof record.token !== "string" || record.token.length === 0) {
    return { ok: false, reason: "missing capability token" };
  }
  if (record.token !== expectedToken) {
    return { ok: false, reason: "capability token mismatch" };
  }

  if (record.plane === "protocol") {
    if (typeof record.payload !== "string") {
      return { ok: false, reason: "protocol payload must be a JSON string" };
    }
    return {
      ok: true,
      envelope: {
        namespace: HOST_ENVELOPE_NAMESPACE,
        version: HOST_ENVELOPE_VERSION,
        plane: "protocol",
        token: record.token,
        payload: record.payload,
      },
    };
  }

  const operation = decodeHostControlOperation(record.payload);
  if (!operation) {
    return { ok: false, reason: "invalid host-control payload" };
  }

  return {
    ok: true,
    envelope: {
      namespace: HOST_ENVELOPE_NAMESPACE,
      version: HOST_ENVELOPE_VERSION,
      plane: "host-control",
      token: record.token,
      payload: operation,
    },
  };
}

function decodeHostControlOperation(payload: unknown): HostControlOperation | null {
  if (payload === null || typeof payload !== "object") {
    return null;
  }
  const record = payload as Record<string, unknown>;
  const type = record.type;
  switch (type) {
    case "initializeAck":
      return { type: "initializeAck" };
    case "updatePresentation": {
      return {
        type: "updatePresentation",
        ...(typeof record.theme === "string" ? { theme: record.theme } : {}),
        ...(typeof record.shellBackgroundColor === "string"
          ? { shellBackgroundColor: record.shellBackgroundColor }
          : {}),
        ...(typeof record.titlePlaceholder === "string"
          ? { titlePlaceholder: record.titlePlaceholder }
          : {}),
        ...(typeof record.placeholder === "string" ? { placeholder: record.placeholder } : {}),
      };
    }
    case "setInteractionBlocked":
      if (typeof record.blocked !== "boolean") return null;
      return { type: "setInteractionBlocked", blocked: record.blocked };
    case "wakeEditingSession":
      return {
        type: "wakeEditingSession",
        keepTitle: typeof record.keepTitle === "boolean" ? record.keepTitle : undefined,
      };
    case "registerMedia":
      if (typeof record.token !== "string" || typeof record.objectUrl !== "string") {
        return null;
      }
      return {
        type: "registerMedia",
        token: record.token,
        objectUrl: record.objectUrl,
        mimeType: typeof record.mimeType === "string" ? record.mimeType : undefined,
      };
    case "revokeMedia":
      if (typeof record.token !== "string") return null;
      return { type: "revokeMedia", token: record.token };
    case "dispose":
      return { type: "dispose" };
    default:
      return null;
  }
}
