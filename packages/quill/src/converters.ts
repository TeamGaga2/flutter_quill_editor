import type { Op } from "quill";

import {
  assertValidSnapshot,
  isAllowedLink,
  isRecord,
  type DeltaOperation,
  type RichTextSnapshotV1,
  type VideoAttributes,
} from "@teamgaga/richtext-delta";
import type { ImageValue } from "./blots/image-blot";
import type { VideoValue } from "./blots/video-blot";
import { BLOCK_FORMATS, INLINE_FORMATS } from "./formats";

interface QuillDelta {
  ops: Op[];
}

type QuillMentionOperation = Op & {
  insert: {
    mention: {
      id: string;
      sign: "!" | "&";
      displayText: string;
    };
  };
};

type QuillChannelOperation = Op & {
  insert: {
    channel: {
      id: string;
      displayText: string;
    };
  };
};

type QuillDividerOperation = Op & {
  insert: {
    divider: "true";
  };
};

type QuillEmojiOperation = Op & {
  insert: {
    emoji: {
      id: string;
    };
  };
};

type QuillImageValue = Required<ImageValue>;

type QuillImageOperation = Op & {
  insert: {
    image: QuillImageValue;
  };
};

type QuillVideoValue = Omit<VideoValue, "width" | "height" | "mimeType" | "fileSize"> & {
  width: string;

  height: string;

  mimeType: string;

  fileSize: number;
};

type QuillVideoOperation = Op & {
  insert: {
    video: QuillVideoValue;
  };
};

type SnapshotMentionOperation = Extract<DeltaOperation, { insert: { mention: string } }>;
type SnapshotChannelOperation = Extract<DeltaOperation, { insert: { channel: string } }>;
type SnapshotEmojiOperation = Extract<DeltaOperation, { insert: { emoji: string } }>;
type SnapshotDividerOperation = Extract<DeltaOperation, { insert: { divider: "true" } }>;
type SnapshotImageOperation = Extract<DeltaOperation, { insert: { image: string } }>;
type SnapshotVideoOperation = Extract<DeltaOperation, { insert: { video: string } }>;

export function quillDeltaToSnapshot(delta: QuillDelta): RichTextSnapshotV1 {
  const content = delta.ops
    .map(convertQuillOperation)
    .filter((operation): operation is Op | DeltaOperation => operation !== null);

  // Drop empty text inserts produced by unrecognized-embed placeholders.
  const compacted = content.filter(
    (operation) => !(typeof operation.insert === "string" && operation.insert.length === 0),
  );

  if (
    compacted.length === 0 ||
    !(
      typeof compacted[compacted.length - 1]?.insert === "string" &&
      (compacted[compacted.length - 1]!.insert as string).endsWith("\n")
    )
  ) {
    compacted.push({ insert: "\n" });
  }

  const snapshot: unknown = { content: compacted };

  assertValidSnapshot(snapshot);

  return snapshot;
}

export function snapshotToQuillDelta(snapshot: RichTextSnapshotV1): QuillDelta {
  return {
    ops: snapshot.content.map(convertSnapshotOperation),
  };
}

