export { createCallbackTransport } from "./bridge/callback-transport";
export type { CallbackTransport, CallbackTransportOptions } from "./bridge/callback-transport";
export { createWindowMessageTransport } from "./bridge/window-message-transport";
export type { HostTransport } from "./bridge/transport";
export type { WindowMessageTransportOptions } from "./bridge/window-message-transport";
export {
  HOST_ENVELOPE_NAMESPACE,
  HOST_ENVELOPE_VERSION,
  decodeHostEnvelope,
  encodeHostControlEnvelope,
  encodeProtocolEnvelope,
} from "./bridge/host-envelope";
export type {
  DecodeHostEnvelopeResult,
  HostControlOperation,
  HostEnvelope,
  HostMessagePlane,
} from "./bridge/host-envelope";
export { createMessagePortBridge } from "./bridge/message-port-transport";
export type { MessagePortBridge, MessagePortBridgeOptions } from "./bridge/message-port-transport";
export {
  IFRAME_HANDSHAKE_NAMESPACE,
  IFRAME_HANDSHAKE_VERSION,
  encodeSurfaceReady,
  isInitializeHandshakeMessage,
  isSurfaceReadyMessage,
} from "./bridge/iframe-handshake";
export type { InitializeHandshakeMessage, SurfaceReadyMessage } from "./bridge/iframe-handshake";

export { createRichTextHost } from "./lifecycle/create-host";
export type { CreateRichTextHostOptions, RichTextHost } from "./types";
export type { RichTextHostError, RichTextHostErrorPhase } from "./errors";
export {
  createProtocolRequestCloseEvent,
  createProtocolRequestLinkEvent,
} from "./events/editor-event-bridge";
