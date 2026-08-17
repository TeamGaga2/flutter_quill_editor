import { describe, expect, it, vi } from "vite-plus/test";
import type { RichTextSnapshotV1 } from "@teamgaga/richtext-delta";
import {
  createEditor,
  type EditorAdapterEvent,
  type EditorCommand,
  type EditorState,
  type RichTextAdapter,
  type RichTextSelection,
} from "../src/index.ts";

const snapshot: RichTextSnapshotV1 = {
  content: [{ insert: "\n" }],
};

const state: EditorState = {
  focused: true,
  selection: { start: 2, end: 5 },
  canUndo: true,
  canRedo: false,
  formats: {
    bold: true,
    italic: false,
    underline: false,
    strike: false,
    header: 2,
    list: false,
    blockquote: true,
  },
};

function createAdapter() {
  const commands: EditorCommand[] = [];
  let adapterListener: ((event: EditorAdapterEvent) => void) | undefined;

  const setSnapshot = vi.fn(() => adapterListener?.({ type: "change" }));
  const setSelection = vi.fn((selection: RichTextSelection) =>
    adapterListener?.({ type: "selection-change", selection }),
  );
  const subscribe = vi.fn((listener: (event: EditorAdapterEvent) => void) => {
    adapterListener = listener;
    return vi.fn();
  });
  const focus = vi.fn();
  const blur = vi.fn();
  const destroy = vi.fn();
  const adapter: RichTextAdapter = {
    getSnapshot: vi.fn(() => snapshot),
    setSnapshot,
    setTitle: vi.fn(),
    getSelection: vi.fn(() => ({ start: 2, end: 5 })),
    setSelection,
    getCaretRect: vi.fn(() => ({ x: 10, y: 20, width: 0, height: 16 })),
    getState: vi.fn(() => state),
    focus,
    blur,
    execute: vi.fn((command) => commands.push(command)),
    subscribe,
    destroy,
  };

  return {
    adapter,
    blur,
    commands,
    destroy,
    focus,
    emit: (event: EditorAdapterEvent) => adapterListener?.(event),
    setSelection,
    setSnapshot,
    subscribe,
  };
}

