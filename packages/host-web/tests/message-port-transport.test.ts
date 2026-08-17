import { describe, expect, it, vi } from "vite-plus/test";
import {
  HOST_ENVELOPE_VERSION,
  decodeHostEnvelope,
  encodeHostControlEnvelope,
  encodeProtocolEnvelope,
} from "../src/bridge/host-envelope";
import { createMessagePortBridge } from "../src/bridge/message-port-transport";
import {
  encodeSurfaceReady,
  isInitializeHandshakeMessage,
  isSurfaceReadyMessage,
} from "../src/bridge/iframe-handshake";

describe("host envelope", () => {
  it("round-trips protocol and host-control envelopes with token validation", () => {
    const protocol = encodeProtocolEnvelope("tok-a", '{"kind":"event","type":"ready"}');
    const decodedProtocol = decodeHostEnvelope(protocol, "tok-a");
    expect(decodedProtocol.ok).toBe(true);
    if (decodedProtocol.ok) {
      expect(decodedProtocol.envelope.plane).toBe("protocol");
      expect(decodedProtocol.envelope.payload).toBe('{"kind":"event","type":"ready"}');
    }

    const control = encodeHostControlEnvelope("tok-a", {
      type: "setInteractionBlocked",
      blocked: true,
    });
    const decodedControl = decodeHostEnvelope(control, "tok-a");
    expect(decodedControl.ok).toBe(true);
    if (decodedControl.ok) {
      expect(decodedControl.envelope.plane).toBe("host-control");
      expect(decodedControl.envelope.payload).toEqual({
        type: "setInteractionBlocked",
        blocked: true,
      });
    }

    expect(decodeHostEnvelope(protocol, "wrong").ok).toBe(false);
    expect(HOST_ENVELOPE_VERSION).toBe(1);
  });

  it("rejects unknown host-control operations", () => {
    const result = decodeHostEnvelope(
      {
        namespace: "tg.richtext.host",
        version: 1,
        plane: "host-control",
        token: "tok-a",
        payload: { type: "eval", source: "alert(1)" },
      },
      "tok-a",
    );
    expect(result.ok).toBe(false);
  });
});

describe("iframe handshake helpers", () => {
  it("encodes and recognizes surfaceReady / initialize messages", () => {
    const ready = encodeSurfaceReady({
      protocolVersion: 1,
      hostEnvelopeVersion: 1,
      buildId: "build-1",
    });
    expect(isSurfaceReadyMessage(ready)).toBe(true);
    expect(
      isInitializeHandshakeMessage({
        namespace: "tg.richtext.iframe.handshake",
        version: 1,
        type: "initialize",
        token: "cap",
        config: { toolbarMode: "none" },
      }),
    ).toBe(true);
    expect(isInitializeHandshakeMessage({ type: "initialize" })).toBe(false);
  });
});

describe("MessagePort bridge", () => {
  it("moves protocol strings and host-control operations over the port", async () => {
    const channel = new MessageChannel();
    const onHostControl = vi.fn();
    const child = createMessagePortBridge({
      port: channel.port1,
      token: "tok-a",
      onHostControl,
    });
    const parent = createMessagePortBridge({
      port: channel.port2,
      token: "tok-a",
    });

    const inbound = vi.fn();
    child.transport.subscribe(inbound);

    void parent.transport.send('{"kind":"command","type":"get_snapshot"}');
    await vi.waitFor(() => {
      expect(inbound).toHaveBeenCalledWith('{"kind":"command","type":"get_snapshot"}');
    });

    parent.sendHostControl({ type: "wakeEditingSession", keepTitle: true });
    await vi.waitFor(() => {
      expect(onHostControl).toHaveBeenCalledWith({
        type: "wakeEditingSession",
        keepTitle: true,
      });
    });

    child.destroy();
    parent.destroy();
    expect(() => parent.transport.send("late")).toThrow("MessagePort bridge has been destroyed.");
  });

  it("ignores envelopes with the wrong capability token", async () => {
    const channel = new MessageChannel();
    const child = createMessagePortBridge({
      port: channel.port1,
      token: "tok-a",
    });
    const inbound = vi.fn();
    child.transport.subscribe(inbound);

    channel.port2.start();
    channel.port2.postMessage(
      encodeProtocolEnvelope("tok-other", '{"kind":"command","type":"focus"}'),
    );
    await Promise.resolve();
    expect(inbound).not.toHaveBeenCalled();
    child.destroy();
    channel.port2.close();
  });
});
