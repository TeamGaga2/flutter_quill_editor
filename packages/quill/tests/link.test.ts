import { afterEach, describe, expect, it } from "vite-plus/test";
import type { RichTextSnapshotV1 } from "@teamgaga/richtext-delta";
import { createQuillAdapter } from "../src/adapter";
import { quillDeltaToSnapshot } from "../src/converters";

function createMountedAdapter(snapshot?: RichTextSnapshotV1) {
  const element = document.createElement("div");
  document.body.append(element);
  const adapter = createQuillAdapter({ element });
  if (snapshot) {
    adapter.setSnapshot(snapshot);
  }
  return adapter;
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("TgLinkBlot / link snapshot round-trip", () => {
  it("round-trips https links", () => {
    const adapter = createMountedAdapter({
      content: [{ insert: "x", attributes: { link: "https://example.com" } }, { insert: "\n" }],
    });

    expect(adapter.getSnapshot().content).toEqual([
      { insert: "x", attributes: { link: "https://example.com" } },
      { insert: "\n" },
    ]);

    adapter.destroy();
  });

  it("round-trips mp:// mini-program links (not rewritten to about:blank)", () => {
    const adapter = createMountedAdapter({
      content: [{ insert: "x", attributes: { link: "mp://app/path" } }, { insert: "\n" }],
    });

    expect(adapter.getSnapshot().content).toEqual([
      { insert: "x", attributes: { link: "mp://app/path" } },
      { insert: "\n" },
    ]);

    const anchor = document.querySelector("a.tgg-link, a") as HTMLAnchorElement | null;
    // formats() prefers data-tg-href so even if href is sanitized the snapshot is correct.
    expect(anchor?.getAttribute("data-tg-href")).toBe("mp://app/path");

    adapter.destroy();
  });

  it("round-trips mps:// mini-program links", () => {
    const adapter = createMountedAdapter({
      content: [{ insert: "x", attributes: { link: "mps://shop/1" } }, { insert: "\n" }],
    });

    expect(adapter.getSnapshot().content).toEqual([
      { insert: "x", attributes: { link: "mps://shop/1" } },
      { insert: "\n" },
    ]);

    adapter.destroy();
  });

  it("insertLink with mp:// does not break subsequent getSnapshot", () => {
    const adapter = createMountedAdapter({ content: [{ insert: "\n" }] });
    adapter.insertLink({ url: "mp://app", text: "open" }, { start: 0, end: 0 });

    expect(adapter.getSnapshot().content).toEqual([
      { insert: "open", attributes: { link: "mp://app" } },
      { insert: "\n" },
    ]);

    adapter.destroy();
  });

  it("strips disallowed link schemes when converting raw Quill ops", () => {
    const result = quillDeltaToSnapshot({
      ops: [
        {
          insert: "bad",
          attributes: { link: "about:blank", bold: true },
        },
        { insert: "\n" },
      ],
    });

    expect(result.content).toEqual([
      { insert: "bad", attributes: { bold: true } },
      { insert: "\n" },
    ]);
  });
});
