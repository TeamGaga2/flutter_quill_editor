import { describe, expect, it } from "vite-plus/test";

import { quillDeltaToSnapshot } from "../src/converters";

describe("channel conversion", () => {
  it("converts channel embed", () => {
    const result = quillDeltaToSnapshot({
      ops: [
        {
          insert: {
            channel: {
              id: "abc123",
              displayText: "general",
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
          channel: "abc123",
        },

        attributes: {
          displayText: "general",
        },
      },
      {
        insert: "\n",
      },
    ]);
  });
});
