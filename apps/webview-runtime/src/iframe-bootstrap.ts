import {
  HOST_ENVELOPE_VERSION,
  createMessagePortBridge,
  encodeSurfaceReady,
  isInitializeHandshakeMessage,
} from "@teamgaga/richtext-host-web";
import { PROTOCOL_VERSION } from "@teamgaga/richtext-protocol";
import {
  resolveRuntimeConfig,
  type InjectedRuntimeConfig,
  type RuntimeConfig,
} from "./runtime-config";

declare const __TG_RUNTIME_BUILD_ID__: string;

/**
 * Flutter Web iframe entry bootstrap.
 *
 * 1. Announce surfaceReady (no editor mount yet)
 * 2. Wait for one-shot initialize + transferable MessagePort
 * 3. Dynamically import and mount the shared editor
 */
function parentOrigin(): string {
  return window.location.origin;
}

function announceSurfaceReady(): void {
  const message = encodeSurfaceReady({
    protocolVersion: PROTOCOL_VERSION,
    hostEnvelopeVersion: HOST_ENVELOPE_VERSION,
    buildId: __TG_RUNTIME_BUILD_ID__,
  });
  window.parent.postMessage(message, parentOrigin());
}

function mergeInitializeConfig(raw: Record<string, unknown>): RuntimeConfig {
  window.__TG_RICHTEXT_CONFIG__ = raw as InjectedRuntimeConfig;
  return resolveRuntimeConfig();
}

function listenForInitialize(): void {
  let accepted = false;

  const onMessage = (event: MessageEvent<unknown>): void => {
    if (accepted) return;
    if (event.origin !== parentOrigin()) return;
    if (event.source !== window.parent) return;
    if (!isInitializeHandshakeMessage(event.data)) return;

    const handshake = event.data;
    const port = event.ports[0];
    if (!port) {
      return;
    }

    accepted = true;
    window.removeEventListener("message", onMessage);

    const token = handshake.token;
    const config = mergeInitializeConfig(handshake.config);

    void (async () => {
      const { mountEditor } = await import("./mount-editor");
      let mounted: Awaited<ReturnType<typeof mountEditor>> | null = null;
      const bridge = createMessagePortBridge({
        port,
        token,
        onHostControl: (operation) => {
          mounted?.applyHostControl(operation);
        },
      });

      mounted = await mountEditor({
        config,
        transport: bridge.transport,
      });

      bridge.sendHostControl({ type: "initializeAck" });
    })().catch((error: unknown) => {
      const message = error instanceof Error ? error.message : "iframe initialize failed";
      const app = document.querySelector("#app");
      if (app) {
        app.textContent = message;
      }
      console.error(message);
    });
  };

  window.addEventListener("message", onMessage);
}

// Install initialize listener before announcing surfaceReady so a fast parent
// cannot miss the handshake window.
listenForInitialize();
announceSurfaceReady();
