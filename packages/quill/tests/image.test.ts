import { describe, expect, it } from "vite-plus/test";

import type { RichTextSnapshotV1 } from "@teamgaga/richtext-delta";
import { quillDeltaToSnapshot, snapshotToQuillDelta } from "../src/converters";

const imageAttributes = {
  width: "640",
  height: "480",
  mimeType: "image/png",
  fileSize: 102400,
};

describe("image conversion", () => {
  it("converts a Quill image embed to a canonical image", () => {
    const result = quillDeltaToSnapshot({
      ops: [
        {
          insert: {
            image: {
              src: "tgg-local-media://image-token-123",
              ...imageAttributes,
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
          image: "tgg-local-media://image-token-123",
        },
        attributes: imageAttributes,
      },
      {
        insert: "\n",
      },
    ]);
  });

  it("converts a canonical image to Quill's value shape", () => {
    const snapshot: RichTextSnapshotV1 = {
      content: [
        {
          insert: {
            image: "https://cdn.teamgaga.com/a.png",
          },
          attributes: imageAttributes,
        },
        {
          insert: "\n",
        },
      ],
    };

    expect(snapshotToQuillDelta(snapshot).ops).toEqual([
      {
        insert: {
          image: {
            src: "https://cdn.teamgaga.com/a.png",
            ...imageAttributes,
          },
        },
      },
      {
        insert: "\n",
      },
    ]);
  });

  it("keeps image metadata round-trippable", () => {
    const snapshot: RichTextSnapshotV1 = {
      content: [
        {
          insert: {
            image: "https://cdn.teamgaga.com/a.png",
          },
          attributes: imageAttributes,
        },
        {
          insert: "\n",
        },
      ],
    };

    expect(quillDeltaToSnapshot(snapshotToQuillDelta(snapshot))).toEqual(snapshot);
  });
});
