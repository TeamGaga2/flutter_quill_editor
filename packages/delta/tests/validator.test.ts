import { describe, expect, it } from "vite-plus/test";

import { validateSnapshot } from "../src";

describe("validateSnapshot", () => {
  it("accepts an empty canonical document", () => {
    expect(
      validateSnapshot({
        content: [{ insert: "\n" }],
      }),
    ).toEqual({ ok: true });
  });

  it("rejects a document without terminal newline", () => {
    const result = validateSnapshot({
      content: [{ insert: "hello" }],
    });

    expect(result.ok).toBe(false);

    if (!result.ok) {
      expect(result.issues.some((issue) => issue.code === "TERMINAL_NEWLINE_REQUIRED")).toBe(true);
    }
  });

  it("rejects retain operations", () => {
    const result = validateSnapshot({
      content: [{ retain: 1 }, { insert: "\n" }],
    });

    expect(result.ok).toBe(false);
  });

  it("accepts a mention", () => {
    expect(
      validateSnapshot({
        content: [
          {
            insert: {
              mention: "user-1",
            },
            attributes: {
              sign: "!",
              displayText: "Alice",
            },
          },
          {
            insert: "\n",
          },
        ],
      }),
    ).toEqual({ ok: true });
  });

  it("rejects a mention without displayText", () => {
    const result = validateSnapshot({
      content: [
        {
          insert: {
            mention: "user-1",
          },
          attributes: {
            sign: "!",
          },
        },
        {
          insert: "\n",
        },
      ],
    });

    expect(result.ok).toBe(false);
  });

  it("accepts a custom emoji id without resource attributes", () => {
    expect(
      validateSnapshot({
        content: [
          {
            insert: {
              emoji: "party_parrot",
            },
          },
          {
            insert: "\n",
          },
        ],
      }),
    ).toEqual({ ok: true });
  });

  it("rejects a custom emoji object in the canonical snapshot", () => {
    const result = validateSnapshot({
      content: [
        {
          insert: {
            emoji: {
              id: "party_parrot",
            },
          },
        },
        {
          insert: "\n",
        },
      ],
    });

    expect(result.ok).toBe(false);
  });

  it("accepts indent levels 1–5 on list lines", () => {
    expect(
      validateSnapshot({
        content: [{ insert: "item" }, { insert: "\n", attributes: { list: "bullet", indent: 5 } }],
      }),
    ).toEqual({ ok: true });
  });

  it("rejects indent level above 5", () => {
    const result = validateSnapshot({
      content: [{ insert: "item" }, { insert: "\n", attributes: { list: "bullet", indent: 6 } }],
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.some((issue) => issue.path?.includes("indent"))).toBe(true);
    }
  });

  it("rejects local media for server context", () => {
    const result = validateSnapshot(
      {
        content: [
          {
            insert: {
              image: "tgg-local-media://image-token",
            },
            attributes: {
              width: "640",
              height: "480",
              mimeType: "image/webp",
              fileSize: 1024,
            },
          },
          {
            insert: "\n",
          },
        ],
      },
      {
        context: "server",
      },
    );

    expect(result.ok).toBe(false);

    if (!result.ok) {
      expect(result.issues.some((issue) => issue.code === "LOCAL_MEDIA_NOT_ALLOWED")).toBe(true);
    }
  });
});
