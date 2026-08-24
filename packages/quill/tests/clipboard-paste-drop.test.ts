import { afterEach, describe, expect, it } from "vite-plus/test";
import type { RichTextSnapshotV1 } from "@teamgaga/richtext-delta";
import type { EditorEvent, PasteMediaPayload } from "@teamgaga/richtext-core";
import { createQuillAdapter } from "../src/adapter";
import { createEmojiRegistry } from "../src/emoji/registry";

const defaultSnapshot: RichTextSnapshotV1 = {
  content: [{ insert: "Hello" }, { insert: "\n" }],
};

// Quill's Scroll always re-serializes an unformatted line as one merged
// text+newline op, regardless of the exact op boundaries it was set with.
const unchangedContent = [{ insert: "Hello\n" }];

function createMountedAdapter(
  snapshot: RichTextSnapshotV1 = defaultSnapshot,
  options: { emojiRegistry?: ReturnType<typeof createEmojiRegistry> } = {},
) {
  const element = document.createElement("div");
  document.body.append(element);
  const adapter = createQuillAdapter({ element, emojiRegistry: options.emojiRegistry });
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

function dispatchCopy(clipboardData: DataTransfer): ClipboardEvent {
  const event = new ClipboardEvent("copy", { clipboardData, bubbles: true, cancelable: true });
  getEditorRoot().dispatchEvent(event);
  return event;
}

function dispatchCut(clipboardData: DataTransfer): ClipboardEvent {
  const event = new ClipboardEvent("cut", { clipboardData, bubbles: true, cancelable: true });
  getEditorRoot().dispatchEvent(event);
  return event;
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("text, inline-embed, divider, and media clipboard/drop policy (ADR-0008 / ADR-0007 / ADR-0006)", () => {
  describe("Paste / Drop", () => {
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

    it("pastes mention, channel, and emoji inline embeds from HTML with canonical snapshot", () => {
      const adapter = createMountedAdapter({ content: [{ insert: "\n" }] });
      adapter.setSelection({ start: 0, end: 0 });

      const clipboardData = new DataTransfer();
      clipboardData.setData(
        "text/html",
        '<p>Hi <span class="tgg-mention" data-id="u1" data-sign="!" data-display="Alice">@Alice</span> in <span class="tgg-channel" data-id="c1" data-display="general">#general</span> <span class="tgg-emoji" data-emoji-id="party_parrot">:party_parrot:</span></p>',
      );
      dispatchPaste(clipboardData);

      expect(adapter.getSnapshot().content).toEqual([
        { insert: "Hi " },
        { insert: { mention: "u1" }, attributes: { sign: "!", displayText: "Alice" } },
        { insert: " in " },
        { insert: { channel: "c1" }, attributes: { displayText: "general" } },
        { insert: " " },
        { insert: { emoji: "party_parrot" } },
        { insert: "\n" },
      ]);

      adapter.destroy();
    });

    it("pastes self-produced image blot HTML into Delta with full attributes (ADR-0008)", () => {
      const adapter = createMountedAdapter({ content: [{ insert: "\n" }] });
      adapter.setSelection({ start: 0, end: 0 });

      const clipboardData = new DataTransfer();
      clipboardData.setData(
        "text/html",
        '<p>Before</p><img class="tgg-image" data-src="tgg-local-media://uuid1" width="300" height="200" data-mime-type="image/png" data-file-size="4096"><p>After</p>',
      );
      dispatchPaste(clipboardData);

      expect(adapter.getSnapshot().content).toEqual([
        { insert: "Before\n" },
        {
          insert: { image: "tgg-local-media://uuid1" },
          attributes: { width: "300", height: "200", mimeType: "image/png", fileSize: 4096 },
        },
        { insert: "After\n" },
      ]);

      adapter.destroy();
    });

    it("pastes self-produced video blot HTML into Delta with full attributes (ADR-0008)", () => {
      const adapter = createMountedAdapter({ content: [{ insert: "\n" }] });
      adapter.setSelection({ start: 0, end: 0 });

      const clipboardData = new DataTransfer();
      clipboardData.setData(
        "text/html",
        '<p>Video:</p><div class="tgg-video" data-src="tgg-local-media://uuid2" width="640" height="360" data-mime-type="video/mp4" data-file-size="8192" data-poster="https://example.com/p.jpg" data-duration="42"><video class="tgg-video__media"></video></div><p>Done</p>',
      );
      dispatchPaste(clipboardData);

      expect(adapter.getSnapshot().content).toEqual([
        { insert: "Video:\n" },
        {
          insert: { video: "tgg-local-media://uuid2" },
          attributes: {
            width: "640",
            height: "360",
            mimeType: "video/mp4",
            fileSize: 8192,
            poster: "https://example.com/p.jpg",
            duration: 42,
          },
        },
        { insert: "Done\n" },
      ]);

      adapter.destroy();
    });

    it("pastes HTML with mixed inline embeds and stripped foreign media", () => {
      const adapter = createMountedAdapter({ content: [{ insert: "\n" }] });
      adapter.setSelection({ start: 0, end: 0 });

      const clipboardData = new DataTransfer();
      clipboardData.setData(
        "text/html",
        '<p>Text <span class="tgg-mention" data-id="u1" data-sign="&" data-display="Staff">@Staff</span><img class="foreign-image" src="https://example.com/bad.png"><span class="tgg-emoji" data-emoji-id="tada">:tada:</span></p>',
      );
      dispatchPaste(clipboardData);

      expect(adapter.getSnapshot().content).toEqual([
        { insert: "Text " },
        { insert: { mention: "u1" }, attributes: { sign: "&", displayText: "Staff" } },
        { insert: { emoji: "tada" } },
        { insert: "\n" },
      ]);

      adapter.destroy();
    });

    it("pastes HTML with preserved dividers (ADR-0007)", () => {
      const adapter = createMountedAdapter({ content: [{ insert: "\n" }] });
      adapter.setSelection({ start: 0, end: 0 });

      const clipboardData = new DataTransfer();
      clipboardData.setData(
        "text/html",
        '<p><span class="tgg-mention" data-id="u1" data-sign="!" data-display="Alice">@Alice</span></p><hr class="tgg-divider"><p><span class="tgg-channel" data-id="c1" data-display="general">#general</span></p>',
      );
      dispatchPaste(clipboardData);

      expect(adapter.getSnapshot().content).toEqual([
        { insert: { mention: "u1" }, attributes: { sign: "!", displayText: "Alice" } },
        { insert: "\n" },
        { insert: { divider: "true" } },
        { insert: { channel: "c1" }, attributes: { displayText: "general" } },
        { insert: "\n" },
      ]);

      adapter.destroy();
    });

    it("pastes external HTML <hr> without class as a divider (ADR-0007)", () => {
      const adapter = createMountedAdapter({ content: [{ insert: "\n" }] });
      adapter.setSelection({ start: 0, end: 0 });

      const clipboardData = new DataTransfer();
      clipboardData.setData("text/html", "<p>Above</p><hr><p>Below</p>");
      dispatchPaste(clipboardData);

      expect(adapter.getSnapshot().content).toEqual([
        { insert: "Above\n" },
        { insert: { divider: "true" } },
        { insert: "Below\n" },
      ]);

      adapter.destroy();
    });

    it("drops mention, channel, emoji, and divider embeds from HTML", () => {
      const adapter = createMountedAdapter({ content: [{ insert: "\n" }] });
      adapter.setSelection({ start: 0, end: 0 });

      const dataTransfer = new DataTransfer();
      dataTransfer.setData(
        "text/html",
        '<p><span class="tgg-channel" data-id="c2" data-display="dev">#dev</span> <span class="tgg-emoji" data-emoji-id="star">:star:</span></p><hr><p>End</p>',
      );
      dispatchDrop(dataTransfer);

      expect(adapter.getSnapshot().content).toEqual([
        { insert: { channel: "c2" }, attributes: { displayText: "dev" } },
        { insert: " " },
        { insert: { emoji: "star" } },
        { insert: "\n" },
        { insert: { divider: "true" } },
        { insert: "End\n" },
      ]);

      adapter.destroy();
    });

    it("does not upgrade plain text @Alice, #general, :tada:, or --- to embeds", () => {
      const adapter = createMountedAdapter({ content: [{ insert: "\n" }] });
      adapter.setSelection({ start: 0, end: 0 });

      const clipboardData = new DataTransfer();
      clipboardData.setData("text/plain", "@Alice in #general :tada:\n---");
      dispatchPaste(clipboardData);

      expect(adapter.getSnapshot().content).toEqual([
        { insert: "@Alice in #general :tada:\n---\n" },
      ]);

      adapter.destroy();
    });

    it("does not upgrade foreign mention-like HTML without tgg-mention class to embeds", () => {
      const adapter = createMountedAdapter({ content: [{ insert: "\n" }] });
      adapter.setSelection({ start: 0, end: 0 });

      const clipboardData = new DataTransfer();
      clipboardData.setData(
        "text/html",
        '<p><span data-id="u1" data-display="ForeignUser">@ForeignUser</span></p>',
      );
      dispatchPaste(clipboardData);

      expect(adapter.getSnapshot().content).toEqual([{ insert: "@ForeignUser\n" }]);

      adapter.destroy();
    });

    it("downgrades mentions and channels without ID to plain text", () => {
      const adapter = createMountedAdapter({ content: [{ insert: "\n" }] });
      adapter.setSelection({ start: 0, end: 0 });

      const clipboardData = new DataTransfer();
      clipboardData.setData(
        "text/html",
        '<p><span class="tgg-mention" data-id="" data-display="Ghost">@Ghost</span> and <span class="tgg-channel" data-id="" data-display="lobby">#lobby</span></p>',
      );
      dispatchPaste(clipboardData);

      expect(adapter.getSnapshot().content).toEqual([{ insert: "@Ghost and #lobby\n" }]);

      adapter.destroy();
    });

    it("discards mentions and channels with ID but missing displayText without leaking ID", () => {
      const adapter = createMountedAdapter({ content: [{ insert: "\n" }] });
      adapter.setSelection({ start: 0, end: 0 });

      const clipboardData = new DataTransfer();
      clipboardData.setData(
        "text/html",
        '<p>Before <span class="tgg-mention" data-id="secret_u123" data-display=""></span> <span class="tgg-channel" data-id="secret_c456" data-display=""></span> After</p>',
      );
      dispatchPaste(clipboardData);

      expect(adapter.getSnapshot().content).toEqual([{ insert: "Before   After\n" }]);

      adapter.destroy();
    });

    it("defaults missing or invalid sign to '!' for mentions", () => {
      const adapter = createMountedAdapter({ content: [{ insert: "\n" }] });
      adapter.setSelection({ start: 0, end: 0 });

      const clipboardData = new DataTransfer();
      clipboardData.setData(
        "text/html",
        '<p><span class="tgg-mention" data-id="u1" data-display="Alice">@Alice</span> <span class="tgg-mention" data-id="u2" data-sign="invalid" data-display="Bob">@Bob</span></p>',
      );
      dispatchPaste(clipboardData);

      expect(adapter.getSnapshot().content).toEqual([
        { insert: { mention: "u1" }, attributes: { sign: "!", displayText: "Alice" } },
        { insert: " " },
        { insert: { mention: "u2" }, attributes: { sign: "!", displayText: "Bob" } },
        { insert: "\n" },
      ]);

      adapter.destroy();
    });

    it("preserves unregistered emoji id as an emoji entity in snapshot", () => {
      const registry = createEmojiRegistry([
        { id: "known_emoji", src: "https://example.com/known.png" },
      ]);
      const adapter = createMountedAdapter(
        { content: [{ insert: "\n" }] },
        { emojiRegistry: registry },
      );
      adapter.setSelection({ start: 0, end: 0 });

      const clipboardData = new DataTransfer();
      clipboardData.setData(
        "text/html",
        '<p><span class="tgg-emoji" data-emoji-id="unknown_remote_id">:unknown_remote_id:</span></p>',
      );
      dispatchPaste(clipboardData);

      expect(adapter.getSnapshot().content).toEqual([
        { insert: { emoji: "unknown_remote_id" } },
        { insert: "\n" },
      ]);

      adapter.destroy();
    });

    it("strips foreign img/video embeds from pasted HTML while keeping surrounding text", () => {
      const adapter = createMountedAdapter({ content: [{ insert: "\n" }] });

      const clipboardData = new DataTransfer();
      clipboardData.setData("text/html", '<p>Before<img src="https://example.com/a.png">After</p>');
      dispatchPaste(clipboardData);

      expect(adapter.getSnapshot().content).toEqual([{ insert: "BeforeAfter\n" }]);

      adapter.destroy();
    });

    it("drops a foreign image-only clipboard payload without inserting anything", () => {
      const adapter = createMountedAdapter();
      adapter.setSelection({ start: 5, end: 5 });

      const clipboardData = new DataTransfer();
      clipboardData.setData("text/html", '<img src="https://example.com/a.png">');
      dispatchPaste(clipboardData);

      expect(adapter.getSnapshot().content).toEqual(unchangedContent);

      adapter.destroy();
    });

    it("intercepts clipboard media file and emits paste-media event (ADR-0008)", async () => {
      const adapter = createMountedAdapter();
      adapter.setSelection({ start: 5, end: 5 });

      let receivedPayload: PasteMediaPayload | undefined;
      adapter.subscribe((event: EditorEvent) => {
        if (event.type === "paste-media") {
          receivedPayload = event.payload;
        }
      });

      const clipboardData = new DataTransfer();
      const file = new File(["binary-image-data"], "screenshot.png", { type: "image/png" });
      clipboardData.items.add(file);

      const event = dispatchPaste(clipboardData);
      expect(event.defaultPrevented).toBe(true);

      // Wait a tick for async file probe
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(receivedPayload).toBeDefined();
      const payload = receivedPayload as unknown as PasteMediaPayload;
      expect(payload.mimeType).toBe("image/png");
      expect(payload.fileName).toBe("screenshot.png");
      expect(payload.isVideo).toBe(false);
      expect(typeof payload.dataBase64).toBe("string");
      expect(payload.selection).toEqual({ start: 5, end: 5 });

      // Delta content is unchanged until host inserts
      expect(adapter.getSnapshot().content).toEqual(unchangedContent);

      adapter.destroy();
    });

    it("intercepts dropped media file and emits paste-media event (ADR-0008)", async () => {
      const adapter = createMountedAdapter();
      adapter.setSelection({ start: 2, end: 2 });

      let receivedPayload: PasteMediaPayload | undefined;
      adapter.subscribe((event: EditorEvent) => {
        if (event.type === "paste-media") {
          receivedPayload = event.payload;
        }
      });

      const dataTransfer = new DataTransfer();
      const file = new File(["video-bytes"], "clip.mp4", { type: "video/mp4" });
      dataTransfer.items.add(file);

      const event = dispatchDrop(dataTransfer);
      expect(event.defaultPrevented).toBe(true);

      // Wait a tick for async file probe
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(receivedPayload).toBeDefined();
      const payload = receivedPayload as unknown as PasteMediaPayload;
      expect(payload.mimeType).toBe("video/mp4");
      expect(payload.fileName).toBe("clip.mp4");
      expect(payload.isVideo).toBe(true);
      expect(typeof payload.dataBase64).toBe("string");

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

  describe("Copy / Cut", () => {
    it("populates formatted text/plain and rich text/html without <img>, src, or data-emoji-missing on copy for inline emoji", () => {
      const adapter = createMountedAdapter({
        content: [
          { insert: "Hi " },
          { insert: { mention: "u1" }, attributes: { sign: "!", displayText: "Bob" } },
          { insert: " in " },
          { insert: { channel: "c1" }, attributes: { displayText: "general" } },
          { insert: " " },
          { insert: { emoji: "tada" } },
          { insert: "\n" },
        ],
      });
      adapter.setSelection({ start: 0, end: 12 });

      const clipboardData = new DataTransfer();
      dispatchCopy(clipboardData);

      expect(clipboardData.getData("text/plain")).toBe("Hi @Bob in #general :tada:");

      const html = clipboardData.getData("text/html");
      expect(html).toContain('class="tgg-mention"');
      expect(html).toContain('data-id="u1"');
      expect(html).toContain('data-display="Bob"');
      expect(html).toContain('class="tgg-channel"');
      expect(html).toContain('data-id="c1"');
      expect(html).toContain('data-display="general"');
      expect(html).toContain('class="tgg-emoji"');
      expect(html).toContain('data-emoji-id="tada"');
      expect(html).toContain('<span class="tgg-emoji" data-emoji-id="tada">:tada:</span>');

      // Ensure NO <img>, NO src=, NO data-emoji-missing
      expect(html).not.toContain("<img");
      expect(html).not.toContain("src=");
      expect(html).not.toContain("data-emoji-missing");

      adapter.destroy();
    });

    it("preserves self-produced image and video blots in copy HTML and outputs [图片]/[视频] in plain text (ADR-0008)", () => {
      const adapter = createMountedAdapter({
        content: [
          { insert: "Text before\n" },
          {
            insert: { image: "tgg-local-media://uuid1" },
            attributes: { width: "100", height: "100", mimeType: "image/png", fileSize: 1024 },
          },
          {
            insert: { video: "tgg-local-media://uuid2" },
            attributes: { width: "200", height: "150", mimeType: "video/mp4", fileSize: 2048 },
          },
          { insert: { divider: "true" } },
          { insert: "Text after\n" },
        ],
      });
      adapter.setSelection({ start: 0, end: 26 });

      const clipboardData = new DataTransfer();
      dispatchCopy(clipboardData);

      const text = clipboardData.getData("text/plain");
      expect(text).toContain("[图片]");
      expect(text).toContain("[视频]");
      expect(text).toContain("Text before\n");
      expect(text).toContain("---\n");
      expect(text).toContain("Text after");

      const html = clipboardData.getData("text/html");
      expect(html).toContain('class="tgg-image"');
      expect(html).toContain('data-src="tgg-local-media://uuid1"');
      expect(html).toContain('class="tgg-video"');
      expect(html).toContain('data-src="tgg-local-media://uuid2"');
      expect(html).toContain("<hr");

      adapter.destroy();
    });

    it("deletes selection and populates clipboard on cut", () => {
      const adapter = createMountedAdapter({
        content: [
          { insert: "Cut " },
          { insert: { mention: "u1" }, attributes: { sign: "!", displayText: "Bob" } },
          { insert: " after\n" },
        ],
      });
      adapter.setSelection({ start: 4, end: 5 });

      const clipboardData = new DataTransfer();
      dispatchCut(clipboardData);

      expect(clipboardData.getData("text/plain")).toBe("@Bob");
      expect(clipboardData.getData("text/html")).toContain('class="tgg-mention" data-id="u1"');
      expect(adapter.getSnapshot().content).toEqual([{ insert: "Cut  after\n" }]);

      adapter.destroy();
    });

    it("cutting a selection containing a divider deletes the divider and keeps it on clipboard (ADR-0007)", () => {
      const adapter = createMountedAdapter({
        content: [{ insert: "Before\n" }, { insert: { divider: "true" } }, { insert: "After\n" }],
      });
      // Selection covers the divider (index 7, length 1)
      adapter.setSelection({ start: 7, end: 8 });

      const clipboardData = new DataTransfer();
      dispatchCut(clipboardData);

      // Divider is copied to clipboard
      expect(clipboardData.getData("text/html")).toContain("<hr");
      expect(clipboardData.getData("text/plain")).toBe("---\n");

      // Document no longer has the divider
      expect(adapter.getSnapshot().content).toEqual([{ insert: "Before\nAfter\n" }]);

      // Paste it back
      dispatchPaste(clipboardData);
      expect(adapter.getSnapshot().content).toEqual([
        { insert: "Before\n" },
        { insert: { divider: "true" } },
        { insert: "After\n" },
      ]);

      adapter.destroy();
    });

    it("cutting a selection containing an image deletes the image from doc and keeps it in clipboard (ADR-0008)", () => {
      const adapter = createMountedAdapter({
        content: [
          {
            insert: { image: "tgg-local-media://uuid1" },
            attributes: { width: "100", height: "100", mimeType: "image/png", fileSize: 1024 },
          },
          { insert: "After\n" },
        ],
      });
      // Selection covers the image (0..1)
      adapter.setSelection({ start: 0, end: 1 });

      const clipboardData = new DataTransfer();
      dispatchCut(clipboardData);

      // Image is retained in clipboard HTML & plain text fallback
      expect(clipboardData.getData("text/html")).toContain('class="tgg-image"');
      expect(clipboardData.getData("text/plain")).toBe("[图片]\n");

      // Document no longer has the image
      expect(adapter.getSnapshot().content).toEqual([{ insert: "After\n" }]);

      // Paste it back
      dispatchPaste(clipboardData);
      expect(adapter.getSnapshot().content).toEqual([
        {
          insert: { image: "tgg-local-media://uuid1" },
          attributes: { width: "100", height: "100", mimeType: "image/png", fileSize: 1024 },
        },
        { insert: "After\n" },
      ]);

      adapter.destroy();
    });
  });
});
