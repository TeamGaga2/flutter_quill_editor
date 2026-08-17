import { describe, expect, it, vi } from "vite-plus/test";
import { createCallbackTransport } from "../src/bridge/callback-transport";
import { createMemoryTransport } from "../src/bridge/memory-transport";
import { createWindowMessageTransport } from "../src/bridge/window-message-transport";

describe("Host transports", () => {
  it("moves messages through the callback transport without Flutter-specific APIs", () => {
    const post = vi.fn();
    const transport = createCallbackTransport({ send: post });
    const listener = vi.fn();
    const unsubscribe = transport.subscribe(listener);

    void transport.send('{"kind":"event","type":"ready"}');
    expect(post).toHaveBeenCalledWith('{"kind":"event","type":"ready"}');

    transport.deliver('{"kind":"command","type":"get_snapshot"}');
    expect(listener).toHaveBeenCalledWith('{"kind":"command","type":"get_snapshot"}');

    unsubscribe();
    transport.deliver("ignored");
    expect(listener).toHaveBeenCalledTimes(1);

    transport.destroy();
    transport.destroy();
    transport.deliver("after destroy");
    expect(listener).toHaveBeenCalledTimes(1);
    expect(() => transport.send("late")).toThrow("Callback transport has been destroyed.");
  });

  it("rejects createCallbackTransport without a send function", () => {
    expect(() =>
      createCallbackTransport({ send: undefined as unknown as (message: string) => void }),
    ).toThrow("createCallbackTransport requires a send function.");
  });

  it("moves messages through the memory transport and cleans up idempotently", () => {
    const transport = createMemoryTransport();
    const listener = vi.fn();
    const unsubscribe = transport.subscribe(listener);

    transport.receive({ command: true });
    void transport.send("response");

    expect(listener).toHaveBeenCalledWith({ command: true });
    expect(transport.sent).toEqual(["response"]);

    unsubscribe();
    transport.receive("ignored");
    expect(listener).toHaveBeenCalledTimes(1);

    transport.destroy();
    transport.destroy();
    expect(() => transport.send("late")).toThrow("Memory transport has been destroyed.");
    expect(() => transport.receive("late")).toThrow("Memory transport has been destroyed.");
  });

  it("rejects wildcard origins", () => {
    const windowLike = {
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      postMessage: vi.fn(),
    } as unknown as Window;

    expect(() =>
      createWindowMessageTransport({
        listenWindow: windowLike,
        targetWindow: windowLike,
        targetOrigin: "*",
        allowedOrigin: "https://app.teamgaga.com",
      }),
    ).toThrow("Window message transport requires explicit origins.");
    expect(() =>
      createWindowMessageTransport({
        listenWindow: windowLike,
        targetWindow: windowLike,
        targetOrigin: "https://app.teamgaga.com",
        allowedOrigin: "*",
      }),
    ).toThrow("Window message transport requires explicit origins.");
  });

  it("filters window messages by origin and removes the listener", () => {
    let messageHandler: ((event: MessageEvent<unknown>) => void) | undefined;
    const addEventListener = vi.fn(
      (_type: string, handler: (event: MessageEvent<unknown>) => void) => {
        messageHandler = handler;
      },
    );
    const removeEventListener = vi.fn();
    const postMessage = vi.fn();
    const targetWindow = { postMessage } as unknown as Window;
    const transport = createWindowMessageTransport({
      listenWindow: { addEventListener, removeEventListener } as unknown as Window,
      targetWindow,
      targetOrigin: "https://app.teamgaga.com",
      allowedOrigin: "https://app.teamgaga.com",
    });
    const listener = vi.fn();
    transport.subscribe(listener);

    messageHandler?.({
      origin: "https://attacker.example",
      source: targetWindow,
      data: "blocked",
    } as MessageEvent);
    messageHandler?.({
      origin: "https://app.teamgaga.com",
      source: {} as Window,
      data: "blocked source",
    } as MessageEvent);
    messageHandler?.({
      origin: "https://app.teamgaga.com",
      source: targetWindow,
      data: "accepted",
    } as MessageEvent);
    void transport.send("outbound");

    expect(listener).toHaveBeenCalledOnce();
    expect(listener).toHaveBeenCalledWith("accepted");
    expect(postMessage).toHaveBeenCalledWith("outbound", "https://app.teamgaga.com");

    transport.destroy();
    transport.destroy();
    expect(removeEventListener).toHaveBeenCalledOnce();
    expect(() => transport.subscribe(listener)).toThrow(
      "Window message transport has been destroyed.",
    );
  });

  it("does not re-deliver same-window outbound messages as inbound", () => {
    let messageHandler: ((event: MessageEvent<unknown>) => void) | undefined;
    const addEventListener = vi.fn(
      (_type: string, handler: (event: MessageEvent<unknown>) => void) => {
        messageHandler = handler;
      },
    );
    const removeEventListener = vi.fn();
    const windowLike = {
      addEventListener,
      removeEventListener,
      postMessage(data: unknown, _origin: string) {
        // Same-window postMessage re-delivers to the local handler.
        messageHandler?.({
          origin: "https://app.teamgaga.com",
          source: windowLike,
          data,
        } as MessageEvent);
      },
    } as unknown as Window;

    const transport = createWindowMessageTransport({
      listenWindow: windowLike,
      targetWindow: windowLike,
      targetOrigin: "https://app.teamgaga.com",
      allowedOrigin: "https://app.teamgaga.com",
    });
    const listener = vi.fn();
    transport.subscribe(listener);

    void transport.send(
      JSON.stringify({
        version: 1,
        kind: "event",
        type: "ready",
        payload: { protocol_version: 1 },
      }),
    );

    // Outbound self-echo is suppressed.
    expect(listener).not.toHaveBeenCalled();

    // Genuine inbound command strings still deliver.
    messageHandler?.({
      origin: "https://app.teamgaga.com",
      source: windowLike,
      data: JSON.stringify({
        version: 1,
        kind: "command",
        id: "from-console",
        type: "undo",
        payload: {},
      }),
    } as MessageEvent);

    expect(listener).toHaveBeenCalledOnce();
    expect(String(listener.mock.calls[0]?.[0] ?? "")).toContain("from-console");

    transport.destroy();
  });
});
