import type { HostTransport } from "./transport";

export interface CallbackTransportOptions {
  /**
   * Deliver an outbound Protocol JSON string to the native host
   * (e.g. `TgRichTextBridge.postMessage(message)`).
   */
  send(message: string): void | Promise<void>;
}

/**
 * Transport driven by an external send callback and an explicit `deliver()`
 * for inbound messages. Plugin-agnostic: does not hardcode Flutter channel APIs.
 *
 * Typical Flutter inject (see `apps/webview-runtime/scripts/flutter-inject-template.js`)
 * reimplements this shape inline so the factory can run before ESM loads.
 */
export interface CallbackTransport extends HostTransport {
  /** Host → Web: fan-out a raw Protocol message string (or already-parsed value). */
  deliver(message: unknown): void;
}

export function createCallbackTransport(options: CallbackTransportOptions): CallbackTransport {
  if (typeof options.send !== "function") {
    throw new Error("createCallbackTransport requires a send function.");
  }

  const listeners = new Set<(message: unknown) => void>();
  let destroyed = false;

  return {
    send(message) {
      if (destroyed) {
        throw new Error("Callback transport has been destroyed.");
      }

      return options.send(message);
    },

    deliver(message) {
      if (destroyed) {
        return;
      }

      for (const listener of listeners) {
        listener(message);
      }
    },

    subscribe(listener) {
      if (destroyed) {
        throw new Error("Callback transport has been destroyed.");
      }

      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },

    destroy() {
      destroyed = true;
      listeners.clear();
    },
  };
}
