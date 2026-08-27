import { describe, expect, it } from "vite-plus/test";

import type { RichTextSnapshotV1 } from "@teamgaga/richtext-delta";
import { applyMediaBlotFormat } from "../src/blots/media-display-size";
import { VideoBlot } from "../src/blots/video-blot";
import { quillDeltaToSnapshot, snapshotToQuillDelta } from "../src/converters";

const videoAttributes = {
  width: "1280",
  height: "720",
  mimeType: "video/mp4",
  fileSize: 1048576,
  poster: "https://cdn.teamgaga.com/poster.png",
  duration: 30,
};

describe("video conversion", () => {
  it("converts a Quill video embed to a canonical video", () => {
    const result = quillDeltaToSnapshot({
      ops: [
        {
          insert: {
            video: {
              src: "tgg-local-media://video-token-123",
              width: "1280",
              height: "720",
              mimeType: "video/mp4",
              fileSize: 1048576,
              poster: "https://cdn.teamgaga.com/poster.png",
              duration: 30,
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
          video: "tgg-local-media://video-token-123",
        },
        attributes: videoAttributes,
      },
      {
        insert: "\n",
      },
    ]);
  });

  it("converts a canonical video to Quill's value shape", () => {
    const snapshot: RichTextSnapshotV1 = {
      content: [
        {
          insert: {
            video: "https://cdn.teamgaga.com/video.mp4",
          },
          attributes: videoAttributes,
        },
        {
          insert: "\n",
        },
      ],
    };

    expect(snapshotToQuillDelta(snapshot).ops).toEqual([
      {
        insert: {
          video: {
            src: "https://cdn.teamgaga.com/video.mp4",
            ...videoAttributes,
          },
        },
      },
      {
        insert: "\n",
      },
    ]);
  });

  it("keeps optional video metadata round-trippable", () => {
    const snapshot: RichTextSnapshotV1 = {
      content: [
        {
          insert: {
            video: "https://cdn.teamgaga.com/video.m3u8",
          },
          attributes: {
            width: "1280",
            height: "720",
            mimeType: "application/vnd.apple.mpegurl",
            fileSize: 0,
          },
        },
        {
          insert: "\n",
        },
      ],
    };

    expect(quillDeltaToSnapshot(snapshotToQuillDelta(snapshot))).toEqual(snapshot);
  });

  it("updates DOM attributes and styles via applyMediaBlotFormat()", () => {
    const node = VideoBlot.create({
      src: "tgg-local-media://test-video",
      width: "100",
      height: "100",
      mimeType: "video/mp4",
      fileSize: 2048,
    });

    applyMediaBlotFormat(node, "width", "640");
    expect(node.getAttribute("width")).toBe("640");
    applyMediaBlotFormat(node, "height", "480");
    expect(node.getAttribute("height")).toBe("480");
    applyMediaBlotFormat(node, "mimeType", "video/webm");
    expect(node.getAttribute("data-mime-type")).toBe("video/webm");
    applyMediaBlotFormat(node, "fileSize", 4096);
    expect(node.getAttribute("data-file-size")).toBe("4096");
    applyMediaBlotFormat(node, "poster", "https://example.com/poster.jpg");
    expect(node.getAttribute("data-poster")).toBe("https://example.com/poster.jpg");
    applyMediaBlotFormat(node, "duration", 60);
    expect(node.getAttribute("data-duration")).toBe("60");

    applyMediaBlotFormat(node, "width", null);
    expect(node.hasAttribute("width")).toBe(false);
  });
});
