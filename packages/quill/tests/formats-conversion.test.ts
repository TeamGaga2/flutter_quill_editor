import { describe, expect, it } from "vite-plus/test";

import { quillDeltaToSnapshot } from "../src/converters";

describe("format conversion", () => {
  it("drops unsupported inline and block attributes", () => {
    const result = quillDeltaToSnapshot({
      ops: [
        {
          insert: "hello",
          attributes: {
            bold: true,
            color: "red",
          },
        },
        {
          insert: "\n",
          attributes: {
            header: 2,
            background: "yellow",
          },
        },
      ],
    });

    expect(result.content).toEqual([
      {
        insert: "hello",
        attributes: {
          bold: true,
        },
      },
      {
        insert: "\n",
        attributes: {
          header: 2,
        },
      },
    ]);
  });

  it("drops disallowed link schemes instead of failing validation", () => {
    const result = quillDeltaToSnapshot({
      ops: [
        {
          insert: "x",
          attributes: {
            link: "about:blank",
          },
        },
        { insert: "\n" },
      ],
    });

    expect(result.content).toEqual([{ insert: "x" }, { insert: "\n" }]);
  });

  it("drops unrecognized embeds instead of failing validation", () => {
    const result = quillDeltaToSnapshot({
      ops: [
        {
          insert: { mystery: "payload" },
        },
        { insert: "kept\n" },
      ],
    });

    expect(result.content).toEqual([{ insert: "kept\n" }]);
  });
});
