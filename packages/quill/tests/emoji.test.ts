import { describe, expect, it } from "vite-plus/test";

import {
  convertSnapshotOperation,
  quillDeltaToSnapshot,
  snapshotToQuillDelta,
} from "../src/converters";
import { createEmojiRegistry } from "../src/emoji/registry";
import type { RichTextSnapshotV1 } from "@teamgaga/richtext-delta";

describe("emoji conversion", () => {
  it("converts a Quill emoji to its canonical id", () => {
    const result = quillDeltaToSnapshot({
      ops: [
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

    expect(result.content).toEqual([
      {
        insert: {
          emoji: "party_parrot",
        },
      },
      {
        insert: "\n",
      },
    ]);
  });

  it("converts a canonical emoji id to Quill's value shape", () => {
    const result = snapshotToQuillDelta({
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
    });

    expect(result.ops).toEqual([
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
    ]);
  });

  it("keeps emoji conversion round-trippable", () => {
    const snapshot: RichTextSnapshotV1 = {
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
    };

    expect(quillDeltaToSnapshot(snapshotToQuillDelta(snapshot))).toEqual(snapshot);
  });

  it("creates a lookup registry without putting resources in the snapshot", () => {
    const registry = createEmojiRegistry([
      {
        id: "party_parrot",
        src: "/assets/images/emoji/party_parrot.png",
      },
    ]);

    expect(registry.get("party_parrot")).toEqual({
      id: "party_parrot",
      src: "/assets/images/emoji/party_parrot.png",
    });
    expect(registry.get("missing")).toBeUndefined();
    expect(
      convertSnapshotOperation({
        insert: {
          emoji: "party_parrot",
        },
      }),
    ).toEqual({
      insert: {
        emoji: {
          id: "party_parrot",
        },
      },
    });
  });
});
