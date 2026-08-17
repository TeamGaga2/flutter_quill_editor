import { describe, expect, it } from "vite-plus/test";
import { Delta } from "quill";
import { stripEmbeds } from "../src/clipboard/text-only-clipboard";

describe("text-only clipboard stripEmbeds", () => {
  it("keeps text ops and drops embed inserts", () => {
    const input = new Delta()
      .insert("hi", { bold: true })
      .insert({ image: "https://example/x.png" })
      .insert("\n");
    const output = stripEmbeds(input);
    expect(output.ops).toEqual([{ insert: "hi", attributes: { bold: true } }, { insert: "\n" }]);
  });
});
