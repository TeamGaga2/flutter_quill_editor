import { describe, expect, it } from "vite-plus/test";
import fixtures from "../fixtures/v2.json";
import { PROTOCOL_VERSION, isProtocolMessage, parseProtocolMessage } from "../src/index.ts";

function expectError(input: unknown, code: string, path: string): void {
  const result = parseProtocolMessage(input);

  expect(result.ok).toBe(false);

  if (!result.ok) {
    expect(result.error.code).toBe(code);
    expect(result.error.issues.some((issue) => issue.path === path)).toBe(true);
  }
}

describe("protocol events and responses", () => {
  it("accepts every event and response fixture", () => {
    for (const message of [...fixtures.events, ...fixtures.responses]) {
      expect(parseProtocolMessage(message)).toEqual({ ok: true, value: message });
      expect(isProtocolMessage(message)).toBe(true);
    }
  });

  it("validates nullable selection events and responses", () => {
    for (const type of [
      "selection_change",
      "request_emoji",
      "request_mention",
      "request_channel",
      "request_image",
    ] as const) {
      expect(
        parseProtocolMessage({
          version: PROTOCOL_VERSION,
          kind: "event",
          type,
          payload: { selection: null },
        }).ok,
      ).toBe(true);
      expect(
        parseProtocolMessage({
          version: PROTOCOL_VERSION,
          kind: "event",
          type,
          payload: { selection: { start: 1, end: 3 } },
        }).ok,
      ).toBe(true);
      expectError(
        {
          version: PROTOCOL_VERSION,
          kind: "event",
          type,
          payload: {},
        },
        "invalid_payload",
        "$.payload.selection",
      );
      expectError(
        {
          version: PROTOCOL_VERSION,
          kind: "event",
          type,
          payload: { selection: null, extra: true },
        },
        "invalid_payload",
        "$.payload.extra",
      );
    }
    expect(
      parseProtocolMessage({
        version: PROTOCOL_VERSION,
        kind: "response",
        id: "request-1",
        type: "get_selection",
        ok: true,
        value: { selection: { start: 2, end: 2 } },
      }).ok,
    ).toBe(true);
  });

  it("validates request_close, and get_caret_rect payloads", () => {
    expect(
      parseProtocolMessage({
        version: PROTOCOL_VERSION,
        kind: "event",
        type: "request_close",
        payload: {},
      }).ok,
    ).toBe(true);
    expect(
      parseProtocolMessage({
        version: PROTOCOL_VERSION,
        kind: "response",
        id: "request-1",
        type: "get_caret_rect",
        ok: true,
        value: { rect: null },
      }).ok,
    ).toBe(true);
    expect(
      parseProtocolMessage({
        version: PROTOCOL_VERSION,
        kind: "response",
        id: "request-1",
        type: "get_caret_rect",
        ok: true,
        value: { rect: { x: 0, y: 10, width: 0, height: 18 } },
      }).ok,
    ).toBe(true);
    expectError(
      {
        version: PROTOCOL_VERSION,
        kind: "event",
        type: "request_close",
        payload: { extra: true },
      },
      "invalid_payload",
      "$.payload.extra",
    );
    expectError(
      {
        version: PROTOCOL_VERSION,
        kind: "response",
        id: "request-1",
        type: "get_caret_rect",
        ok: true,
        value: { rect: { x: 0, y: 0, width: -1, height: 1 } },
      },
      "invalid_payload",
      "$.value.rect.width",
    );
  });

  it("strictly validates events and editor state", () => {
    expectError(
      { version: PROTOCOL_VERSION, kind: "future", type: "focus", payload: {} },
      "invalid_message",
      "$.kind",
    );
    expectError(
      { version: PROTOCOL_VERSION, kind: "event", type: "future_event", payload: {} },
      "invalid_message",
      "$.type",
    );
    expectError(
      { version: PROTOCOL_VERSION, kind: "event", type: "ready", payload: { protocol_version: 1 } },
      "invalid_payload",
      "$.payload.protocol_version",
    );
    expectError(
      { version: PROTOCOL_VERSION, kind: "event", type: "focus", payload: { extra: true } },
      "invalid_payload",
      "$.payload.extra",
    );
    expectError(
      {
        version: PROTOCOL_VERSION,
        kind: "event",
        type: "state_change",
        payload: {
          state: {
            focused: true,
            selection: null,
            canUndo: true,
            canRedo: false,
            formats: {
              bold: true,
              italic: false,
              underline: false,
              strike: false,
              header: 4,
              list: false,
              blockquote: false,
            },
          },
        },
      },
      "invalid_payload",
      "$.payload.state.formats.header",
    );
    expectError(
      {
        version: PROTOCOL_VERSION,
        kind: "event",
        type: "state_change",
        payload: {
          state: {
            focused: true,
            selection: null,
            canUndo: true,
            canRedo: "false",
            formats: {
              bold: false,
              italic: false,
              underline: false,
              strike: false,
              header: false,
              list: false,
              blockquote: false,
            },
          },
        },
      },
      "invalid_payload",
      "$.payload.state.canRedo",
    );
  });

  it("validates success values and request correlation", () => {
    expectError(
      {
        version: PROTOCOL_VERSION,
        kind: "response",
        id: "request-1",
        type: "undo",
        ok: "true",
        value: {},
      },
      "invalid_message",
      "$.ok",
    );
    expectError(
      {
        version: PROTOCOL_VERSION,
        kind: "response",
        id: "request-1",
        type: "undo",
        ok: true,
        value: { extra: true },
      },
      "invalid_payload",
      "$.value.extra",
    );
    expectError(
      {
        version: PROTOCOL_VERSION,
        kind: "response",
        id: " ",
        type: "undo",
        ok: true,
        value: {},
      },
      "invalid_message",
      "$.id",
    );
    expectError(
      {
        version: PROTOCOL_VERSION,
        kind: "response",
        id: "request-1",
        type: "get_snapshot",
        ok: true,
        value: { snapshot: { content: [] } },
      },
      "invalid_payload",
      "$.value.snapshot.content",
    );
  });

  it("correlates success and failure responses with the request id", () => {
    const success = parseProtocolMessage({
      version: PROTOCOL_VERSION,
      kind: "response",
      id: "same-request",
      type: "undo",
      ok: true,
      value: {},
    });
    const failure = parseProtocolMessage({
      version: PROTOCOL_VERSION,
      kind: "response",
      id: "same-request",
      ok: false,
      error: { code: "command_failed", message: "Undo failed." },
    });

    expect(success.ok && success.value.kind === "response" && success.value.id).toBe(
      "same-request",
    );
    expect(failure.ok && failure.value.kind === "response" && failure.value.id).toBe(
      "same-request",
    );
  });

  it("requires structured JSON-safe failure responses", () => {
    expectError(
      {
        version: PROTOCOL_VERSION,
        kind: "response",
        id: "request-1",
        ok: false,
        error: { code: "unknown", message: "Failure" },
      },
      "invalid_payload",
      "$.error.code",
    );
    expectError(
      {
        version: PROTOCOL_VERSION,
        kind: "response",
        id: "request-1",
        ok: false,
        error: { code: "command_failed", message: "Failure", details: undefined },
      },
      "invalid_payload",
      "$.error.details",
    );
    expectError(
      {
        version: PROTOCOL_VERSION,
        kind: "response",
        id: "request-1",
        ok: false,
        error: { code: "command_failed", message: "Failure", extra: true },
      },
      "invalid_payload",
      "$.error.extra",
    );
    expectError(
      {
        version: PROTOCOL_VERSION,
        kind: "response",
        id: "request-1",
        ok: false,
        error: { code: "command_failed", message: "Failure", details: new Date() },
      },
      "invalid_payload",
      "$.error.details",
    );
  });
});
