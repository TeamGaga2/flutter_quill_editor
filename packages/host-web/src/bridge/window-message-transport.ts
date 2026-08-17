import type { HostTransport } from "./transport";

export interface WindowMessageTransportOptions {
  listenWindow: Window;
  targetWindow: Window;
  targetOrigin: string;
  allowedOrigin: string;
}

/**
 * Same-window postMessage always re-delivers to the sender. Outbound protocol
 * strings (ready/events/responses) must not re-enter Host as inbound messages.
 */
const SELF_OUTBOUND_MARKER = "__tg_richtext_window_transport_outbound__";

export function createWindowMessageTransport(
  options: WindowMessageTransportOptions,
): HostTransport {
  if (options.targetOrigin === "*" || options.allowedOrigin === "*") {
    throw new Error("Window message transport requires explicit origins.");
  }

  const selfTargeted = options.listenWindow === options.targetWindow;
  const listeners = new Set<(message: unknown) => void>();
  let destroyed = false;

  const handleMessage = (event: MessageEvent<unknown>): void => {
    if (event.origin !== options.allowedOrigin || event.source !== options.targetWindow) {
      return;
    }

    // Drop the echo of our own outbound when listen and target are the same window.
    if (selfTargeted && isSelfOutboundEcho(event.data)) {
      return;
    }

    for (const listener of listeners) {
      listener(event.data);
    }
  };

  options.listenWindow.addEventListener("message", handleMessage);

  return {
    send(message) {
      if (destroyed) {
        throw new Error("Window message transport has been destroyed.");
      }

      if (selfTargeted) {
        options.targetWindow.postMessage(
          { [SELF_OUTBOUND_MARKER]: true as const, payload: message },
          options.targetOrigin,
        );
        return;
      }

      options.targetWindow.postMessage(message, options.targetOrigin);
    },

    subscribe(listener) {
      if (destroyed) {
        throw new Error("Window message transport has been destroyed.");
      }

      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    destroy() {
      if (destroyed) {
        return;
      }

      destroyed = true;
      options.listenWindow.removeEventListener("message", handleMessage);
      listeners.clear();
    },
  };
}

function isSelfOutboundEcho(data: unknown): boolean {
  return (
    typeof data === "object" &&
    data !== null &&
    (data as Record<string, unknown>)[SELF_OUTBOUND_MARKER] === true
  );
}
