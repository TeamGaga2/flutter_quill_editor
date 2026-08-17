import { describe, expect, it } from "vite-plus/test";
import fixtures from "../fixtures/v1.json";
import { PROTOCOL_VERSION, parseProtocolCommand } from "../src/index.ts";

const base = {
  version: PROTOCOL_VERSION,
  kind: "command",
  id: "request-1",
} as const;

function expectError(input: unknown, code: string, path: string): void {
  const result = parseProtocolCommand(input);

  expect(result.ok).toBe(false);

  if (!result.ok) {
    expect(result.error.code).toBe(code);
    expect(result.error.issues.some((issue) => issue.path === path)).toBe(true);
  }
}

describe("protocol commands", () => {
  it("accepts every v1 command fixture", () => {
    for (const command of fixtures.commands) {
      const result = parseProtocolCommand(command);
      expect(result).toEqual({ ok: true, value: command });
    }
  });

  it("accepts every inline and block format value", () => {
    for (const format of ["bold", "italic", "underline", "strike"]) {
      expect(
        parseProtocolCommand({
          ...base,
          type: "toggle_inline_format",
          payload: { format },
        }).ok,
      ).toBe(true);
    }

    for (const value of [1, 2, 3]) {
      expect(
        parseProtocolCommand({
          ...base,
          type: "toggle_block_format",
          payload: { format: "header", value },
        }).ok,
      ).toBe(true);
    }

    for (const value of ["ordered", "bullet"]) {
      expect(
        parseProtocolCommand({
          ...base,
          type: "toggle_block_format",
          payload: { format: "list", value },
        }).ok,
      ).toBe(true);
    }
  });

  it("rejects invalid envelopes and unsupported commands", () => {
    expectError(
      { ...base, type: "undo", payload: {}, version: 2 },
      "unsupported_version",
      "$.version",
    );
    expectError({ ...base, type: "undo", payload: {}, id: " " }, "invalid_message", "$.id");
    expectError({ ...base, type: "future_command", payload: {} }, "unsupported_command", "$.type");
    expectError({ ...base, type: "undo", payload: {}, extra: true }, "invalid_message", "$.extra");
    expectError(
      { kind: "command", id: "request-1", type: "undo", payload: {} },
      "invalid_message",
      "$.version",
    );
  });

  it("accepts indent, outdent, and get_caret_rect empty payloads", () => {
    for (const type of ["indent", "outdent", "get_caret_rect"] as const) {
      expect(
        parseProtocolCommand({
          ...base,
          type,
          payload: {},
        }).ok,
      ).toBe(true);
    }
  });

  it("strictly validates empty and format payloads", () => {
    expectError(
      { ...base, type: "undo", payload: { extra: true } },
      "invalid_payload",
      "$.payload.extra",
    );
    expectError(
      { ...base, type: "indent", payload: { extra: true } },
      "invalid_payload",
      "$.payload.extra",
    );
    expectError(
      { ...base, type: "get_caret_rect", payload: { x: 1 } },
      "invalid_payload",
      "$.payload.x",
    );
    expectError(
      { ...base, type: "toggle_inline_format", payload: { format: "code" } },
      "invalid_payload",
      "$.payload.format",
    );
    expectError(
      { ...base, type: "toggle_block_format", payload: { format: "header", value: 4 } },
      "invalid_payload",
      "$.payload.value",
    );
    expectError(
      { ...base, type: "toggle_block_format", payload: { format: "blockquote", value: true } },
      "invalid_payload",
      "$.payload.value",
    );
    expectError(
      { ...base, type: "insert_emoji", payload: { id: " " } },
      "invalid_payload",
      "$.payload.id",
    );
  });

  it("accepts insertion commands with optional selection replacement ranges", () => {
    const commands = [
      {
        ...base,
        type: "insert_mention",
        payload: {
          id: "user-1",
          sign: "!",
          displayText: "Alice",
          selection: { start: 2, end: 4 },
        },
      },
      {
        ...base,
        type: "insert_channel",
        payload: { id: "channel-1", displayText: "general" },
      },
      {
        ...base,
        type: "insert_image",
        payload: {
          src: "tgg-local-media://image-token",
          width: "640",
          height: "480",
          mimeType: "image/png",
          fileSize: 12,
        },
      },
      {
        ...base,
        type: "insert_video",
        payload: {
          src: "https://cdn.teamgaga.com/video.mp4",
          width: "1280",
          height: "720",
          mimeType: "video/mp4",
          fileSize: 42,
          poster: "tgg-local-media://poster-token",
          duration: 8,
        },
      },
      {
        ...base,
        type: "insert_link",
        payload: {
          url: "https://teamgaga.com",
          text: "TeamGaga",
          selection: { start: 0, end: 4 },
        },
      },
      {
        ...base,
        type: "insert_divider",
        payload: { selection: { start: 4, end: 4 } },
      },
    ] as const;

    for (const command of commands) {
      expect(parseProtocolCommand(command)).toEqual({ ok: true, value: command });
    }
  });

  it("accepts a minimal insert_video payload without optional metadata", () => {
    const command = {
      ...base,
      type: "insert_video",
      payload: {
        src: "tgg-local-media://video-token",
        width: "1280",
        height: "720",
        mimeType: "video/mp4",
        fileSize: 42,
      },
    } as const;

    expect(parseProtocolCommand(command)).toEqual({ ok: true, value: command });
  });

  it("rejects invalid insertion payloads without accepting local path leakage", () => {
    const invalid = [
      { ...base, type: "insert_mention", payload: { id: "u", sign: "!", displayText: "" } },
      {
        ...base,
        type: "insert_channel",
        payload: { id: "c", displayText: "general", selection: { start: 3, end: 2 } },
      },
      {
        ...base,
        type: "insert_image",
        payload: {
          src: "/tmp/image.png",
          width: "640",
          height: "480",
          mimeType: "image/png",
          fileSize: 1,
        },
      },
      {
        ...base,
        type: "insert_video",
        payload: {
          src: "https://cdn.teamgaga.com/video.mp4",
          width: "640",
          height: "480",
          mimeType: "video/mp4",
          fileSize: 1,
          poster: "/tmp/poster.png",
        },
      },
      {
        ...base,
        type: "insert_link",
        payload: { url: "javascript:alert(1)", text: "unsafe" },
      },
      {
        ...base,
        type: "insert_link",
        payload: { url: "https://teamgaga.com", text: " " },
      },
      {
        ...base,
        type: "insert_divider",
        payload: { extra: true },
      },
    ] as const;

    for (const command of invalid) {
      expect(parseProtocolCommand(command).ok).toBe(false);
    }
  });

  it("validates selections for a safe cross-platform integer range", () => {
    expectError(
      { ...base, type: "set_selection", payload: { selection: { start: -1, end: 0 } } },
      "invalid_payload",
      "$.payload.selection.start",
    );
    expectError(
      { ...base, type: "set_selection", payload: { selection: { start: 2, end: 1 } } },
      "invalid_payload",
      "$.payload.selection.end",
    );
    expectError(
      {
        ...base,
        type: "set_selection",
        payload: { selection: { start: 0, end: Number.MAX_SAFE_INTEGER + 1 } },
      },
      "invalid_payload",
      "$.payload.selection.end",
    );
    expectError(
      { ...base, type: "set_selection", payload: { selection: { start: 0, end: 0, extra: 1 } } },
      "invalid_payload",
      "$.payload.selection.extra",
    );
  });

  it("uses the canonical Delta validator and preserves issue paths", () => {
    expectError(
      {
        ...base,
        type: "set_snapshot",
        payload: { snapshot: { content: [{ insert: "missing terminal newline" }] } },
      },
      "invalid_payload",
      "$.payload.snapshot.content",
    );
    expectError(
      {
        ...base,
        type: "set_snapshot",
        payload: { snapshot: { content: [{ insert: "\n" }], extra: true } },
      },
      "invalid_payload",
      "$.payload.snapshot.extra",
    );
  });

  it("never throws for arbitrary boundary values", () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;

    for (const value of [undefined, null, true, 1, "message", [], {}, cyclic]) {
      expect(() => parseProtocolCommand(value)).not.toThrow();
      expect(parseProtocolCommand(value).ok).toBe(false);
    }
  });
});
