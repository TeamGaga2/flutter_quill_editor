import { describe, expect, it } from "vite-plus/test";

import { quillDeltaToSnapshot } from "../src/converters";

describe("mention conversion", () => {
  it("converts mention", () => {
    const result = quillDeltaToSnapshot({
      ops: [
        {
          insert: {
            mention: {
              id: "123",
              sign: "!",
              displayText: "Alice",
            },
          },
        },
        {
          insert: "\n",
        },
      ],
    });

    expect(result.content).toEqual([
      {
        insert: {
          mention: "123",
        },

        attributes: {
          sign: "!",
          displayText: "Alice",
        },
      },
      {
        insert: "\n",
      },
    ]);
  });
});
