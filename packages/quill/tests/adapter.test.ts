import { afterEach, describe, expect, it } from "vite-plus/test";
import type { EditorAdapterEvent, EditorState, RichTextSelection } from "@teamgaga/richtext-core";
import type { RichTextSnapshotV1 } from "@teamgaga/richtext-delta";
import { createQuillAdapter } from "../src/adapter";

const defaultSnapshot: RichTextSnapshotV1 = {
  content: [{ insert: "Hello" }, { insert: "\n" }],
};

function createMountedAdapter(
  snapshot: RichTextSnapshotV1 = defaultSnapshot,
  selection: RichTextSelection = { start: 0, end: 0 },
) {
  const element = document.createElement("div");
  document.body.append(element);
  const adapter = createQuillAdapter({ element });

  adapter.setSnapshot(snapshot);
  adapter.setSelection(selection);

  return adapter;
}

function waitFrames(count: number): Promise<void> {
  return new Promise((resolve) => {
    const step = (remaining: number): void => {
      if (remaining <= 0) {
        resolve();
        return;
      }
      requestAnimationFrame(() => step(remaining - 1));
    };
    step(count);
  });
}

function makeScrollPortScrollable(container: HTMLElement): () => number {
  let scrollTop = 0;
  let writes = 0;
  Object.defineProperty(container, "clientWidth", { configurable: true, value: 100 });
  Object.defineProperty(container, "clientHeight", { configurable: true, value: 100 });
  Object.defineProperty(container, "scrollTop", {
    configurable: true,
    get: () => scrollTop,
    set: (next: number) => {
      scrollTop = next;
      writes += 1;
    },
  });
  container.getBoundingClientRect = () =>
    ({ top: 0, right: 100, bottom: 100, left: 0, width: 100, height: 100 }) as DOMRect;
  return () => writes;
}

