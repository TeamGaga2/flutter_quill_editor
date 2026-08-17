import { createWindowMessageTransport, type HostTransport } from "@teamgaga/richtext-host-web";

/**
 * Production bootstrap boundary.
 * Flutter adapters inject a transport factory; the runtime never probes multiple globals.
 */
export type ProductionTransportFactory = () => HostTransport;

declare global {
  interface Window {
    __TG_RICHTEXT_CREATE_TRANSPORT__?: ProductionTransportFactory;
  }
}

export function createRuntimeTransport(): HostTransport {
  if (import.meta.env.DEV) {
    return withDevConsoleLogging(createDevWindowTransport());
  }

  const factory = window.__TG_RICHTEXT_CREATE_TRANSPORT__;
  if (typeof factory !== "function") {
    throw new Error(
      "Production Flutter transport is not configured. Inject window.__TG_RICHTEXT_CREATE_TRANSPORT__ before bootstrapping.",
    );
  }

  return factory();
}

/**
 * Standalone browser pages have no Flutter/parent receiver. Outbound messages still go through
 * the transport, but without a peer they would be invisible — log them in dev for manual checks.
 */
function withDevConsoleLogging(transport: HostTransport): HostTransport {
  let readyOutboundCount = 0;

  return {
    send(message) {
      logOutbound(message);
      return transport.send(message);
    },
    subscribe(listener) {
      return transport.subscribe((message) => {
        logInbound(message);
        listener(message);
      });
    },
    destroy() {
      transport.destroy();
    },
  };

  function logOutbound(message: string): void {
    try {
      const parsed = JSON.parse(message) as {
        kind?: string;
        type?: string;
      };

      if (parsed.kind === "event" && parsed.type === "ready") {
        readyOutboundCount += 1;
        console.info(
          `[richtext-host] → outbound ready (#${readyOutboundCount}, expect exactly 1 at startup)`,
          parsed,
        );
        return;
      }

      if (parsed.kind === "event" && (parsed.type === "change" || parsed.type === "state_change")) {
        console.info(`[richtext-host] → outbound ${parsed.type} (from editor input)`, parsed);
        return;
      }

      console.info("[richtext-host] → outbound", parsed);
    } catch {
      console.info("[richtext-host] → outbound", message);
    }
  }
}

function logInbound(message: unknown): void {
  try {
    const parsed = typeof message === "string" ? (JSON.parse(message) as unknown) : message;
    console.info("[richtext-host] ← inbound", parsed);
  } catch {
    console.info("[richtext-host] ← inbound", message);
  }
}

function createDevWindowTransport(): HostTransport {
  const params = new URLSearchParams(window.location.search);
  const targetOrigin = params.get("targetOrigin") ?? window.location.origin;
  const allowedOrigin = params.get("allowedOrigin") ?? window.location.origin;

  // Parent frame when embedded; otherwise self for same-window harnesses.
  const targetWindow = window.parent !== window ? window.parent : window;

  return createWindowMessageTransport({
    listenWindow: window,
    targetWindow,
    targetOrigin,
    allowedOrigin,
  });
}
