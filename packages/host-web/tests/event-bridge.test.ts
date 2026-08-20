import { describe, expect, it, vi } from "vite-plus/test";
import { createEditor } from "@teamgaga/richtext-core";
import { decodeProtocolMessage, PROTOCOL_VERSION } from "@teamgaga/richtext-protocol";
import { MockEditorAdapter } from "@teamgaga/richtext-testing";
import {
  bindEditorEventBridge,
  createProtocolReadyEvent,
  createProtocolRequestChannelEvent,
  createProtocolRequestCloseEvent,
  createProtocolRequestEmojiEvent,
  createProtocolRequestImageEvent,
  createProtocolRequestMentionEvent,
} from "../src/events/editor-event-bridge";

describe("editor event bridge", () => {
  it("maps core events to protocol events that round-trip", () => {
    const adapter = new MockEditorAdapter();
    const editor = createEditor({ adapter });
    editor.mount();

    const encoded: string[] = [];
    const onError = vi.fn();
    const bridge = bindEditorEventBridge(
      editor,
      (message) => {
        encoded.push(message);
      },
      onError,
    );

    adapter.emit({ type: "change" });
    adapter.emit({ type: "selection-change", selection: { start: 0, end: 1 } });
    adapter.emit({ type: "focus" });
    adapter.emit({ type: "blur" });
    adapter.emit({
      type: "state-change",
      state: {
        focused: false,
        selection: null,
        canUndo: true,
        canRedo: false,
        formats: {
          bold: true,
          italic: false,
          underline: false,
          strike: false,
          header: false,
          list: false,
          blockquote: false,
        },
      },
    });

    const types = encoded.map((raw) => {
      const parsed = decodeProtocolMessage(raw);
      expect(parsed.ok).toBe(true);
      if (!parsed.ok) {
        throw new Error("decode failed");
      }
      expect(parsed.value.kind).toBe("event");
      return parsed.value.kind === "event" ? parsed.value.type : "";
    });

    expect(types).toEqual(["change", "selection_change", "focus", "blur", "state_change"]);

    const stateEvents = encoded
      .map((raw) => decodeProtocolMessage(raw))
      .filter(
        (parsed) =>
          parsed.ok && parsed.value.kind === "event" && parsed.value.type === "state_change",
      );

    expect(stateEvents).toHaveLength(1);
    for (const parsed of stateEvents) {
      if (parsed.ok && parsed.value.kind === "event" && parsed.value.type === "state_change") {
        expect(parsed.value.payload.state.canUndo).toBe(true);
        expect(parsed.value.payload.state.canRedo).toBe(false);
      }
    }

    expect(onError).not.toHaveBeenCalled();

    const before = encoded.length;
    bridge.dispose();
    adapter.emit({ type: "change" });
    expect(encoded.length).toBe(before);

    editor.destroy();
  });

  it("builds request_close and request insert events", () => {
    expect(createProtocolRequestCloseEvent()).toEqual({
      version: PROTOCOL_VERSION,
      kind: "event",
      type: "request_close",
      payload: {},
    });
    expect(createProtocolRequestEmojiEvent({ start: 0, end: 0 })).toEqual({
      version: PROTOCOL_VERSION,
      kind: "event",
      type: "request_emoji",
      payload: { selection: { start: 0, end: 0 } },
    });
    expect(createProtocolRequestMentionEvent(null)).toEqual({
      version: PROTOCOL_VERSION,
      kind: "event",
      type: "request_mention",
      payload: { selection: null },
    });
    expect(createProtocolRequestChannelEvent({ start: 2, end: 5 })).toEqual({
      version: PROTOCOL_VERSION,
      kind: "event",
      type: "request_channel",
      payload: { selection: { start: 2, end: 5 } },
    });
    expect(createProtocolRequestImageEvent(null)).toEqual({
      version: PROTOCOL_VERSION,
      kind: "event",
      type: "request_image",
      payload: { selection: null },
    });
  });

  it("does not include ready in the bridge; lifecycle owns ready", () => {
    const ready = createProtocolReadyEvent();
    expect(ready.type).toBe("ready");
    expect(decodeProtocolMessage(JSON.stringify(ready)).ok).toBe(true);

    const adapter = new MockEditorAdapter();
    const editor = createEditor({ adapter });
    const encoded: string[] = [];
    bindEditorEventBridge(editor, (message) => encoded.push(message), vi.fn());
    editor.mount();
    // Core ready fires during mount, but bridge must not subscribe.
    expect(encoded).toEqual([]);
    editor.destroy();
  });
});
