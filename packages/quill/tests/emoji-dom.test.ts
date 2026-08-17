import { afterEach, describe, expect, it } from "vite-plus/test";
import { createQuillAdapter } from "../src/adapter";
import { createEmojiRegistry } from "../src/emoji/registry";

afterEach(() => {
  document.body.innerHTML = "";
});

describe("emoji embed DOM shape", () => {
  it("renders the emoji as a span wrapper with an inner img, never an img blot node", () => {
    const element = document.createElement("div");
    document.body.append(element);
    const adapter = createQuillAdapter({ element });

    adapter.setSnapshot({
      content: [{ insert: { emoji: "wave" } }, { insert: "\n" }],
    });

    // The blot itself cannot be a void <img>: WebKit needs a real inline
    // boundary after it, and EmojiBlot must be able to own the rendered image
    // without putting IME composition into Quill's \uFEFF caret guards.
    const blot = element.querySelector<HTMLElement>("span.tgg-emoji[data-emoji-id='wave']");
    expect(blot).toBeTruthy();
    expect(blot!.querySelector("img")).toBeTruthy();
    expect(element.querySelector("img.tgg-emoji")).toBeNull();

    expect(adapter.getSnapshot().content).toEqual([
      { insert: { emoji: "wave" } },
      { insert: "\n" },
    ]);

    adapter.destroy();
  });

  it("restores the native caret after a guard-free emoji blot", async () => {
    const element = document.createElement("div");
    document.body.append(element);
    const adapter = createQuillAdapter({ element });

    adapter.setSnapshot({ content: [{ insert: "Hello\n" }] });
    adapter.setSelection({ start: 5, end: 5 });
    adapter.blur();
    await Promise.resolve();

    adapter.insertEmoji("wave");
    adapter.focus();
    await Promise.resolve();

    const blot = element.querySelector<HTMLElement>("span.tgg-emoji[data-emoji-id='wave']");
    const selection = window.getSelection();
    const parent = blot?.parentNode;
    const blotOffset = Array.from(parent?.childNodes ?? []).indexOf(blot!);

    // The wrapper must remain in the editable flow. In WKWebView, collapsing a
    // range after a terminal contenteditable=false inline node keeps the
    // logical selection there but paints the blinking caret at the far edge of
    // the editor, making it appear lost.
    expect(blot?.hasAttribute("contenteditable")).toBe(false);
    expect(
      Array.from(blot?.childNodes ?? []).some((node) => node.nodeType === Node.TEXT_NODE),
    ).toBe(false);
    expect(selection?.anchorNode).toBe(parent);
    expect(selection?.anchorOffset).toBe(blotOffset + 1);
    expect(adapter.getSelection()).toEqual({ start: 6, end: 6 });

    adapter.destroy();
  });

  it("advances the caret while WebKit composes CJK text after an emoji", async () => {
    const element = document.createElement("div");
    document.body.append(element);
    const adapter = createQuillAdapter({ element });

    adapter.setSnapshot({ content: [{ insert: "\n" }] });
    adapter.setSelection({ start: 0, end: 0 });
    adapter.blur();
    await Promise.resolve();
    adapter.insertEmoji("wave");
    adapter.focus();
    await Promise.resolve();

    const editor = element.querySelector<HTMLElement>(".ql-editor");
    const blot = editor?.querySelector<HTMLElement>("span.tgg-emoji[data-emoji-id='wave']");
    const nativeSelection = window.getSelection();
    const parent = blot?.parentNode;
    const blotOffset = Array.from(parent?.childNodes ?? []).indexOf(blot!);

    expect(nativeSelection?.anchorNode).toBe(parent);
    expect(nativeSelection?.anchorOffset).toBe(blotOffset + 1);

    editor?.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true, data: "" }));
    const composingText = document.createTextNode("汉");
    const range = nativeSelection!.getRangeAt(0);
    range.insertNode(composingText);
    range.setStart(composingText, 1);
    range.collapse(true);
    nativeSelection?.removeAllRanges();
    nativeSelection?.addRange(range);
    editor?.dispatchEvent(new CompositionEvent("compositionupdate", { bubbles: true, data: "汉" }));

    expect(nativeSelection?.anchorNode).toBe(composingText);
    expect(nativeSelection?.anchorOffset).toBe(1);

    composingText.data = "汉字";
    range.setStart(composingText, 2);
    range.collapse(true);
    nativeSelection?.removeAllRanges();
    nativeSelection?.addRange(range);
    editor?.dispatchEvent(
      new CompositionEvent("compositionupdate", { bubbles: true, data: "汉字" }),
    );

    expect(nativeSelection?.anchorNode).toBe(composingText);
    expect(nativeSelection?.anchorOffset).toBe(2);

    editor?.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true, data: "汉字" }));
    await Promise.resolve();
    await Promise.resolve();

    expect(adapter.getSnapshot().content).toEqual([
      { insert: { emoji: "wave" } },
      { insert: "汉字\n" },
    ]);
    expect(adapter.getSelection()).toEqual({ start: 3, end: 3 });

    adapter.destroy();
  });

  it("hydrates the inner img from the registry and flags missing emoji on the wrapper", () => {
    const element = document.createElement("div");
    document.body.append(element);
    const adapter = createQuillAdapter({
      element,
      emojiRegistry: createEmojiRegistry([{ id: "wave", src: "/images/emoji/wave.png" }]),
    });

    adapter.setSnapshot({
      content: [
        { insert: { emoji: "wave" } },
        { insert: { emoji: "unknown_id" } },
        { insert: "\n" },
      ],
    });

    const wave = element.querySelector<HTMLElement>("span.tgg-emoji[data-emoji-id='wave']");
    expect(wave?.querySelector("img")?.getAttribute("src")).toBe("/images/emoji/wave.png");
    expect(wave?.querySelector("img")?.getAttribute("alt")).toBe(":wave:");
    expect(wave?.dataset.emojiMissing).toBeUndefined();

    const missing = element.querySelector<HTMLElement>(
      "span.tgg-emoji[data-emoji-id='unknown_id']",
    );
    expect(missing?.querySelector("img")?.hasAttribute("src")).toBe(false);
    expect(missing?.dataset.emojiMissing).toBe("true");

    adapter.destroy();
  });
});
