import { describe, expect, it } from "vite-plus/test";
import Quill from "quill";
import { observeQuoteGroupBoundaries, syncQuoteGroupBoundaries } from "./quote-boundaries";

function editorWith(...tags: string[]): HTMLElement {
  const editor = document.createElement("div");
  editor.className = "ql-editor";
  for (const tag of tags) {
    editor.append(document.createElement(tag));
  }
  return editor;
}

describe("Quote group boundaries", () => {
  it("marks only the first and last blockquote in each consecutive group", () => {
    const editor = editorWith("p", "blockquote", "blockquote", "blockquote", "p", "blockquote");

    syncQuoteGroupBoundaries(editor);

    const quotes = [...editor.querySelectorAll("blockquote")];
    expect(quotes[0]?.classList.contains("tgg-quote-group-start")).toBe(true);
    expect(quotes[0]?.classList.contains("tgg-quote-group-end")).toBe(false);
    expect(quotes[1]?.className).toBe("");
    expect(quotes[2]?.classList.contains("tgg-quote-group-start")).toBe(false);
    expect(quotes[2]?.classList.contains("tgg-quote-group-end")).toBe(true);
    expect(quotes[3]?.classList.contains("tgg-quote-group-start")).toBe(true);
    expect(quotes[3]?.classList.contains("tgg-quote-group-end")).toBe(true);
  });

  it("refreshes the group end after Quill appends another quote line", async () => {
    const editor = editorWith("blockquote");
    const observer = observeQuoteGroupBoundaries(editor);
    const first = editor.firstElementChild as HTMLElement;

    expect(first.classList.contains("tgg-quote-group-end")).toBe(true);
    editor.append(document.createElement("blockquote"));
    await new Promise<void>((resolve) => queueMicrotask(resolve));

    const second = editor.lastElementChild as HTMLElement;
    expect(first.classList.contains("tgg-quote-group-end")).toBe(false);
    expect(second.classList.contains("tgg-quote-group-end")).toBe(true);
    observer?.disconnect();
  });

  it("keeps visual boundary classes out of Quill content", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const quill = new Quill(container);
    quill.setContents([
      { insert: "First" },
      { insert: "\n", attributes: { blockquote: true } },
      { insert: "Second" },
      { insert: "\n", attributes: { blockquote: true } },
    ]);
    const before = quill.getContents();
    const observer = observeQuoteGroupBoundaries(quill.root);

    await new Promise<void>((resolve) => queueMicrotask(resolve));
    quill.update();

    expect(quill.root.querySelectorAll(".tgg-quote-group-start")).toHaveLength(1);
    expect(quill.root.querySelectorAll(".tgg-quote-group-end")).toHaveLength(1);
    expect(quill.getContents()).toEqual(before);
    observer?.disconnect();
    container.remove();
  });
});
