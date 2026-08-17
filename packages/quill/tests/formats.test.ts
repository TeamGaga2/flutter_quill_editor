import { describe, expect, it } from "vite-plus/test";

import { BLOCK_FORMATS, EMBED_FORMATS, INLINE_FORMATS, RICH_TEXT_FORMATS } from "../src/formats";

describe("rich text formats", () => {
  it("groups formats supported by the snapshot schema", () => {
    expect(INLINE_FORMATS).toEqual(["bold", "italic", "underline", "strike", "link"]);

    expect(BLOCK_FORMATS).toEqual(["header", "list", "indent", "blockquote"]);

    expect(EMBED_FORMATS).toEqual(["mention", "channel", "emoji", "divider", "image", "video"]);

    expect(RICH_TEXT_FORMATS).toEqual([...INLINE_FORMATS, ...BLOCK_FORMATS, ...EMBED_FORMATS]);
  });
});
