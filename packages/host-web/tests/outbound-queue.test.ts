import { describe, expect, it, vi } from "vite-plus/test";
import type { HostTransport } from "../src/bridge/transport";
import { createOutboundQueue } from "../src/lifecycle/outbound-queue";

function createDeferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("outbound queue", () => {
  it("sends sync messages in order", () => {
    const sent: string[] = [];
    const transport: HostTransport = {
      send(message) {
        sent.push(message);
      },
      subscribe: () => () => undefined,
      destroy() {},
    };
    const onError = vi.fn();
    const queue = createOutboundQueue(transport, onError);

    queue.enqueue("a");
    queue.enqueue("b");
    queue.enqueue("c");

    expect(sent).toEqual(["a", "b", "c"]);
    expect(onError).not.toHaveBeenCalled();
  });

  it("preserves order with async transport", async () => {
    const order: string[] = [];
    const gates = [createDeferred(), createDeferred(), createDeferred()];
    let index = 0;
    const transport: HostTransport = {
      send(message) {
        const gate = gates[index++]!;
        return gate.promise.then(() => {
          order.push(message);
        });
      },
      subscribe: () => () => undefined,
      destroy() {},
    };
    const queue = createOutboundQueue(transport, vi.fn());

    queue.enqueue("first");
    queue.enqueue("second");
    queue.enqueue("third");

    expect(order).toEqual([]);
    gates[0]!.resolve();
    await vi.waitFor(() => {
      expect(order).toEqual(["first"]);
    });

    // Resolve third before second — queue must still preserve enqueue order.
    gates[2]!.resolve();
    gates[1]!.resolve();
    await vi.waitFor(() => {
      expect(order).toEqual(["first", "second", "third"]);
    });
  });

  it("continues after send throw and reject", async () => {
    const sent: string[] = [];
    let call = 0;
    const transport: HostTransport = {
      send(message) {
        call += 1;
        if (call === 1) {
          throw new Error("sync fail");
        }
        if (call === 2) {
          return Promise.reject(new Error("async fail"));
        }
        sent.push(message);
      },
      subscribe: () => () => undefined,
      destroy() {},
    };
    const onError = vi.fn();
    const queue = createOutboundQueue(transport, onError);

    queue.enqueue("a");
    queue.enqueue("b");
    queue.enqueue("c");

    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(sent).toEqual(["c"]);
    expect(onError).toHaveBeenCalledTimes(2);
  });

  it("discards pending on close and absorbs in-flight", async () => {
    const gate = createDeferred();
    const sent: string[] = [];
    let unhandled = 0;
    const onUnhandled = (): void => {
      unhandled += 1;
    };
    process.on("unhandledRejection", onUnhandled);

    try {
      const transport: HostTransport = {
        send(message) {
          if (message === "in-flight") {
            return gate.promise.then(() => {
              sent.push(message);
            });
          }
          sent.push(message);
        },
        subscribe: () => () => undefined,
        destroy() {},
      };
      const queue = createOutboundQueue(transport, vi.fn());

      queue.enqueue("in-flight");
      queue.enqueue("pending-1");
      queue.enqueue("pending-2");
      queue.close();
      queue.enqueue("after-close");

      gate.resolve();
      await Promise.resolve();
      await Promise.resolve();

      expect(sent).toEqual(["in-flight"]);
      expect(unhandled).toBe(0);
    } finally {
      process.off("unhandledRejection", onUnhandled);
    }
  });
});
