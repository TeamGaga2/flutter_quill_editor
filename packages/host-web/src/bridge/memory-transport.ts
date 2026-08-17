import type { HostTransport } from "./transport";

export interface MemoryTransport extends HostTransport {
  readonly sent: readonly string[];
  receive(message: unknown): void;
}

export function createMemoryTransport(): MemoryTransport {
  const listeners = new Set<(message: unknown) => void>();
  const sent: string[] = [];
  let destroyed = false;

  return {
    sent,

    send(message) {
      if (destroyed) {
        throw new Error("Memory transport has been destroyed.");
      }

      sent.push(message);
    },

    receive(message) {
      if (destroyed) {
        throw new Error("Memory transport has been destroyed.");
      }

      for (const listener of listeners) {
        listener(message);
      }
    },

    subscribe(listener) {
      if (destroyed) {
        throw new Error("Memory transport has been destroyed.");
      }

      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    destroy() {
      destroyed = true;
      listeners.clear();
    },
  };
}
