import { describe, expect, it } from "vite-plus/test";
import { encodeProtocolMessage, PROTOCOL_VERSION } from "@teamgaga/richtext-protocol";
import { extractSafeRequestId, processInboundMessage } from "../src/bridge/inbound-message";

describe("inbound message processing", () => {
  it("accepts a valid JSON command string", () => {
    const command = {
      version: PROTOCOL_VERSION,
      kind: "command" as const,
      id: "cmd-1",
      type: "get_snapshot" as const,
      payload: {},
    };
    const raw = encodeProtocolMessage(command);
    const result = processInboundMessage(raw);

    expect(result.kind).toBe("command");
    if (result.kind === "command") {
      expect(result.command.id).toBe("cmd-1");
      expect(result.command.type).toBe("get_snapshot");
    }
  });

  it("rejects non-string input without a response", () => {
    const result = processInboundMessage({ kind: "command", id: "x" });
    expect(result.kind).toBe("ignored");
    if (result.kind === "ignored") {
      expect(result.error.code).toBe("invalid_message");
    }
  });

  it("rejects invalid JSON without a response", () => {
    const result = processInboundMessage("{not-json");
    expect(result.kind).toBe("ignored");
    if (result.kind === "ignored") {
      expect(result.error.code).toBe("invalid_json");
    }
  });

  it("does not reply to inbound event or response messages", () => {
    const event = encodeProtocolMessage({
      version: PROTOCOL_VERSION,
      kind: "event",
      type: "focus",
      payload: {},
    });
    const response = encodeProtocolMessage({
      version: PROTOCOL_VERSION,
      kind: "response",
      id: "r1",
      type: "get_snapshot",
      ok: true,
      value: { snapshot: { content: [{ insert: "\n" }] } },
    });

    expect(processInboundMessage(event).kind).toBe("ignored");
    expect(processInboundMessage(response).kind).toBe("ignored");
  });

  it("returns a correlated validation failure when id is safe", () => {
    const raw = JSON.stringify({
      version: PROTOCOL_VERSION,
      kind: "command",
      id: "bad-payload",
      type: "toggle_inline_format",
      payload: { format: "not-a-format" },
    });
    const result = processInboundMessage(raw);

    expect(result.kind).toBe("validation_failure");
    if (result.kind === "validation_failure") {
      expect(result.response.id).toBe("bad-payload");
      expect(result.response.ok).toBe(false);
    }
  });

  it("ignores missing or unsafe ids", () => {
    expect(extractSafeRequestId({ kind: "command" })).toBeUndefined();
    expect(extractSafeRequestId({ kind: "command", id: "" })).toBeUndefined();
    expect(extractSafeRequestId({ kind: "command", id: "has space" })).toBeUndefined();
    expect(extractSafeRequestId({ kind: "event", id: "cmd-1" })).toBeUndefined();
    expect(extractSafeRequestId("cmd-1")).toBeUndefined();

    const missingId = JSON.stringify({
      version: PROTOCOL_VERSION,
      kind: "command",
      type: "get_snapshot",
      payload: {},
    });
    expect(processInboundMessage(missingId).kind).toBe("ignored");
  });

  it("keeps processing after consecutive illegal messages", () => {
    processInboundMessage(42);
    processInboundMessage("{bad");
    processInboundMessage(
      encodeProtocolMessage({
        version: PROTOCOL_VERSION,
        kind: "event",
        type: "blur",
        payload: {},
      }),
    );

    const ok = processInboundMessage(
      encodeProtocolMessage({
        version: PROTOCOL_VERSION,
        kind: "command",
        id: "after-bad",
        type: "undo",
        payload: {},
      }),
    );
    expect(ok.kind).toBe("command");
  });
});
