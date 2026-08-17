import { describe, expect, it } from "vite-plus/test";
import fixtures from "../fixtures/v1.json";
import {
  decodeProtocolMessage,
  encodeProtocolMessage,
  type ProtocolMessage,
} from "../src/index.ts";

const fixtureMessages = [
  ...fixtures.commands,
  ...fixtures.events,
  ...fixtures.responses,
] as unknown as ProtocolMessage[];

describe("protocol JSON codec", () => {
  it("decodes every shared TS/Dart golden fixture", () => {
    for (const message of fixtureMessages) {
      expect(decodeProtocolMessage(JSON.stringify(message))).toEqual({ ok: true, value: message });
    }
  });

  it("round-trips every protocol message", () => {
    for (const message of fixtureMessages) {
      const encoded = encodeProtocolMessage(message);
      expect(decodeProtocolMessage(encoded)).toEqual({ ok: true, value: message });
    }
  });

  it("returns a structured error for invalid JSON", () => {
    const result = decodeProtocolMessage("{not-json");

    expect(result.ok).toBe(false);

    if (!result.ok) {
      expect(result.error.code).toBe("invalid_json");
      expect(result.error.issues).toEqual([
        {
          code: "invalid_json",
          path: "$",
          message: "Protocol message must be valid JSON.",
        },
      ]);
    }
  });

  it("rejects class instances and toJSON overrides before encoding", () => {
    const prototype = {
      toJSON() {
        return { injected: true };
      },
    };
    const message = Object.assign(Object.create(prototype) as Record<string, unknown>, {
      version: 1,
      kind: "command",
      id: "request-1",
      type: "undo",
      payload: {},
    }) as unknown as ProtocolMessage;

    expect(() => encodeProtocolMessage(message)).toThrow("Cannot encode invalid protocol message");
  });

  it("ignores polluted built-in toJSON methods", () => {
    const descriptor = Object.getOwnPropertyDescriptor(Object.prototype, "toJSON");

    try {
      Object.defineProperty(Object.prototype, "toJSON", {
        configurable: true,
        value: () => ({
          version: 1,
          kind: "command",
          id: "injected",
          type: "redo",
          payload: {},
        }),
      });

      const original = fixtureMessages.find(
        (message) => message.kind === "command" && message.type === "undo",
      );

      if (!original) {
        throw new Error("Undo fixture is required.");
      }

      expect(decodeProtocolMessage(encodeProtocolMessage(original))).toEqual({
        ok: true,
        value: original,
      });
    } finally {
      if (descriptor) {
        Object.defineProperty(Object.prototype, "toJSON", descriptor);
      } else {
        Reflect.deleteProperty(Object.prototype, "toJSON");
      }
    }
  });

  it("rejects accessors that could change during serialization", () => {
    const message: Record<string, unknown> = {
      version: 1,
      kind: "command",
      id: "request-1",
      type: "undo",
    };
    Object.defineProperty(message, "payload", {
      enumerable: true,
      get: () => ({}),
    });

    expect(() => encodeProtocolMessage(message as unknown as ProtocolMessage)).toThrow(
      "Cannot encode invalid protocol message",
    );
  });

  it("rejects invalid typed input at runtime before encoding", () => {
    const invalid = {
      version: 1,
      kind: "command",
      id: "request-1",
      type: "undo",
      payload: { unexpected: true },
    } as unknown as ProtocolMessage;

    expect(() => encodeProtocolMessage(invalid)).toThrow(
      "Cannot encode invalid protocol message at $.payload.unexpected",
    );
  });
});