describe("editor", () => {
  it("mounts once, forwards adapter events, and destroys once", () => {
    const mock = createAdapter();
    const editor = createEditor({ adapter: mock.adapter });
    const events: string[] = [];

    editor.on("ready", (event) => events.push(event.type));
    editor.on("focus", (event) => events.push(event.type));
    editor.on("state-change", (event) => events.push(event.state.focused ? event.type : ""));

    editor.mount();
    editor.mount();
    mock.emit({ type: "focus" });
    mock.emit({ type: "state-change", state });

    expect(mock.subscribe).toHaveBeenCalledTimes(1);
    expect(events).toEqual(["ready", "focus", "state-change"]);

    editor.destroy();
    editor.destroy();

    expect(mock.destroy).toHaveBeenCalledTimes(1);
  });

  it("reads and writes snapshots and selections", () => {
    const mock = createAdapter();
    const editor = createEditor({ adapter: mock.adapter });
    const events: string[] = [];

    editor.on("change", (event) => events.push(event.type));
    editor.on("selection-change", (event) => events.push(event.type));
    editor.mount();

    expect(editor.getSnapshot()).toBe(snapshot);
    expect(editor.getSelection()).toEqual({ start: 2, end: 5 });
    expect(editor.getState()).toBe(state);

    editor.setSnapshot(snapshot);
    editor.setSelection({ start: 1, end: 3 });
    editor.focus();
    editor.blur();

    expect(mock.setSnapshot).toHaveBeenCalledWith(snapshot);
    expect(mock.setSelection).toHaveBeenCalledWith({ start: 1, end: 3 });
    expect(mock.focus).toHaveBeenCalledTimes(1);
    expect(mock.blur).toHaveBeenCalledTimes(1);
    expect(events).toEqual(["change", "selection-change"]);
  });

  it("dispatches semantic commands and history operations", () => {
    const mock = createAdapter();
    const editor = createEditor({ adapter: mock.adapter });

    editor.commands.toggleBold();
    editor.commands.toggleItalic();
    editor.commands.toggleUnderline();
    editor.commands.toggleStrike();
    editor.commands.toggleHeader(1);
    editor.commands.toggleHeader(2);
    editor.commands.toggleHeader(3);
    editor.commands.toggleList("ordered");
    editor.commands.toggleList("bullet");
    editor.commands.toggleBlockquote();
    editor.commands.insertEmoji("party_parrot");
    editor.commands.insertMention(
      { id: "user-1", sign: "!", displayText: "Alice" },
      { start: 1, end: 2 },
    );
    editor.commands.insertChannel({ id: "channel-1", displayText: "general" });
    editor.commands.insertImage({
      src: "tgg-local-media://image-token",
      width: "640",
      height: "480",
      mimeType: "image/png",
      fileSize: 1,
    });
    editor.commands.insertVideo({
      src: "https://cdn.teamgaga.com/video.mp4",
      width: "1280",
      height: "720",
      mimeType: "video/mp4",
      fileSize: 2,
      duration: 3,
    });
    editor.commands.insertLink(
      { url: "https://teamgaga.com", text: "TeamGaga" },
      { start: 0, end: 5 },
    );
    editor.commands.insertDivider();
    editor.commands.indent();
    editor.commands.outdent();
    editor.history.undo();
    editor.history.redo();

    expect(mock.commands).toEqual([
      { type: "toggle-inline-format", format: "bold" },
      { type: "toggle-inline-format", format: "italic" },
      { type: "toggle-inline-format", format: "underline" },
      { type: "toggle-inline-format", format: "strike" },
      { type: "toggle-block-format", format: "header", value: 1 },
      { type: "toggle-block-format", format: "header", value: 2 },
      { type: "toggle-block-format", format: "header", value: 3 },
      { type: "toggle-block-format", format: "list", value: "ordered" },
      { type: "toggle-block-format", format: "list", value: "bullet" },
      { type: "toggle-block-format", format: "blockquote" },
      { type: "insert-emoji", id: "party_parrot" },
      {
        type: "insert-mention",
        mention: { id: "user-1", sign: "!", displayText: "Alice" },
        selection: { start: 1, end: 2 },
      },
      { type: "insert-channel", channel: { id: "channel-1", displayText: "general" } },
      {
        type: "insert-image",
        image: {
          src: "tgg-local-media://image-token",
          width: "640",
          height: "480",
          mimeType: "image/png",
          fileSize: 1,
        },
      },
      {
        type: "insert-video",
        video: {
          src: "https://cdn.teamgaga.com/video.mp4",
          width: "1280",
          height: "720",
          mimeType: "video/mp4",
          fileSize: 2,
          duration: 3,
        },
      },
      {
        type: "insert-link",
        link: { url: "https://teamgaga.com", text: "TeamGaga" },
        selection: { start: 0, end: 5 },
      },
      { type: "insert-divider" },
      { type: "indent" },
      { type: "outdent" },
      { type: "undo" },
      { type: "redo" },
    ]);
    expect(editor.getCaretRect()).toEqual({ x: 10, y: 20, width: 0, height: 16 });
  });

  it("rejects invalid selections and use after destroy", () => {
    const mock = createAdapter();
    const editor = createEditor({ adapter: mock.adapter });

    expect(() => editor.setSelection({ start: -1, end: 0 })).toThrow(
      "Selection start must be a non-negative integer.",
    );
    expect(() => editor.setSelection({ start: 3, end: 2 })).toThrow(
      "Selection end must be an integer greater than or equal to start.",
    );
    expect(() => editor.commands.insertEmoji(" ")).toThrow("Emoji id must be a non-empty string.");
    expect(() => editor.commands.insertMention({ id: "user", sign: "!", displayText: "" })).toThrow(
      "Mention displayText must be a non-empty string.",
    );
    expect(() =>
      editor.commands.insertChannel(
        { id: "channel", displayText: "general" },
        { start: 2, end: 1 },
      ),
    ).toThrow("Selection end must be an integer greater than or equal to start.");

    editor.destroy();

    expect(() => editor.getSnapshot()).toThrow("Editor has been destroyed.");
    expect(() => editor.focus()).toThrow("Editor has been destroyed.");
    expect(() => editor.blur()).toThrow("Editor has been destroyed.");
  });
});
