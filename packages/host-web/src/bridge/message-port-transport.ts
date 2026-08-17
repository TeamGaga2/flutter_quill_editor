import {
  decodeHostEnvelope,
  encodeHostControlEnvelope,
  encodeProtocolEnvelope,
  type HostControlOperation,
} from "./host-envelope";
import type { HostTransport } from "./transport";

export interface MessagePortBridgeOptions {
  port: MessagePort;
  token: string;
  onHostControl?: (operation: HostControlOperation) => void;
}

export interface MessagePortBridge {
  /** Protocol-plane transport for createRichTextHost. */
  transport: HostTransport;
  sendHostControl(operation: HostControlOperation): void;
  destroy(): void;
}

/**
 * Dual-plane MessagePort bridge used by the Flutter Web iframe host.
 *
 * Protocol plane payloads are unchanged protocol JSON strings.
 * Host-control plane carries typed embedding/lifecycle operations.
 */
export function createMessagePortBridge(options: MessagePortBridgeOptions): MessagePortBridge {
  const { port, token } = options;
  const listeners = new Set<(message: unknown) => void>();
  let destroyed = false;

  const handleMessage = (event: MessageEvent<unknown>): void => {
    if (destroyed) return;
    const decoded = decodeHostEnvelope(event.data, token);
    if (!decoded.ok) {
      return;
    }

    if (decoded.envelope.plane === "protocol") {
      for (const listener of listeners) {
        listener(decoded.envelope.payload);
      }
      return;
    }

    options.onHostControl?.(decoded.envelope.payload as HostControlOperation);
  };

  port.addEventListener("message", handleMessage);
  port.start();

  const transport: HostTransport = {
    send(message) {
      if (destroyed) {
        throw new Error("MessagePort bridge has been destroyed.");
      }
      port.postMessage(encodeProtocolEnvelope(token, message));
    },
    subscribe(listener) {
      if (destroyed) {
        throw new Error("MessagePort bridge has been destroyed.");
      }
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    destroy() {
      destroyBridge();
    },
  };

  function sendHostControl(operation: HostControlOperation): void {
    if (destroyed) {
      throw new Error("MessagePort bridge has been destroyed.");
    }
    port.postMessage(encodeHostControlEnvelope(token, operation));
  }

  function destroyBridge(): void {
    if (destroyed) return;
    destroyed = true;
    port.removeEventListener("message", handleMessage);
    listeners.clear();
    try {
      port.close();
    } catch {
      // Ignore close races during dispose/retry.
    }
  }

  return {
    transport,
    sendHostControl,
    destroy: destroyBridge,
  };
}
