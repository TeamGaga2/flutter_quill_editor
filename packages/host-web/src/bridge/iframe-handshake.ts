/**
 * Window.postMessage handshake used before a MessagePort is transferred.
 * These messages are NOT host-envelope frames (ADR-0005 / ADR-0006).
 */

export const IFRAME_HANDSHAKE_NAMESPACE = "tg.richtext.iframe.handshake" as const;
export const IFRAME_HANDSHAKE_VERSION = 1 as const;

export interface SurfaceReadyMessage {
  namespace: typeof IFRAME_HANDSHAKE_NAMESPACE;
  version: typeof IFRAME_HANDSHAKE_VERSION;
  type: "surfaceReady";
  protocolVersion: number;
  hostEnvelopeVersion: number;
  buildId: string;
}

export interface InitializeHandshakeMessage {
  namespace: typeof IFRAME_HANDSHAKE_NAMESPACE;
  version: typeof IFRAME_HANDSHAKE_VERSION;
  type: "initialize";
  token: string;
  config: Record<string, unknown>;
}

export function encodeSurfaceReady(identity: {
  protocolVersion: number;
  hostEnvelopeVersion: number;
  buildId: string;
}): SurfaceReadyMessage {
  return {
    namespace: IFRAME_HANDSHAKE_NAMESPACE,
    version: IFRAME_HANDSHAKE_VERSION,
    type: "surfaceReady",
    protocolVersion: identity.protocolVersion,
    hostEnvelopeVersion: identity.hostEnvelopeVersion,
    buildId: identity.buildId,
  };
}

export function isSurfaceReadyMessage(data: unknown): data is SurfaceReadyMessage {
  if (data === null || typeof data !== "object") return false;
  const record = data as Record<string, unknown>;
  return (
    record.namespace === IFRAME_HANDSHAKE_NAMESPACE &&
    record.version === IFRAME_HANDSHAKE_VERSION &&
    record.type === "surfaceReady" &&
    typeof record.protocolVersion === "number" &&
    typeof record.hostEnvelopeVersion === "number" &&
    typeof record.buildId === "string"
  );
}

export function isInitializeHandshakeMessage(data: unknown): data is InitializeHandshakeMessage {
  if (data === null || typeof data !== "object") return false;
  const record = data as Record<string, unknown>;
  return (
    record.namespace === IFRAME_HANDSHAKE_NAMESPACE &&
    record.version === IFRAME_HANDSHAKE_VERSION &&
    record.type === "initialize" &&
    typeof record.token === "string" &&
    record.token.length > 0 &&
    record.config !== null &&
    typeof record.config === "object"
  );
}
