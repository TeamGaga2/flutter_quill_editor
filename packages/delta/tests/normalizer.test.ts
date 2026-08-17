import { describe, expect, it } from "vite-plus/test";

import { normalizeSnapshot } from "../src";

describe("normalizeSnapshot", () => {
  it("canonicalizes empty content", () => {
    expect(
      normalizeSnapshot({
        content: [],
      }),
    ).toEqual({
      content: [{ insert: "\n" }],
    });
  });

  it("normalizes CRLF", () => {
    expect(
      normalizeSnapshot({
        content: [
          {
            insert: "hello\r\n",
          },
        ],
      }),
    ).toEqual({
      content: [
        {
          insert: "hello\n",
        },
      ],
    });
  });

  it("merges adjacent text operations", () => {
    expect(
      normalizeSnapshot({
        content: [
          {
            insert: "hello ",
            attributes: {
              bold: true,
            },
          },
          {
            insert: "world",
            attributes: {
              bold: true,
            },
          },
          {
            insert: "\n",
          },
        ],
      }),
    ).toEqual({
      content: [
        {
          insert: "hello world",
          attributes: {
            bold: true,
          },
        },
        {
          insert: "\n",
        },
      ],
    });
  });

  it("is idempotent", () => {
    const once = normalizeSnapshot({
      content: [
        {
          insert: "hello",
        },
      ],
    });

    const twice = normalizeSnapshot(once);

    expect(twice).toEqual(once);
  });
});