function setOutOfViewCaret(quill: InstanceType<typeof import("quill").default>): void {
  quill.selection.getBounds = () =>
    ({ top: 150, right: 20, bottom: 170, left: 10, width: 10, height: 20 }) as DOMRect;
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("QuillAdapter placeholder", () => {
  it("sets data-placeholder when constructed with a non-empty placeholder", () => {
    const element = document.createElement("div");
    document.body.append(element);
    const adapter = createQuillAdapter({
      element,
      placeholder: "Enter the text...",
    });

    const editor = element.querySelector(".ql-editor");
    expect(editor?.getAttribute("data-placeholder")).toBe("Enter the text...");

    adapter.destroy();
  });

  it("omits data-placeholder when placeholder is empty", () => {
    const element = document.createElement("div");
    document.body.append(element);
    const adapter = createQuillAdapter({ element, placeholder: "" });

    const editor = element.querySelector(".ql-editor");
    expect(editor?.hasAttribute("data-placeholder")).toBe(false);

    adapter.destroy();
  });
});

describe("QuillAdapter scroll ownership", () => {
  it("routes selection visibility to the editor scrollport instead of Quill's ancestor walk", async () => {
    const { default: Quill } = await import("quill");
    const element = document.createElement("div");
    document.body.append(element);
    const adapter = createQuillAdapter({ element });
    adapter.setSnapshot(defaultSnapshot);
    adapter.setSelection({ start: 2, end: 2 });

    const quill = Quill.find(element) as InstanceType<typeof Quill>;
    let quillScrollCalls = 0;
    const nativeScrollRectIntoView = quill.scrollRectIntoView.bind(quill);
    quill.scrollRectIntoView = (rect) => {
      quillScrollCalls += 1;
      nativeScrollRectIntoView(rect);
    };

    adapter.focus();
    await waitFrames(3);

    expect(quillScrollCalls).toBe(0);
    adapter.destroy();
  });
});

describe("QuillAdapter block formats", () => {
  it("toggles and replaces header formats", () => {
    const adapter = createMountedAdapter();

    adapter.execute({ type: "toggle-block-format", format: "header", value: 1 });
    expect(adapter.getSnapshot().content).toEqual([
      { insert: "Hello" },
      { insert: "\n", attributes: { header: 1 } },
    ]);
    expect(adapter.getState().formats.header).toBe(1);

    adapter.execute({ type: "toggle-block-format", format: "header", value: 2 });
    expect(adapter.getState().formats.header).toBe(2);

    adapter.execute({ type: "toggle-block-format", format: "header", value: 2 });
    expect(adapter.getState().formats.header).toBe(false);

    adapter.destroy();
  });

  it("keeps selection after a focused header toggle", () => {
    const adapter = createMountedAdapter(defaultSnapshot, { start: 2, end: 2 });
    adapter.focus();

    expect(adapter.getState().focused).toBe(true);
    expect(adapter.getSelection()).toEqual({ start: 2, end: 2 });

    adapter.execute({ type: "toggle-block-format", format: "header", value: 1 });

    expect(adapter.getState().formats.header).toBe(1);
    expect(adapter.getState().focused).toBe(true);
    expect(adapter.getSelection()).toEqual({ start: 2, end: 2 });

    adapter.execute({ type: "toggle-block-format", format: "header", value: 2 });
    expect(adapter.getState().formats.header).toBe(2);
    expect(adapter.getSelection()).toEqual({ start: 2, end: 2 });

    adapter.execute({ type: "toggle-block-format", format: "header", value: 2 });
    expect(adapter.getState().formats.header).toBe(false);
    expect(adapter.getSelection()).toEqual({ start: 2, end: 2 });

    adapter.destroy();
  });

  it("toggles list and blockquote formats and writes their snapshot attributes", () => {
    const adapter = createMountedAdapter();

    adapter.execute({ type: "toggle-block-format", format: "list", value: "ordered" });
    expect(adapter.getState().formats.list).toBe("ordered");
    expect(adapter.getSnapshot().content).toEqual([
      { insert: "Hello" },
      { insert: "\n", attributes: { list: "ordered" } },
    ]);

    adapter.execute({ type: "toggle-block-format", format: "list", value: "bullet" });
    expect(adapter.getState().formats.list).toBe("bullet");
    expect(adapter.getSnapshot().content).toEqual([
      { insert: "Hello" },
      { insert: "\n", attributes: { list: "bullet" } },
    ]);

    adapter.execute({ type: "toggle-block-format", format: "list", value: "bullet" });
    expect(adapter.getState().formats.list).toBe(false);

    adapter.execute({ type: "toggle-block-format", format: "blockquote" });
    expect(adapter.getState().formats.blockquote).toBe(true);
    expect(adapter.getSnapshot().content).toEqual([
      { insert: "Hello" },
      { insert: "\n", attributes: { blockquote: true } },
    ]);

    adapter.execute({ type: "toggle-block-format", format: "blockquote" });
    expect(adapter.getState().formats.blockquote).toBe(false);

    adapter.destroy();
  });

  it("indents and outdents list lines via block indent attributes", () => {
    const adapter = createMountedAdapter();

    adapter.execute({ type: "toggle-block-format", format: "list", value: "bullet" });
    adapter.execute({ type: "indent" });
    expect(adapter.getSnapshot().content).toEqual([
      { insert: "Hello" },
      { insert: "\n", attributes: { list: "bullet", indent: 1 } },
    ]);

    adapter.execute({ type: "indent" });
    expect(adapter.getSnapshot().content).toEqual([
      { insert: "Hello" },
      { insert: "\n", attributes: { list: "bullet", indent: 2 } },
    ]);

    adapter.execute({ type: "outdent" });
    expect(adapter.getSnapshot().content).toEqual([
      { insert: "Hello" },
      { insert: "\n", attributes: { list: "bullet", indent: 1 } },
    ]);

    adapter.execute({ type: "outdent" });
    expect(adapter.getSnapshot().content).toEqual([
      { insert: "Hello" },
      { insert: "\n", attributes: { list: "bullet" } },
    ]);

    adapter.destroy();
  });

  it("caps indent at level 5 like flutter_quill indentSelection", () => {
    const adapter = createMountedAdapter();

    adapter.execute({ type: "toggle-block-format", format: "list", value: "bullet" });
    for (let i = 0; i < 8; i += 1) {
      adapter.execute({ type: "indent" });
    }

    expect(adapter.getSnapshot().content).toEqual([
      { insert: "Hello" },
      { insert: "\n", attributes: { list: "bullet", indent: 5 } },
    ]);

    adapter.execute({ type: "indent" });
    expect(adapter.getSnapshot().content).toEqual([
      { insert: "Hello" },
      { insert: "\n", attributes: { list: "bullet", indent: 5 } },
    ]);

    adapter.destroy();
  });

  it("indents via lastSelection when hasFocus is true but getSelection is null", async () => {
    const { default: Quill } = await import("quill");
    const adapter = createMountedAdapter(defaultSnapshot, { start: 0, end: 5 });
    const container = document.querySelector(".ql-container");
    expect(container).toBeTruthy();
    const quill = Quill.find(container!) as InstanceType<typeof Quill>;

    adapter.execute({ type: "toggle-block-format", format: "list", value: "bullet" });

    const originalHasFocus = quill.hasFocus.bind(quill);
    const originalGetSelection = quill.getSelection.bind(quill);
    quill.hasFocus = () => true;
    quill.getSelection = (() => null) as typeof quill.getSelection;

    try {
      expect(() => adapter.execute({ type: "indent" })).not.toThrow();
      expect(adapter.getSnapshot().content).toEqual([
        { insert: "Hello" },
        { insert: "\n", attributes: { list: "bullet", indent: 1 } },
      ]);
    } finally {
      quill.hasFocus = originalHasFocus;
      quill.getSelection = originalGetSelection;
    }

    adapter.destroy();
  });

  it("returns viewport caret rect or null when selection is missing", () => {
    const element = document.createElement("div");
    document.body.append(element);
    const adapter = createQuillAdapter({ element });

    expect(adapter.getCaretRect()).toBeNull();

    adapter.setSnapshot(defaultSnapshot);
    adapter.setSelection({ start: 1, end: 1 });

    const rect = adapter.getCaretRect();
    expect(rect).not.toBeNull();
    if (rect) {
      expect(Number.isFinite(rect.x)).toBe(true);
      expect(Number.isFinite(rect.y)).toBe(true);
      expect(rect.width).toBeGreaterThanOrEqual(0);
      expect(rect.height).toBeGreaterThanOrEqual(0);
    }

    adapter.destroy();
  });

  it("normalizes a mixed header selection to the requested header", () => {
    const adapter = createMountedAdapter(
      {
        content: [
          { insert: "One" },
          { insert: "\n", attributes: { header: 1 } },
          { insert: "Two\n" },
        ],
      },
      { start: 0, end: 8 },
    );

    expect(adapter.getState().formats.header).toBe(false);

    adapter.execute({ type: "toggle-block-format", format: "header", value: 2 });

    expect(adapter.getState().formats.header).toBe(2);
    expect(adapter.getSnapshot().content).toEqual([
      { insert: "One" },
      { insert: "\n", attributes: { header: 2 } },
      { insert: "Two" },
      { insert: "\n", attributes: { header: 2 } },
    ]);

    adapter.destroy();
  });

  it("normalizes a mixed list selection to the requested list", () => {
    const adapter = createMountedAdapter(
      {
        content: [
          { insert: "One" },
          { insert: "\n", attributes: { list: "ordered" } },
          { insert: "Two\n" },
        ],
      },
      { start: 0, end: 8 },
    );

    expect(adapter.getState().formats.list).toBe(false);

    adapter.execute({ type: "toggle-block-format", format: "list", value: "bullet" });

    expect(adapter.getState().formats.list).toBe("bullet");
    expect(adapter.getSnapshot().content).toEqual([
      { insert: "One" },
      { insert: "\n", attributes: { list: "bullet" } },
      { insert: "Two" },
      { insert: "\n", attributes: { list: "bullet" } },
    ]);

    adapter.destroy();
  });

  it("normalizes a mixed blockquote selection to blockquotes", () => {
    const adapter = createMountedAdapter(
      {
        content: [
          { insert: "One" },
          { insert: "\n", attributes: { blockquote: true } },
          { insert: "Two\n" },
        ],
      },
      { start: 0, end: 8 },
    );

    expect(adapter.getState().formats.blockquote).toBe(false);

    adapter.execute({ type: "toggle-block-format", format: "blockquote" });

    expect(adapter.getState().formats.blockquote).toBe(true);
    expect(adapter.getSnapshot().content).toEqual([
      { insert: "One" },
      { insert: "\n", attributes: { blockquote: true } },
      { insert: "Two" },
      { insert: "\n", attributes: { blockquote: true } },
    ]);

    adapter.destroy();
  });

  it("publishes one final state for format, undo, and redo", () => {
    const adapter = createMountedAdapter();
    const states: EditorState[] = [];

    expect(adapter.getState()).toMatchObject({ canUndo: false, canRedo: false });
    const unsubscribe = adapter.subscribe((event) => {
      if (event.type === "state-change") {
        states.push(event.state);
      }
    });

    adapter.execute({ type: "toggle-block-format", format: "header", value: 3 });
    expect(states.at(-1)?.formats.header).toBe(3);
    expect(states.at(-1)).toMatchObject({ canUndo: true, canRedo: false });

    adapter.execute({ type: "undo" });
    expect(states.at(-1)?.formats.header).toBe(false);
    expect(states.at(-1)).toMatchObject({ canUndo: false, canRedo: true });

    adapter.execute({ type: "redo" });
    expect(states.at(-1)?.formats.header).toBe(3);
    expect(states.at(-1)).toMatchObject({ canUndo: true, canRedo: false });

    expect(states.map((state) => state.formats.header)).toEqual([3, false, 3]);

    unsubscribe();
    adapter.destroy();
  });

  it("focuses and blurs while restoring the last selection", async () => {
    const adapter = createMountedAdapter(defaultSnapshot, { start: 1, end: 4 });
    const events: EditorAdapterEvent[] = [];
    const unsubscribe = adapter.subscribe((event) => events.push(event));

    adapter.blur();
    await Promise.resolve();

    expect(adapter.getState()).toMatchObject({ focused: false, selection: null });

    adapter.focus();
    await Promise.resolve();

    expect(adapter.getState()).toMatchObject({
      focused: true,
      selection: { start: 1, end: 4 },
    });
    expect(
      events
        .filter((event) => event.type === "focus" || event.type === "blur")
        .map((event) => event.type),
    ).toEqual(["blur", "focus"]);
    expect(events.filter((event) => event.type === "state-change")).toHaveLength(2);

    unsubscribe();
    adapter.destroy();
  });

  it("reads formats from the last selection while blurred", async () => {
    const adapter = createMountedAdapter(
      {
        content: [
          { insert: "Hello", attributes: { bold: true } },
          { insert: "\n", attributes: { list: "ordered" } },
        ],
      },
      { start: 0, end: 5 },
    );

    adapter.blur();
    await Promise.resolve();

    expect(adapter.getState()).toMatchObject({
      focused: false,
      selection: null,
      formats: { bold: true, list: "ordered" },
    });

    adapter.destroy();
  });

  it("formats the last range while blurred without restoring focus", async () => {
    const adapter = createMountedAdapter(defaultSnapshot, { start: 0, end: 5 });
    const root = document.querySelector<HTMLElement>(".ql-editor");
    const events: EditorAdapterEvent[] = [];
    const unsubscribe = adapter.subscribe((event) => events.push(event));

    adapter.blur();
    await Promise.resolve();
    events.length = 0;

    expect(adapter.getSelection()).toBeNull();
    expect(adapter.getState()).toMatchObject({
      focused: false,
      selection: null,
      formats: { bold: false, italic: false, list: false },
    });

    adapter.execute({ type: "toggle-inline-format", format: "bold" });
    adapter.execute({ type: "toggle-inline-format", format: "italic" });
    adapter.execute({ type: "toggle-block-format", format: "header", value: 2 });

    expect(adapter.getState().formats).toMatchObject({
      header: 2,
      list: false,
      blockquote: false,
    });

    adapter.execute({ type: "toggle-block-format", format: "list", value: "bullet" });

    expect(adapter.getState().formats).toMatchObject({
      header: false,
      list: "bullet",
      blockquote: false,
    });

    adapter.execute({ type: "toggle-block-format", format: "blockquote" });

    expect(adapter.getState()).toMatchObject({
      focused: false,
      selection: null,
      formats: {
        bold: true,
        italic: true,
        header: false,
        list: false,
        blockquote: true,
      },
    });
    expect(adapter.getSelection()).toBeNull();
    expect(document.getSelection()?.rangeCount).toBe(0);
    expect(document.activeElement).not.toBe(root);
    expect(root?.getAttribute("contenteditable")).toBe("true");
    expect(adapter.getSnapshot().content).toEqual([
      { insert: "Hello", attributes: { bold: true, italic: true } },
      { insert: "\n", attributes: { blockquote: true } },
    ]);
    expect(
      events
        .filter((event) => event.type === "focus" || event.type === "blur")
        .map((event) => event.type),
    ).toEqual([]);
    expect(events.filter((event) => event.type === "selection-change")).toEqual([]);

    adapter.focus();
    await Promise.resolve();

    expect(adapter.getState()).toMatchObject({
      focused: true,
      selection: { start: 0, end: 5 },
      formats: {
        bold: true,
        italic: true,
        header: false,
        list: false,
        blockquote: true,
      },
    });
    expect(
      events
        .filter((event) => event.type === "focus" || event.type === "blur")
        .map((event) => event.type),
    ).toEqual(["focus"]);

    unsubscribe();
    adapter.destroy();
  });

  it("isolates blurred inline formatting from native editing focus", async () => {
    const adapter = createMountedAdapter(defaultSnapshot, { start: 0, end: 5 });
    const root = document.querySelector<HTMLElement>(".ql-editor");
    if (!root) throw new Error("Missing Quill editor root");

    const contenteditableBeforeChanges: Array<string | null> = [];
    const observer = new MutationObserver((records) => {
      for (const record of records) {
        contenteditableBeforeChanges.push(record.oldValue);
      }
    });
    observer.observe(root, {
      attributes: true,
      attributeFilter: ["contenteditable"],
      attributeOldValue: true,
    });

    adapter.blur();
    await Promise.resolve();
    adapter.execute({ type: "toggle-inline-format", format: "bold" });
    await Promise.resolve();
    observer.disconnect();

    expect(contenteditableBeforeChanges).toContain("true");
    expect(root.getAttribute("contenteditable")).toBe("true");
    expect(document.activeElement).not.toBe(root);

    adapter.destroy();
  });

  it("preserves collapsed inline formats across blurred commands and later focus", async () => {
    const adapter = createMountedAdapter(defaultSnapshot, { start: 5, end: 5 });
    const root = document.querySelector<HTMLElement>(".ql-editor");
    const events: EditorAdapterEvent[] = [];
    const unsubscribe = adapter.subscribe((event) => events.push(event));

    adapter.blur();
    await Promise.resolve();
    events.length = 0;

    adapter.execute({ type: "toggle-inline-format", format: "bold" });
    adapter.execute({ type: "toggle-inline-format", format: "italic" });

    expect(adapter.getState()).toMatchObject({
      focused: false,
      selection: null,
      formats: { bold: true, italic: true },
    });
    expect(adapter.getSnapshot().content).toEqual([{ insert: "Hello\n" }]);
    expect(document.activeElement).not.toBe(root);
    expect(
      events
        .filter((event) => event.type === "focus" || event.type === "blur")
        .map((event) => event.type),
    ).toEqual([]);

    adapter.focus();
    await Promise.resolve();

    expect(adapter.getState()).toMatchObject({
      focused: true,
      selection: { start: 5, end: 5 },
      formats: { bold: true, italic: true },
    });
    expect(root?.querySelector(".ql-cursor")).not.toBeNull();

    unsubscribe();
    adapter.destroy();
  });

  it("cleans up the temporary blurred selection when formatting throws", async () => {
    const adapter = createMountedAdapter(defaultSnapshot, { start: 1, end: 4 });
    const root = document.querySelector<HTMLElement>(".ql-editor");
    const container = root?.parentElement;
    const events: EditorAdapterEvent[] = [];
    const unsubscribe = adapter.subscribe((event) => events.push(event));
    expect(container).toBeTruthy();

    const Quill = (await import("quill")).default;
    const quill = Quill.find(container!) as InstanceType<typeof Quill>;
    const originalFormat = quill.format.bind(quill);

    adapter.blur();
    await Promise.resolve();
    events.length = 0;

    quill.format = () => {
      throw new Error("format failed");
    };

    try {
      expect(() => {
        adapter.execute({ type: "toggle-inline-format", format: "bold" });
      }).toThrow("format failed");
    } finally {
      quill.format = originalFormat;
    }

    expect(adapter.getState()).toMatchObject({
      focused: false,
      selection: null,
    });
    expect(document.getSelection()?.rangeCount).toBe(0);
    expect(document.activeElement).not.toBe(root);
    expect(
      events
        .filter((event) => event.type === "focus" || event.type === "blur")
        .map((event) => event.type),
    ).toEqual([]);

    adapter.focus();
    await Promise.resolve();

    expect(adapter.getState()).toMatchObject({
      focused: true,
      selection: { start: 1, end: 4 },
    });

    unsubscribe();
    adapter.destroy();
  });

  it("publishes a fallback state for collapsed inline formatting without text changes", () => {
    const adapter = createMountedAdapter();
    const events: EditorAdapterEvent[] = [];
    const unsubscribe = adapter.subscribe((event) => events.push(event));

    adapter.execute({ type: "toggle-inline-format", format: "bold" });

    expect(events.filter((event) => event.type === "change")).toHaveLength(0);
    expect(events.filter((event) => event.type === "state-change")).toHaveLength(1);
    expect(adapter.getState().formats.bold).toBe(true);

    unsubscribe();
    adapter.destroy();
  });

  it("replaces the requested range and appends one space only for mentions", () => {
    const adapter = createMountedAdapter(defaultSnapshot, { start: 1, end: 4 });

    adapter.execute({
      type: "insert-mention",
      mention: { id: "user-1", sign: "!", displayText: "Alice" },
      selection: { start: 1, end: 4 },
    });

    expect(adapter.getSnapshot().content).toEqual([
      { insert: "H" },
      {
        insert: { mention: "user-1" },
        attributes: { sign: "!", displayText: "Alice" },
      },
      { insert: " o\n" },
    ]);
    // Embed inserts leave the surface blurred; host focus restores the caret.
    expect(adapter.getSelection()).toBeNull();
    adapter.focus();
    expect(adapter.getSelection()).toEqual({ start: 3, end: 3 });

    adapter.destroy();
  });

  it("inserts channel embeds and appends one trailing space", () => {
    const adapter = createMountedAdapter(defaultSnapshot, { start: 5, end: 5 });

    adapter.execute({
      type: "insert-channel",
      channel: { id: "channel-1", displayText: "general" },
    });

    // Space suffix matches mention inserts (Android WebView selection coordinates).
    expect(adapter.getSnapshot().content).toEqual([
      { insert: "Hello" },
      {
        insert: { channel: "channel-1" },
        attributes: { displayText: "general" },
      },
      { insert: " \n" },
    ]);

    adapter.destroy();
  });

  it("inserts image as a block embed and remembers caret on the next line", () => {
    const adapter = createMountedAdapter(defaultSnapshot, { start: 5, end: 5 });

    adapter.execute({
      type: "insert-image",
      image: {
        src: "tgg-local-media://image-token",
        width: "640",
        height: "480",
        mimeType: "image/png",
        fileSize: 12,
      },
    });

    expect(adapter.getSnapshot().content).toEqual([
      { insert: "Hello\n" },
      {
        insert: { image: "tgg-local-media://image-token" },
        attributes: {
          width: "640",
          height: "480",
          mimeType: "image/png",
          fileSize: 12,
        },
      },
      { insert: "\n" },
    ]);
    // Media inserts leave the surface blurred; host focus restores the caret
    // on the empty line after the block image (Flutter newLine: true).
    expect(adapter.getSelection()).toBeNull();
    adapter.focus();
    expect(adapter.getSelection()).toEqual({ start: 7, end: 7 });

    adapter.destroy();
  });

  it("inserts video as a block embed and remembers caret on the next line", () => {
    const adapter = createMountedAdapter(defaultSnapshot, { start: 5, end: 5 });

    adapter.execute({
      type: "insert-video",
      video: {
        src: "tgg-local-media://video-token",
        width: "1280",
        height: "720",
        mimeType: "video/mp4",
        fileSize: 42,
        poster: "tgg-local-media://poster-token",
        duration: 15,
      },
    });

    expect(adapter.getSnapshot().content).toEqual([
      { insert: "Hello\n" },
      {
        insert: { video: "tgg-local-media://video-token" },
        attributes: {
          width: "1280",
          height: "720",
          mimeType: "video/mp4",
          fileSize: 42,
          poster: "tgg-local-media://poster-token",
          duration: 15,
        },
      },
      { insert: "\n" },
    ]);
    const wrap = document.querySelector("div.tgg-video");
    expect(wrap).not.toBeNull();
    expect(wrap?.querySelector("video.tgg-video__media")).not.toBeNull();
    expect(wrap?.querySelector("span.tgg-video__play")).not.toBeNull();
    expect(adapter.getSelection()).toBeNull();
    adapter.focus();
    expect(adapter.getSelection()).toEqual({ start: 7, end: 7 });

    adapter.destroy();
  });

  it("atomically replaces a selection with a link", () => {
    const adapter = createMountedAdapter(defaultSnapshot, { start: 0, end: 5 });

    adapter.execute({
      type: "insert-link",
      link: { url: "https://teamgaga.com", text: "TeamGaga" },
      selection: { start: 0, end: 5 },
    });

    expect(adapter.getSnapshot().content).toEqual([
      {
        insert: "TeamGaga",
        attributes: { link: "https://teamgaga.com" },
      },
      { insert: "\n" },
    ]);
    expect(adapter.getSelection()).toEqual({ start: 8, end: 8 });

    adapter.destroy();
  });

  it("inserts a divider at the current selection", () => {
    const adapter = createMountedAdapter(defaultSnapshot, { start: 5, end: 5 });

    adapter.execute({ type: "insert-divider" });

    expect(adapter.getSnapshot().content).toEqual([
      { insert: "Hello\n" },
      { insert: { divider: "true" } },
      { insert: "\n" },
    ]);
    // Caret lands on the empty line after the block divider (Flutter lineBreak: true).
    expect(adapter.getSelection()).toEqual({ start: 7, end: 7 });
    expect(adapter.getState().focused).toBe(true);

    adapter.destroy();
  });

  it("keeps focus on the line after a divider when refocusing", () => {
    const adapter = createMountedAdapter(defaultSnapshot, { start: 5, end: 5 });

    adapter.execute({ type: "insert-divider" });
    adapter.blur();
    expect(adapter.getState().focused).toBe(false);

    adapter.focus();

    expect(adapter.getState().focused).toBe(true);
    expect(adapter.getSelection()).toEqual({ start: 7, end: 7 });

    adapter.destroy();
  });

  it("keeps the cursor on the exited list line when switching list type", async () => {
    const adapter = createMountedAdapter(
      {
        content: [{ insert: "Item" }, { insert: "\n", attributes: { list: "ordered" } }],
      },
      { start: 4, end: 4 },
    );
    const root = document.querySelector<HTMLElement>(".ql-editor");

    root?.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    root?.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    await Promise.resolve();

    expect(adapter.getSelection()).toEqual({ start: 5, end: 5 });
    expect(adapter.getState().formats.list).toBe(false);
    expect(adapter.getSnapshot().content).toEqual([
      { insert: "Item" },
      { insert: "\n", attributes: { list: "ordered" } },
      { insert: "\n" },
    ]);

    adapter.execute({ type: "toggle-block-format", format: "list", value: "bullet" });

    expect(adapter.getSelection()).toEqual({ start: 5, end: 5 });
    expect(adapter.getState().formats.list).toBe("bullet");
    expect(adapter.getSnapshot().content).toEqual([
      { insert: "Item" },
      { insert: "\n", attributes: { list: "ordered" } },
      { insert: "\n", attributes: { list: "bullet" } },
    ]);

    adapter.destroy();
  });

  it("continues a blockquote after one Enter and exits after the second", async () => {
    const adapter = createMountedAdapter(
      {
        content: [{ insert: "Quote" }, { insert: "\n", attributes: { blockquote: true } }],
      },
      { start: 5, end: 5 },
    );
    const root = document.querySelector<HTMLElement>(".ql-editor");

    root?.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    await Promise.resolve();

    expect(adapter.getSelection()).toEqual({ start: 6, end: 6 });
    expect(adapter.getState().formats.blockquote).toBe(true);
    expect(adapter.getSnapshot().content).toEqual([
      { insert: "Quote" },
      { insert: "\n\n", attributes: { blockquote: true } },
    ]);

    root?.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    await Promise.resolve();

    expect(adapter.getSelection()).toEqual({ start: 6, end: 6 });
    expect(adapter.getState().formats.blockquote).toBe(false);
    expect(adapter.getSnapshot().content).toEqual([
      { insert: "Quote" },
      { insert: "\n", attributes: { blockquote: true } },
      { insert: "\n" },
    ]);

    adapter.destroy();
  });

  it("inserts emoji after typed text when caret advanced only via silent selection", async () => {
    const adapter = createMountedAdapter(defaultSnapshot, { start: 0, end: 0 });
    const root = document.querySelector<HTMLElement>(".ql-editor");
    const container = root?.parentElement;
    expect(container).toBeTruthy();

    // Typing advances the caret with Emitter.sources.SILENT, so selection-change
    // listeners never see the new caret — only editor-change does. The adapter
    // must still forward the caret to the host (see "forwards silent caret
    // moves" test); it only uses editor-change for its internal lastSelection.
    const Quill = (await import("quill")).default;
    const quill = Quill.find(container!) as InstanceType<typeof Quill>;
    quill.setSelection(5, 0, Quill.sources.SILENT);

    adapter.blur();
    await Promise.resolve();

    adapter.insertEmoji("party_parrot");
    await Promise.resolve();

    expect(adapter.getSnapshot().content).toEqual([
      { insert: "Hello" },
      { insert: { emoji: "party_parrot" } },
      { insert: "\n" },
    ]);

    adapter.destroy();
  });

  it("forwards silent caret moves (typing) to host listeners as selection-change", async () => {
    const adapter = createMountedAdapter(defaultSnapshot, { start: 0, end: 0 });
    const root = document.querySelector<HTMLElement>(".ql-editor");
    const container = root?.parentElement;
    expect(container).toBeTruthy();

    const events: EditorAdapterEvent[] = [];
    const unsubscribe = adapter.subscribe((event) => events.push(event));

    // Typing advances the caret with Emitter.sources.SILENT, which skips
    // selection-change listeners; the host must still learn the new caret so
    // mentions/emoji inserted later land AFTER the typed text.
    const Quill = (await import("quill")).default;
    const quill = Quill.find(container!) as InstanceType<typeof Quill>;
    adapter.focus();
    quill.setSelection(5, 0, Quill.sources.SILENT);
    await Promise.resolve();

    const selectionEvents = events.filter((event) => event.type === "selection-change");
    expect(selectionEvents.at(-1)).toEqual({
      type: "selection-change",
      selection: { start: 5, end: 5 },
    });

    // A second silent move advances the caret again — identical duplicates are
    // coalesced, but a genuinely new caret must be emitted.
    quill.setSelection(2, 0, Quill.sources.SILENT);
    await Promise.resolve();

    expect(events.filter((event) => event.type === "selection-change").at(-1)).toEqual({
      type: "selection-change",
      selection: { start: 2, end: 2 },
    });

    unsubscribe();
    adapter.destroy();
  });

  it("inserts emoji at silent-advanced caret while editor stays focused", async () => {
    const adapter = createMountedAdapter(defaultSnapshot, { start: 0, end: 0 });
    const root = document.querySelector<HTMLElement>(".ql-editor");
    const container = root?.parentElement;
    expect(container).toBeTruthy();

    const Quill = (await import("quill")).default;
    const quill = Quill.find(container!) as InstanceType<typeof Quill>;
    adapter.focus();
    quill.setSelection(5, 0, Quill.sources.SILENT);
    await Promise.resolve();

    adapter.insertEmoji("party_parrot");
    await Promise.resolve();

    expect(adapter.getSnapshot().content).toEqual([
      { insert: "Hello" },
      { insert: { emoji: "party_parrot" } },
      { insert: "\n" },
    ]);
    expect(adapter.getSelection()).toEqual({ start: 6, end: 6 });

    adapter.destroy();
  });

  it("inserts emoji without refocusing after blur so the host panel can stay open", async () => {
    const adapter = createMountedAdapter(defaultSnapshot, { start: 5, end: 5 });
    const events: EditorAdapterEvent[] = [];
    const unsubscribe = adapter.subscribe((event) => events.push(event));

    adapter.blur();
    await Promise.resolve();
    events.length = 0;

    adapter.insertEmoji("party_parrot");
    await Promise.resolve();

    expect(adapter.getSnapshot().content).toEqual([
      { insert: "Hello" },
      { insert: { emoji: "party_parrot" } },
      { insert: "\n" },
    ]);
    expect(adapter.getState().focused).toBe(false);
    expect(document.activeElement?.classList.contains("ql-editor")).toBe(false);
    expect(document.querySelector(".ql-editor")?.getAttribute("contenteditable")).toBe("true");
    expect(events.filter((event) => event.type === "focus")).toHaveLength(0);

    adapter.insertEmoji("thumbs_up");
    await Promise.resolve();

    expect(adapter.getSnapshot().content).toEqual([
      { insert: "Hello" },
      { insert: { emoji: "party_parrot" } },
      { insert: { emoji: "thumbs_up" } },
      { insert: "\n" },
    ]);
    expect(adapter.getState().focused).toBe(false);
    expect(events.filter((event) => event.type === "focus")).toHaveLength(0);

    unsubscribe();
    adapter.destroy();
  });

  it("keeps the caret after blurred emoji inserts for a following mention", async () => {
    const adapter = createMountedAdapter(defaultSnapshot, { start: 5, end: 5 });

    adapter.blur();
    await Promise.resolve();

    adapter.insertEmoji("party_parrot");
    adapter.insertEmoji("thumbs_up");
    adapter.insertEmoji("heart");
    await Promise.resolve();

    adapter.insertMention({ id: "user-1", sign: "!", displayText: "Alice" });

    expect(adapter.getSnapshot().content).toEqual([
      { insert: "Hello" },
      { insert: { emoji: "party_parrot" } },
      { insert: { emoji: "thumbs_up" } },
      { insert: { emoji: "heart" } },
      {
        insert: { mention: "user-1" },
        attributes: { sign: "!", displayText: "Alice" },
      },
      { insert: " \n" },
    ]);
    // Blurred embed inserts must not call setSelection (that focuses the root
    // under a Flutter overlay and can kill WKWebView firstResponder).
    expect(adapter.getState().focused).toBe(false);
    expect(adapter.getSelection()).toBeNull();

    adapter.focus();
    expect(adapter.getSelection()).toEqual({ start: 10, end: 10 });

    adapter.destroy();
  });

  it("inserts a mention while focused without keeping DOM focus", async () => {
    const adapter = createMountedAdapter(defaultSnapshot, { start: 5, end: 5 });
    adapter.focus();
    await Promise.resolve();
    expect(adapter.getState().focused).toBe(true);

    adapter.insertMention({ id: "user-1", sign: "!", displayText: "Alice" });
    await Promise.resolve();

    expect(adapter.getSnapshot().content).toEqual([
      { insert: "Hello" },
      {
        insert: { mention: "user-1" },
        attributes: { sign: "!", displayText: "Alice" },
      },
      { insert: " \n" },
    ]);
    // Focused host embeds still blur so Flutter can reclaim AppKit firstResponder.
    expect(adapter.getState().focused).toBe(false);
    expect(document.activeElement?.classList.contains("ql-editor")).toBe(false);

    adapter.focus();
    expect(adapter.getSelection()).toEqual({ start: 7, end: 7 });

    adapter.destroy();
  });

  it.each([
    ["emoji", (adapter: ReturnType<typeof createMountedAdapter>) => adapter.insertEmoji("wave")],
    [
      "mention",
      (adapter: ReturnType<typeof createMountedAdapter>) =>
        adapter.insertMention({ id: "user-1", sign: "!", displayText: "Alice" }),
    ],
    [
      "channel",
      (adapter: ReturnType<typeof createMountedAdapter>) =>
        adapter.insertChannel({ id: "channel-1", displayText: "general" }),
    ],
    [
      "link",
      (adapter: ReturnType<typeof createMountedAdapter>) =>
        adapter.insertLink({ url: "https://teamgaga.com", text: "TeamGaga" }),
    ],
    ["divider", (adapter: ReturnType<typeof createMountedAdapter>) => adapter.insertDivider()],
    [
      "image",
      (adapter: ReturnType<typeof createMountedAdapter>) =>
        adapter.insertImage({
          src: "tgg-local-media://image-token",
          width: "640",
          height: "480",
          mimeType: "image/png",
          fileSize: 12,
        }),
    ],
    [
      "video",
      (adapter: ReturnType<typeof createMountedAdapter>) =>
        adapter.insertVideo({
          src: "tgg-local-media://video-token",
          width: "1280",
          height: "720",
          mimeType: "video/mp4",
          fileSize: 42,
        }),
    ],
  ])("scrolls the post-insert %s caret into view", async (_name, insert) => {
    const adapter = createMountedAdapter(defaultSnapshot, { start: 5, end: 5 });
    const container = document.querySelector<HTMLElement>(".ql-container");
    expect(container).toBeTruthy();

    const Quill = (await import("quill")).default;
    const quill = Quill.find(container!) as InstanceType<typeof Quill>;
    const scrollWrites = makeScrollPortScrollable(container!);
    setOutOfViewCaret(quill);

    insert(adapter);
    // ensureSelectionVisible uses double rAF for post-layout geometry.
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
    );

    expect(scrollWrites()).toBeGreaterThan(0);
    adapter.destroy();
  });

  it("scrolls into view after Enter on an empty line (null getBounds fallback)", async () => {
    const adapter = createMountedAdapter(defaultSnapshot, { start: 5, end: 5 });
    adapter.focus();
    const container = document.querySelector<HTMLElement>(".ql-container");
    expect(container).toBeTruthy();

    const Quill = (await import("quill")).default;
    const quill = Quill.find(container!) as InstanceType<typeof Quill>;
    const scrollWrites = makeScrollPortScrollable(container!);
    // Simulate empty-line geometry failure that WKWebView hits after Enter.
    quill.selection.getBounds = () => null;

    const nativeGetLine = quill.getLine.bind(quill);
    quill.getLine = ((index: number) => {
      const result = nativeGetLine(index);
      const lineNode = result[0]?.domNode;
      if (lineNode instanceof HTMLElement) {
        lineNode.getBoundingClientRect = () =>
          ({ top: 150, right: 20, bottom: 170, left: 10, width: 10, height: 20 }) as DOMRect;
      }
      return result;
    }) as typeof quill.getLine;
    const root = document.querySelector<HTMLElement>(".ql-editor");
    root?.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
    );

    expect(scrollWrites()).toBeGreaterThan(0);
    adapter.destroy();
  });

  it("scrolls into view when a focused text-change moves the caret", async () => {
    const adapter = createMountedAdapter(defaultSnapshot, { start: 5, end: 5 });
    adapter.focus();
    const container = document.querySelector<HTMLElement>(".ql-container");
    expect(container).toBeTruthy();

    const Quill = (await import("quill")).default;
    const quill = Quill.find(container!) as InstanceType<typeof Quill>;
    const scrollWrites = makeScrollPortScrollable(container!);
    setOutOfViewCaret(quill);

    quill.insertText(5, "!", "user");
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
    );

    expect(scrollWrites()).toBeGreaterThan(0);
    adapter.destroy();
  });

  it("publishes cleared inline formats immediately after Enter", async () => {
    const adapter = createMountedAdapter(defaultSnapshot, { start: 5, end: 5 });
    const states: EditorState[] = [];
    const unsubscribe = adapter.subscribe((event) => {
      if (event.type === "state-change") {
        states.push(event.state);
      }
    });

    adapter.execute({ type: "toggle-inline-format", format: "bold" });
    adapter.execute({ type: "toggle-inline-format", format: "italic" });
    adapter.execute({ type: "toggle-inline-format", format: "underline" });
    states.length = 0;

    const root = document.querySelector<HTMLElement>(".ql-editor");
    root?.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    await Promise.resolve();

    expect(states).toHaveLength(1);
    expect(states.at(-1)?.selection).toEqual({ start: 6, end: 6 });
    expect(states.at(-1)?.formats).toMatchObject({
      bold: false,
      italic: false,
      underline: false,
    });

    unsubscribe();
    adapter.destroy();
  });

  it("preserves caret position after toggling block formats while blurred and focusing back", async () => {
    const adapter = createMountedAdapter(
      {
        content: [{ insert: "First line\nSecond line\n" }],
      },
      { start: 15, end: 15 },
    );

    adapter.blur();
    await Promise.resolve();

    expect(adapter.getState().focused).toBe(false);

    // Toggle H1 on second line while blurred
    adapter.execute({ type: "toggle-block-format", format: "header", value: 1 });
    expect(adapter.getState().formats.header).toBe(1);

    // Focus back — must restore caret to index 15
    adapter.focus();
    await Promise.resolve();

    expect(adapter.getState()).toMatchObject({
      focused: true,
      selection: { start: 15, end: 15 },
      formats: { header: 1 },
    });

    adapter.destroy();
  });

  it("preserves selection range across blurred inline and block format changes", async () => {
    const adapter = createMountedAdapter(
      {
        content: [{ insert: "Hello world\n" }],
      },
      { start: 0, end: 5 },
    );

    adapter.blur();
    await Promise.resolve();

    adapter.execute({ type: "toggle-inline-format", format: "bold" });
    adapter.execute({ type: "toggle-block-format", format: "blockquote" });

    adapter.focus();
    await Promise.resolve();

    expect(adapter.getState()).toMatchObject({
      focused: true,
      selection: { start: 0, end: 5 },
      formats: { bold: true, blockquote: true },
    });

    adapter.destroy();
  });
});