export function convertQuillEmbed(operation: Op): Op | DeltaOperation | null {
  if (isDividerOperation(operation)) {
    return {
      insert: {
        divider: "true",
      },
    };
  }

  if (isQuillEmojiOperation(operation)) {
    // Empty id is invalid in the snapshot schema; drop the embed.
    if (!operation.insert.emoji.id.trim()) {
      return null;
    }
    return {
      insert: {
        emoji: operation.insert.emoji.id,
      },
    };
  }

  if (isQuillMentionOperation(operation)) {
    const { id, sign, displayText } = operation.insert.mention;

    return {
      insert: {
        mention: id,
      },
      attributes: {
        sign,
        displayText,
      },
    };
  }
  if (isQuillChannelOperation(operation)) {
    const { id, displayText } = operation.insert.channel;

    return {
      insert: {
        channel: id,
      },
      attributes: {
        displayText,
      },
    };
  }

  if (isQuillImageOperation(operation)) {
    const { src, width, height, mimeType, fileSize } = operation.insert.image;

    return {
      insert: {
        image: src,
      },
      attributes: {
        width,
        height,
        mimeType,
        fileSize,
      },
    };
  }

  if (isQuillVideoOperation(operation)) {
    const { src, width, height, mimeType, fileSize, poster, duration } = operation.insert.video;
    const attributes: VideoAttributes = {
      width,
      height,
      mimeType,
      fileSize,
    };

    if (poster !== undefined) {
      attributes.poster = poster;
    }

    if (duration !== undefined) {
      attributes.duration = duration;
    }

    return {
      insert: {
        video: src,
      },
      attributes,
    };
  }

  // Unrecognized embeds must not leak raw Quill ops into the snapshot —
  // assertValidSnapshot would throw and surface as protocol command_failed.
  if (isRecord(operation.insert)) {
    return null;
  }

  return operation;
}

function convertQuillOperation(operation: Op): Op | DeltaOperation | null {
  const converted = convertQuillEmbed(operation);
  if (converted === null) {
    return null;
  }
  return filterTextAttributes(converted);
}

export function convertSnapshotOperation(operation: DeltaOperation): Op {
  if (isSnapshotMentionOperation(operation)) {
    return {
      insert: {
        mention: {
          id: operation.insert.mention,
          sign: operation.attributes.sign,
          displayText: operation.attributes.displayText,
        },
      },
    };
  }
  if (isSnapshotChannelOperation(operation)) {
    return {
      insert: {
        channel: {
          id: operation.insert.channel,
          displayText: operation.attributes.displayText,
        },
      },
    };
  }
  if (isSnapshotEmojiOperation(operation)) {
    return {
      insert: {
        emoji: {
          id: operation.insert.emoji,
        },
      },
    };
  }
  if (isSnapshotDividerOperation(operation)) {
    return {
      insert: {
        divider: "true",
      },
    };
  }
  if (isSnapshotImageOperation(operation)) {
    const { width, height, mimeType, fileSize } = operation.attributes;

    return {
      insert: {
        image: {
          src: operation.insert.image,
          width,
          height,
          mimeType,
          fileSize,
        },
      },
    };
  }
  if (isSnapshotVideoOperation(operation)) {
    const { width, height, mimeType, fileSize, poster, duration } = operation.attributes;

    return {
      insert: {
        video: {
          src: operation.insert.video,
          width,
          height,
          mimeType,
          fileSize,
          ...(poster === undefined ? {} : { poster }),
          ...(duration === undefined ? {} : { duration }),
        },
      },
    };
  }

  const attributes = "attributes" in operation ? operation.attributes : undefined;

  return {
    insert: operation.insert,
    ...(attributes === undefined ? {} : { attributes: { ...attributes } }),
  };
}

function isDividerOperation(operation: Op): operation is QuillDividerOperation {
  return (
    isRecord(operation.insert) &&
    "divider" in operation.insert &&
    operation.insert.divider === "true"
  );
}

function isQuillEmojiOperation(operation: Op): operation is QuillEmojiOperation {
  return (
    isRecord(operation.insert) &&
    isRecord(operation.insert.emoji) &&
    typeof operation.insert.emoji.id === "string"
  );
}

function isQuillMentionOperation(operation: Op): operation is QuillMentionOperation {
  if (!isRecord(operation.insert) || !isRecord(operation.insert.mention)) {
    return false;
  }

  const { id, sign, displayText } = operation.insert.mention;

  return (
    typeof id === "string" && (sign === "!" || sign === "&") && typeof displayText === "string"
  );
}

function isQuillChannelOperation(operation: Op): operation is QuillChannelOperation {
  if (!isRecord(operation.insert) || !isRecord(operation.insert.channel)) {
    return false;
  }

  const { id, displayText } = operation.insert.channel;

  return typeof id === "string" && typeof displayText === "string";
}

