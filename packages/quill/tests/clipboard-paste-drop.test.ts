import { afterEach, describe, expect, it } from "vite-plus/test";
import type { RichTextSnapshotV1 } from "@teamgaga/richtext-delta";
import { createQuillAdapter } from "../src/adapter";

const defaultSnapshot: RichTextSnapshotV1 = {
  content: [{ insert: "Hello" }, { insert: "\n" }],
};

// Quill's Scroll always re-serializes an unformatted line as one merged
// text+newline op, regardless of the exact op boundaries it was set with.
const unchangedContent = [{ insert: "Hello\n" }];

function createMountedAdapter(snapshot: RichTextSnapshotV1 = defaultSnapshot) {
  const element = document.createElement("div");
  document.body.append(element);
  const adapter = createQuillAdapter({ element });
  adapter.setSnapshot(snapshot);
  return adapter;
}

function getEditorRoot(): HTMLElement {
  const root = document.querySelector<HTMLElement>(".ql-editor");
  if (!root) {
    throw new Error("editor root is not mounted");
  }
  return root;
}

function dispatchPaste(clipboardData: DataTransfer): ClipboardEvent {
  const event = new ClipboardEvent("paste", { clipboardData, bubbles: true, cancelable: true });
  getEditorRoot().dispatchEvent(event);
  return event;
}

function dispatchDrop(dataTransfer: DataTransfer): Event {
  const event = new Event("drop", { bubbles: true, cancelable: true });
  Object.defineProperty(event, "dataTransfer", { value: dataTransfer, configurable: true });
  getEditorRoot().dispatchEvent(event);
  return event;
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("text-only clipboard/drop policy (ADR-0016)", () => {
  it("pastes plain text at the caret", () => {
    const adapter = createMountedAdapter();
    adapter.setSelection({ start: 5, end: 5 });

    const clipboardData = new DataTransfer();
    clipboardData.setData("text/plain", " world");
    const event = dispatchPaste(clipboardData);

    expect(event.defaultPrevented).toBe(true);
    expect(adapter.getSnapshot().content).toEqual([{ insert: "Hello world\n" }]);

    adapter.destroy();
  });

  it("preserves supported inline formats from pasted rich-text HTML", () => {
    const adapter = createMountedAdapter();
    adapter.setSelection({ start: 5, end: 5 });

    const clipboardData = new DataTransfer();
    clipboardData.setData("text/html", "<p><strong>!</strong></p>");
    clipboardData.setData("text/plain", "!");
    dispatchPaste(clipboardData);

    expect(adapter.getSnapshot().content).toEqual([
      { insert: "Hello" },
      { insert: "!", attributes: { bold: true } },
      { insert: "\n" },
    ]);

    adapter.destroy();
  });

  it("strips img/video embeds from pasted HTML while keeping surrounding text", () => {
    const adapter = createMountedAdapter({ content: [{ insert: "\n" }] });

    const clipboardData = new DataTransfer();
    clipboardData.setData("text/html", '<p>Before<img src="https://example.com/a.png">After</p>');
    dispatchPaste(clipboardData);

    expect(adapter.getSnapshot().content).toEqual([{ insert: "BeforeAfter\n" }]);

    adapter.destroy();
  });

  it("drops an image-only clipboard payload without inserting anything", () => {
    const adapter = createMountedAdapter();
    adapter.setSelection({ start: 5, end: 5 });

    const clipboardData = new DataTransfer();
    clipboardData.setData("text/html", '<img src="https://example.com/a.png">');
    dispatchPaste(clipboardData);

    expect(adapter.getSnapshot().content).toEqual(unchangedContent);

    adapter.destroy();
  });

  it("ignores clipboard files entirely — no upload, no placeholder, no error", () => {
    const adapter = createMountedAdapter();
    adapter.setSelection({ start: 5, end: 5 });

    const clipboardData = new DataTransfer();
    const file = new File(["binary"], "photo.png", { type: "image/png" });
    clipboardData.items.add(file);

    expect(() => dispatchPaste(clipboardData)).not.toThrow();
    expect(adapter.getSnapshot().content).toEqual(unchangedContent);

    adapter.destroy();
  });

  it("keeps pasted text when the clipboard has both text and files", () => {
    const adapter = createMountedAdapter();
    adapter.setSelection({ start: 5, end: 5 });

    const clipboardData = new DataTransfer();
    clipboardData.setData("text/plain", " world");
    const file = new File(["binary"], "photo.png", { type: "image/png" });
    clipboardData.items.add(file);

    dispatchPaste(clipboardData);

    expect(adapter.getSnapshot().content).toEqual([{ insert: "Hello world\n" }]);

    adapter.destroy();
  });

  it("drops plain text at the caret", () => {
    const adapter = createMountedAdapter();
    adapter.setSelection({ start: 5, end: 5 });

    const dataTransfer = new DataTransfer();
    dataTransfer.setData("text/plain", " world");
    const event = dispatchDrop(dataTransfer);

    expect(event.defaultPrevented).toBe(true);
    expect(adapter.getSnapshot().content).toEqual([{ insert: "Hello world\n" }]);

    adapter.destroy();
  });

  it("ignores dropped files entirely — no upload, no placeholder, no error", () => {
    const adapter = createMountedAdapter();
    adapter.setSelection({ start: 5, end: 5 });

    const dataTransfer = new DataTransfer();
    const file = new File(["binary"], "photo.png", { type: "image/png" });
    dataTransfer.items.add(file);

    expect(() => dispatchDrop(dataTransfer)).not.toThrow();
    expect(adapter.getSnapshot().content).toEqual(unchangedContent);

    adapter.destroy();
  });

  it("strips embeds from dropped rich-text HTML while keeping surrounding text", () => {
    const adapter = createMountedAdapter({ content: [{ insert: "\n" }] });

    const dataTransfer = new DataTransfer();
    dataTransfer.setData("text/html", '<p>Before<img src="https://example.com/a.png">After</p>');
    dispatchDrop(dataTransfer);

    expect(adapter.getSnapshot().content).toEqual([{ insert: "BeforeAfter\n" }]);

    adapter.destroy();
  });

  it("never lets the default uploader read files as data URLs", async () => {
    const adapter = createMountedAdapter();
    const container = document.querySelector<HTMLElement>(".ql-container");
    expect(container).toBeTruthy();

    const Quill = (await import("quill")).default;
    const quill = Quill.find(container!) as InstanceType<typeof Quill>;

    // The stock Quill uploader would insert an `image` embed from a data URL;
    // our replacement must be a no-op regardless of what it's called with.
    const file = new File(["binary"], "photo.png", { type: "image/png" });
    expect(() => quill.uploader.upload({ index: 0, length: 0 }, [file])).not.toThrow();
    await Promise.resolve();

    expect(adapter.getSnapshot().content).toEqual(unchangedContent);

    adapter.destroy();
  });
});