function isQuillImageOperation(operation: Op): operation is QuillImageOperation {
  if (!isRecord(operation.insert) || !isRecord(operation.insert.image)) {
    return false;
  }

  const { src, width, height, mimeType, fileSize } = operation.insert.image;

  return (
    typeof src === "string" &&
    typeof width === "string" &&
    typeof height === "string" &&
    typeof mimeType === "string" &&
    Number.isInteger(fileSize) &&
    Number(fileSize) >= 0
  );
}

function isQuillVideoOperation(operation: Op): operation is QuillVideoOperation {
  if (!isRecord(operation.insert) || !isRecord(operation.insert.video)) {
    return false;
  }

  const { src, width, height, mimeType, fileSize, poster, duration } = operation.insert.video;

  return (
    typeof src === "string" &&
    typeof width === "string" &&
    typeof height === "string" &&
    typeof mimeType === "string" &&
    Number.isInteger(fileSize) &&
    Number(fileSize) >= 0 &&
    (poster === undefined || typeof poster === "string") &&
    (duration === undefined || (Number.isInteger(duration) && Number(duration) >= 0))
  );
}

function isSnapshotMentionOperation(
  operation: DeltaOperation,
): operation is SnapshotMentionOperation {
  return (
    isRecord(operation.insert) &&
    "mention" in operation.insert &&
    typeof operation.insert.mention === "string"
  );
}

function isSnapshotChannelOperation(
  operation: DeltaOperation,
): operation is SnapshotChannelOperation {
  return (
    isRecord(operation.insert) &&
    "channel" in operation.insert &&
    typeof operation.insert.channel === "string"
  );
}

function isSnapshotEmojiOperation(operation: DeltaOperation): operation is SnapshotEmojiOperation {
  return (
    isRecord(operation.insert) &&
    "emoji" in operation.insert &&
    typeof operation.insert.emoji === "string"
  );
}

function isSnapshotDividerOperation(
  operation: DeltaOperation,
): operation is SnapshotDividerOperation {
  return (
    isRecord(operation.insert) &&
    "divider" in operation.insert &&
    operation.insert.divider === "true"
  );
}

function isSnapshotImageOperation(operation: DeltaOperation): operation is SnapshotImageOperation {
  return (
    isRecord(operation.insert) &&
    "image" in operation.insert &&
    typeof operation.insert.image === "string"
  );
}

function isSnapshotVideoOperation(operation: DeltaOperation): operation is SnapshotVideoOperation {
  return (
    isRecord(operation.insert) &&
    "video" in operation.insert &&
    typeof operation.insert.video === "string"
  );
}

function filterTextAttributes(operation: Op | DeltaOperation): Op | DeltaOperation {
  if (
    typeof operation.insert !== "string" ||
    !("attributes" in operation) ||
    operation.attributes === undefined
  ) {
    return operation;
  }

  const formats = operation.insert.includes("\n") ? BLOCK_FORMATS : INLINE_FORMATS;
  const allowedFormats = new Set<string>(formats);
  const attributes = Object.fromEntries(
    Object.entries(operation.attributes).filter(([key]) => allowedFormats.has(key)),
  );

  // Quill may surface hrefs the browser rewrote (e.g. about:blank). Drop them
  // so get_snapshot never fails validation on otherwise readable documents.
  if ("link" in attributes && !isAllowedLink(attributes.link)) {
    delete attributes.link;
  }

  // Boolean inline formats must be true; coerce/drop anything else.
  for (const key of ["bold", "italic", "underline", "strike"] as const) {
    if (key in attributes && attributes[key] !== true) {
      delete attributes[key];
    }
  }

  return {
    insert: operation.insert,
    ...(Object.keys(attributes).length === 0 ? {} : { attributes }),
  };
}
