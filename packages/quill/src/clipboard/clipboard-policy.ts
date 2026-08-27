import Quill, { Delta, type Range as QuillRange } from "quill";
import Module from "quill/core/module";
import Clipboard from "quill/modules/clipboard";

interface CaretPositionFromPoint {
  caretPositionFromPoint(x: number, y: number): { offsetNode: Node; offset: number } | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * ADR-0008 / ADR-0007 / ADR-0006: The TeamGaga Editor Surface preserves body text,
 * supported basic formatting (bold, italic, underline, strike, link, header,
 * list, indent, blockquote), inline embeds (mention, channel, emoji), dividers,
 * and self-produced block media (images, videos) on copy, cut, paste, and drag-and-drop.
 *
 * System media files in clipboard or drag-and-drop are intercepted and forwarded
 * to the host via "paste-media" for registration as `tgg-local-media://` tokens.
 * Foreign HTML images/videos without TeamGaga blot metadata are stripped.
 */
export class ClipboardPolicy extends Clipboard {
  constructor(...args: ConstructorParameters<typeof Clipboard>) {
    super(...args);
    this.quill.root.addEventListener("drop", this.onCaptureDrop);

    this.addMatcher("span.tgg-mention", (node: Node) => {
      if (!(node instanceof HTMLElement)) return new Delta();
      const id = node.dataset.id?.trim() ?? "";
      const displayText =
        node.dataset.display?.trim() || node.textContent?.replace(/^@/, "").trim() || "";
      const sign = node.dataset.sign === "&" ? "&" : "!";
      if (id && displayText) {
        return new Delta().insert({ mention: { id, sign, displayText } });
      }
      if (!id && displayText) {
        return new Delta().insert(`@${displayText}`);
      }
      // If id is present but displayText is empty, or both empty -> discard
      return new Delta();
    });

    this.addMatcher("span.tgg-channel", (node: Node) => {
      if (!(node instanceof HTMLElement)) return new Delta();
      const id = node.dataset.id?.trim() ?? "";
      const displayText =
        node.dataset.display?.trim() || node.textContent?.replace(/^#/, "").trim() || "";
      if (id && displayText) {
        return new Delta().insert({ channel: { id, displayText } });
      }
      if (!id && displayText) {
        return new Delta().insert(`#${displayText}`);
      }
      // If id is present but displayText is empty, or both empty -> discard
      return new Delta();
    });

    this.addMatcher("span.tgg-emoji", (node: Node) => {
      if (!(node instanceof HTMLElement)) return new Delta();
      const id = node.dataset.emojiId?.trim();
      if (id) {
        return new Delta().insert({ emoji: { id } });
      }
      return new Delta();
    });

    this.addMatcher("img.tgg-image", (node: Node) => {
      if (!(node instanceof HTMLElement)) return new Delta();
      const src =
        node.dataset.src?.trim() ||
        node.getAttribute("data-src")?.trim() ||
        node.getAttribute("src")?.trim() ||
        "";
      const width = node.getAttribute("width")?.trim() || node.dataset.width?.trim() || "";
      const height = node.getAttribute("height")?.trim() || node.dataset.height?.trim() || "";
      const mimeType =
        node.dataset.mimeType?.trim() || node.getAttribute("data-mime-type")?.trim() || "";
      const fileSizeStr =
        node.dataset.fileSize?.trim() || node.getAttribute("data-file-size")?.trim() || "";
      const fileSize = Number(fileSizeStr);

      if (src && width && height && mimeType && !Number.isNaN(fileSize) && fileSize >= 0) {
        return new Delta().insert({ image: { src, width, height, mimeType, fileSize } });
      }
      return new Delta();
    });

    this.addMatcher(".tgg-video", (node: Node) => {
      if (!(node instanceof HTMLElement)) return new Delta();
      const src = node.dataset.src?.trim() || node.getAttribute("data-src")?.trim() || "";
      const width = node.getAttribute("width")?.trim() || node.dataset.width?.trim() || "";
      const height = node.getAttribute("height")?.trim() || node.dataset.height?.trim() || "";
      const mimeType =
        node.dataset.mimeType?.trim() || node.getAttribute("data-mime-type")?.trim() || "";
      const fileSizeStr =
        node.dataset.fileSize?.trim() || node.getAttribute("data-file-size")?.trim() || "";
      const fileSize = Number(fileSizeStr);
      const poster =
        node.dataset.poster?.trim() || node.getAttribute("data-poster")?.trim() || undefined;
      const durationStr =
        node.dataset.duration?.trim() || node.getAttribute("data-duration")?.trim();
      const duration =
        durationStr !== undefined && durationStr !== "" ? Number(durationStr) : undefined;

      if (src && width && height && mimeType && !Number.isNaN(fileSize) && fileSize >= 0) {
        const value: Record<string, unknown> = { src, width, height, mimeType, fileSize };
        if (poster) value.poster = poster;
        if (duration !== undefined && !Number.isNaN(duration)) value.duration = duration;
        return new Delta().insert({ video: value });
      }
      return new Delta();
    });
  }

  override onCopy(range: QuillRange, _isCut = false): { html: string; text: string } {
    const rawHtml = this.quill.getSemanticHTML(range.index, range.length);
    const html = rewriteCopyHtml(rawHtml);
    const text = extractPlainText(this.quill.getContents(range.index, range.length));
    return { html, text };
  }

  override convert(
    source: { html?: string; text?: string },
    formats: Record<string, unknown> = {},
  ): Delta {
    const html = source.html ? stripPasteHtml(source.html) : source.html;
    return stripEmbeds(super.convert({ ...source, html }, formats));
  }

  override onCapturePaste(event: ClipboardEvent): void {
    if (event.defaultPrevented || !this.quill.isEnabled()) return;

    const mediaFile = findMediaFile(event.clipboardData?.files, event.clipboardData?.items);
    if (mediaFile) {
      event.preventDefault();
      const range = this.quill.getSelection(true);
      const selection = range ? { start: range.index, end: range.index + range.length } : null;
      void this.processAndEmitMediaFile(mediaFile, selection);
      return;
    }

    event.preventDefault();

    const range = this.quill.getSelection(true);
    if (range == null) return;

    const html = event.clipboardData?.getData("text/html");
    let text = event.clipboardData?.getData("text/plain");

    if (!html && !text) {
      const uriList = event.clipboardData?.getData("text/uri-list");
      if (uriList) {
        text = normalizeUriList(uriList);
      }
    }

    this.onPaste(range, { html, text });
  }

  private readonly onCaptureDrop = (event: DragEvent): void => {
    if (event.defaultPrevented || !this.quill.isEnabled()) return;

    const dataTransfer = event.dataTransfer;
    if (!dataTransfer) return;

    const mediaFile = findMediaFile(dataTransfer.files, dataTransfer.items);
    if (mediaFile) {
      event.preventDefault();
      const range = resolveDropRange(this.quill, event) ?? this.quill.getSelection(true);
      const selection = range ? { start: range.index, end: range.index + range.length } : null;
      void this.processAndEmitMediaFile(mediaFile, selection);
      return;
    }

    event.preventDefault();

    const range = resolveDropRange(this.quill, event) ?? this.quill.getSelection(true);
    if (range == null) return;

    const html = dataTransfer.getData("text/html");
    const text = dataTransfer.getData("text/plain");
    if (!html && !text) return;

    this.onPaste(range, { html, text });
  };

  private async processAndEmitMediaFile(
    file: File,
    selection: { start: number; end: number } | null,
  ): Promise<void> {
    try {
      const probe = await probeMediaFile(file);
      this.quill.emitter.emit("paste-media", {
        mimeType: probe.mimeType,
        fileSize: probe.fileSize,
        dataBase64: probe.dataBase64,
        width: probe.width,
        height: probe.height,
        fileName: probe.fileName,
        isVideo: probe.isVideo,
        duration: probe.duration,
        selection,
      });
    } catch {
      // ignore
    }
  }
}

/** Replaces Quill's default uploader so it never reads dropped/pasted files as data URLs. */
export class NoopUploader extends Module {
  upload(): void {
    // ADR-0008 / ADR-0006: paste/drop is intercepted by ClipboardPolicy and forwarded to host.
  }
}

/**
 * Installs the rich-text, inline-embed, and media clipboard/drop policy globally for every Quill
 * instance created afterwards. Mirrors `registerBlots()`: call once before
 * constructing a `Quill` instance.
 */
export function installClipboardPolicy(): void {
  Quill.register(
    {
      "modules/clipboard": ClipboardPolicy,
      "modules/uploader": NoopUploader,
    },
    true,
  );
}

/**
 * Rewrites the semantic HTML produced for the copied range (ADR-0008 / ADR-0007 / ADR-0006):
 * - Mentions and channel references remain blot DOM (<span class="tgg-mention/channel" data-*...).
 * - Emoji spans are rewritten to span text :${emojiId}: without <img>, src, or data-emoji-missing.
 * - Dividers remain blot DOM (<hr class="tgg-divider">).
 * - Self-produced block media (images with .tgg-image, videos with .tgg-video) are preserved.
 * - Foreign block media (images, videos) without TeamGaga blot classes are stripped.
 */
export function rewriteCopyHtml(html: string): string {
  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, "text/html");

    // Rewrite emoji spans: remove <img> and replace inner text with :id:, remove data-emoji-missing
    doc.body.querySelectorAll<HTMLElement>(".tgg-emoji").forEach((emoji) => {
      const emojiId =
        emoji.dataset.emojiId?.trim() ?? emoji.getAttribute("data-emoji-id")?.trim() ?? "";
      emoji.textContent = `:${emojiId}:`;
      emoji.removeAttribute("data-emoji-missing");
    });

    // Remove foreign images (not our blot DOM)
    doc.body.querySelectorAll("img:not(.tgg-image)").forEach((node) => {
      node.remove();
    });

    // Remove foreign videos (not our blot media)
    doc.body.querySelectorAll("video:not(.tgg-video__media)").forEach((node) => {
      node.remove();
    });

    return doc.body.innerHTML;
  } catch {
    return html;
  }
}

/**
 * Preprocesses pasted HTML before Quill converts it to Delta (ADR-0008 / ADR-0007 / ADR-0006):
 * - Clears inner children of .tgg-emoji spans so inner <img> does not trigger
 *   Quill's ImageBlot (BlockEmbed) splitting during HTML conversion.
 * - Preserves self-produced .tgg-image and .tgg-video with valid metadata.
 * - Strips foreign block images and videos while preserving surrounding text, inline embeds, and dividers.
 */
export function stripPasteHtml(html: string): string {
  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, "text/html");

    // Clear inner children of emoji spans so inner <img> does not trigger ImageBlot
    doc.body.querySelectorAll<HTMLElement>(".tgg-emoji").forEach((emoji) => {
      emoji.textContent = "";
    });

    // Remove foreign images and malformed self-produced images
    doc.body.querySelectorAll<HTMLImageElement>("img").forEach((img) => {
      if (!img.classList.contains("tgg-image")) {
        img.remove();
        return;
      }
      const src = img.dataset.src || img.getAttribute("data-src") || img.getAttribute("src");
      const mime = img.dataset.mimeType || img.getAttribute("data-mime-type");
      const width = img.getAttribute("width") || img.dataset.width;
      const height = img.getAttribute("height") || img.dataset.height;
      const fileSizeStr = img.dataset.fileSize || img.getAttribute("data-file-size");
      const fileSize = fileSizeStr ? Number(fileSizeStr) : Number.NaN;
      if (!src || !mime || !width || !height || Number.isNaN(fileSize) || fileSize < 0) {
        img.remove();
      }
    });

    // Remove foreign videos
    doc.body.querySelectorAll<HTMLVideoElement>("video").forEach((video) => {
      if (!video.classList.contains("tgg-video__media")) {
        video.remove();
      }
    });

    // Remove malformed self-produced video wrappers
    doc.body.querySelectorAll<HTMLElement>(".tgg-video").forEach((video) => {
      const src = video.getAttribute("data-src") || video.dataset.src;
      const mime = video.getAttribute("data-mime-type") || video.dataset.mimeType;
      const width = video.getAttribute("width") || video.dataset.width;
      const height = video.getAttribute("height") || video.dataset.height;
      const fileSizeStr = video.dataset.fileSize || video.getAttribute("data-file-size");
      const fileSize = fileSizeStr ? Number(fileSizeStr) : Number.NaN;
      if (!src || !mime || !width || !height || Number.isNaN(fileSize) || fileSize < 0) {
        video.remove();
      }
    });

    return doc.body.innerHTML;
  } catch {
    return html;
  }
}

/**
 * Formats Delta content into plain text (ADR-0008 / ADR-0007 / ADR-0006):
 * - Mention: `@${displayText}`
 * - Channel: `#${displayText}`
 * - Emoji: `:${emojiId}:`
 * - Divider: `---\n`
 * - Image: `[图片]\n`
 * - Video: `[视频]\n`
 */
export function extractPlainText(delta: Delta): string {
  let result = "";
  for (const op of delta.ops) {
    if (typeof op.insert === "string") {
      result += op.insert;
    } else if (isRecord(op.insert)) {
      if ("mention" in op.insert) {
        const mention = op.insert.mention;
        const displayText =
          typeof mention === "string"
            ? ((op.attributes?.displayText as string | undefined)?.trim() ?? "")
            : isRecord(mention) && typeof mention.displayText === "string"
              ? mention.displayText.trim()
              : "";
        if (displayText) {
          result += `@${displayText}`;
        }
      } else if ("channel" in op.insert) {
        const channel = op.insert.channel;
        const displayText =
          typeof channel === "string"
            ? ((op.attributes?.displayText as string | undefined)?.trim() ?? "")
            : isRecord(channel) && typeof channel.displayText === "string"
              ? channel.displayText.trim()
              : "";
        if (displayText) {
          result += `#${displayText}`;
        }
      } else if ("emoji" in op.insert) {
        const emoji = op.insert.emoji;
        const id =
          typeof emoji === "string"
            ? emoji.trim()
            : isRecord(emoji) && typeof emoji.id === "string"
              ? emoji.id.trim()
              : "";
        if (id) {
          result += `:${id}:`;
        }
      } else if ("divider" in op.insert) {
        result += "---\n";
      } else if ("image" in op.insert) {
        result += "[图片]\n";
      } else if ("video" in op.insert) {
        result += "[视频]\n";
      }
    }
  }
  return result;
}

/**
 * Sanitizes embeds on paste/drop (ADR-0008 / ADR-0007 / ADR-0006):
 * - Whitelists valid inline embeds (mention, channel, emoji) and block dividers.
 * - Whitelists valid self-produced block media (images, videos) with valid metadata attributes.
 * - Degrades malformed mentions / channels with missing IDs to plain text (@displayText / #displayText).
 * - Drops malformed mentions / channels with IDs but missing displayText (no internal ID exposed).
 * - Drops malformed emojis with missing IDs.
 * - Drops invalid media embeds missing required attributes.
 */
export function stripEmbeds(delta: Delta): Delta {
  return delta.reduce((sanitized, op) => {
    if (typeof op.insert === "string") {
      return sanitized.insert(op.insert, op.attributes);
    }
    if (isRecord(op.insert)) {
      if ("mention" in op.insert) {
        const mention = op.insert.mention;
        if (isRecord(mention)) {
          const id = typeof mention.id === "string" ? mention.id.trim() : "";
          const displayText =
            typeof mention.displayText === "string" ? mention.displayText.trim() : "";
          if (id && displayText) {
            const sign = mention.sign === "&" ? "&" : "!";
            return sanitized.insert({ mention: { id, sign, displayText } });
          }
          if (!id && displayText) {
            return sanitized.insert(`@${displayText}`);
          }
          return sanitized;
        } else if (typeof mention === "string") {
          const id = mention.trim();
          const displayText = (op.attributes?.displayText as string | undefined)?.trim() ?? "";
          const sign = op.attributes?.sign === "&" ? "&" : "!";
          if (id && displayText) {
            return sanitized.insert({ mention: { id, sign, displayText } });
          }
          if (!id && displayText) {
            return sanitized.insert(`@${displayText}`);
          }
          return sanitized;
        }
        return sanitized;
      }

      if ("channel" in op.insert) {
        const channel = op.insert.channel;
        if (isRecord(channel)) {
          const id = typeof channel.id === "string" ? channel.id.trim() : "";
          const displayText =
            typeof channel.displayText === "string" ? channel.displayText.trim() : "";
          if (id && displayText) {
            return sanitized.insert({ channel: { id, displayText } });
          }
          if (!id && displayText) {
            return sanitized.insert(`#${displayText}`);
          }
          return sanitized;
        } else if (typeof channel === "string") {
          const id = channel.trim();
          const displayText = (op.attributes?.displayText as string | undefined)?.trim() ?? "";
          if (id && displayText) {
            return sanitized.insert({ channel: { id, displayText } });
          }
          if (!id && displayText) {
            return sanitized.insert(`#${displayText}`);
          }
          return sanitized;
        }
        return sanitized;
      }

      if ("emoji" in op.insert) {
        const emoji = op.insert.emoji;
        if (isRecord(emoji)) {
          const id = typeof emoji.id === "string" ? emoji.id.trim() : "";
          if (id) {
            return sanitized.insert({ emoji: { id } });
          }
          return sanitized;
        } else if (typeof emoji === "string") {
          const id = emoji.trim();
          if (id) {
            return sanitized.insert({ emoji: { id } });
          }
          return sanitized;
        }
        return sanitized;
      }

      if ("divider" in op.insert) {
        const divider = op.insert.divider;
        if (divider === "true" || divider === true) {
          return sanitized.insert({ divider: "true" });
        }
        return sanitized;
      }

      if ("image" in op.insert) {
        const imageVal = sanitizeImageOp(op.insert.image, op.attributes);
        if (imageVal) {
          return sanitized.insert({ image: imageVal });
        }
        return sanitized;
      }

      if ("video" in op.insert) {
        const videoVal = sanitizeVideoOp(op.insert.video, op.attributes);
        if (videoVal) {
          return sanitized.insert({ video: videoVal });
        }
        return sanitized;
      }
    }
    return sanitized;
  }, new Delta());
}

function sanitizeImageOp(
  raw: unknown,
  attrs?: Record<string, unknown>,
): { src: string; width: string; height: string; mimeType: string; fileSize: number } | null {
  let src = "";
  let width = "";
  let height = "";
  let mimeType = "";
  let fileSize = Number.NaN;

  if (isRecord(raw)) {
    src = typeof raw.src === "string" ? raw.src.trim() : "";
    width =
      typeof raw.width === "string"
        ? raw.width.trim()
        : typeof raw.width === "number"
          ? String(raw.width)
          : "";
    height =
      typeof raw.height === "string"
        ? raw.height.trim()
        : typeof raw.height === "number"
          ? String(raw.height)
          : "";
    mimeType = typeof raw.mimeType === "string" ? raw.mimeType.trim() : "";
    fileSize = typeof raw.fileSize === "number" ? raw.fileSize : Number(raw.fileSize);
  } else if (typeof raw === "string" && raw.trim() && isRecord(attrs)) {
    src = raw.trim();
    width =
      typeof attrs.width === "string"
        ? attrs.width.trim()
        : typeof attrs.width === "number"
          ? String(attrs.width)
          : "";
    height =
      typeof attrs.height === "string"
        ? attrs.height.trim()
        : typeof attrs.height === "number"
          ? String(attrs.height)
          : "";
    mimeType = typeof attrs.mimeType === "string" ? attrs.mimeType.trim() : "";
    fileSize = typeof attrs.fileSize === "number" ? attrs.fileSize : Number(attrs.fileSize);
  }

  if (src && width && height && mimeType && Number.isFinite(fileSize) && fileSize >= 0) {
    return { src, width, height, mimeType, fileSize };
  }
  return null;
}

function sanitizeVideoOp(
  raw: unknown,
  attrs?: Record<string, unknown>,
): Record<string, unknown> | null {
  let src = "";
  let width = "";
  let height = "";
  let mimeType = "";
  let fileSize = Number.NaN;
  let poster: string | undefined;
  let duration: number | undefined;

  if (isRecord(raw)) {
    src = typeof raw.src === "string" ? raw.src.trim() : "";
    width =
      typeof raw.width === "string"
        ? raw.width.trim()
        : typeof raw.width === "number"
          ? String(raw.width)
          : "";
    height =
      typeof raw.height === "string"
        ? raw.height.trim()
        : typeof raw.height === "number"
          ? String(raw.height)
          : "";
    mimeType = typeof raw.mimeType === "string" ? raw.mimeType.trim() : "";
    fileSize = typeof raw.fileSize === "number" ? raw.fileSize : Number(raw.fileSize);
    if (typeof raw.poster === "string" && raw.poster.trim()) {
      poster = raw.poster.trim();
    }
    if (typeof raw.duration === "number" && raw.duration >= 0) {
      duration = raw.duration;
    } else if (typeof raw.duration === "string" && !Number.isNaN(Number(raw.duration))) {
      duration = Number(raw.duration);
    }
  } else if (typeof raw === "string" && raw.trim() && isRecord(attrs)) {
    src = raw.trim();
    width =
      typeof attrs.width === "string"
        ? attrs.width.trim()
        : typeof attrs.width === "number"
          ? String(attrs.width)
          : "";
    height =
      typeof attrs.height === "string"
        ? attrs.height.trim()
        : typeof attrs.height === "number"
          ? String(attrs.height)
          : "";
    mimeType = typeof attrs.mimeType === "string" ? attrs.mimeType.trim() : "";
    fileSize = typeof attrs.fileSize === "number" ? attrs.fileSize : Number(attrs.fileSize);
    if (typeof attrs.poster === "string" && attrs.poster.trim()) {
      poster = attrs.poster.trim();
    }
    if (typeof attrs.duration === "number" && attrs.duration >= 0) {
      duration = attrs.duration;
    } else if (typeof attrs.duration === "string" && !Number.isNaN(Number(attrs.duration))) {
      duration = Number(attrs.duration);
    }
  }

  if (src && width && height && mimeType && Number.isFinite(fileSize) && fileSize >= 0) {
    const videoVal: Record<string, unknown> = { src, width, height, mimeType, fileSize };
    if (poster) videoVal.poster = poster;
    if (duration !== undefined && duration >= 0) videoVal.duration = duration;
    return videoVal;
  }
  return null;
}

function normalizeUriList(uriList: string): string {
  return uriList
    .split(/\r?\n/)
    .filter((url) => url[0] !== "#")
    .join("\n");
}

function resolveDropRange(quill: InstanceType<typeof Quill>, event: DragEvent): QuillRange | null {
  let native: globalThis.Range | null = null;

  if (typeof document.caretRangeFromPoint === "function") {
    native = document.caretRangeFromPoint(event.clientX, event.clientY);
  } else {
    const caretPositionDocument = document as unknown as CaretPositionFromPoint;
    if (typeof caretPositionDocument.caretPositionFromPoint === "function") {
      const position = caretPositionDocument.caretPositionFromPoint(event.clientX, event.clientY);
      if (position) {
        native = document.createRange();
        native.setStart(position.offsetNode, position.offset);
        native.setEnd(position.offsetNode, position.offset);
      }
    }
  }

  const normalized = native && quill.selection.normalizeNative(native);
  return normalized ? quill.selection.normalizedToRange(normalized) : null;
}

function findMediaFile(files?: FileList | null, items?: DataTransferItemList | null): File | null {
  if (files && files.length > 0) {
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      if (file && (file.type.startsWith("image/") || file.type.startsWith("video/"))) {
        return file;
      }
    }
  }
  if (items && items.length > 0) {
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (
        item &&
        item.kind === "file" &&
        (item.type.startsWith("image/") || item.type.startsWith("video/"))
      ) {
        const file = item.getAsFile();
        if (file) return file;
      }
    }
  }
  return null;
}

export async function probeMediaFile(file: File): Promise<{
  mimeType: string;
  fileSize: number;
  dataBase64: string;
  width?: string;
  height?: string;
  fileName?: string;
  isVideo: boolean;
  duration?: number;
}> {
  const mimeType = file.type || "application/octet-stream";
  const fileSize = file.size;
  const fileName = file.name || undefined;
  const isVideo = mimeType.startsWith("video/");

  const dataBase64 = await readFileAsBase64(file);

  if (mimeType.startsWith("image/")) {
    const dimensions = await probeImageDimensions(file);
    return {
      mimeType,
      fileSize,
      dataBase64,
      fileName,
      isVideo: false,
      width: dimensions ? String(dimensions.width) : undefined,
      height: dimensions ? String(dimensions.height) : undefined,
    };
  }

  if (isVideo) {
    const videoMeta = await probeVideoMetadata(file);
    return {
      mimeType,
      fileSize,
      dataBase64,
      fileName,
      isVideo: true,
      width: videoMeta?.width ? String(videoMeta.width) : undefined,
      height: videoMeta?.height ? String(videoMeta.height) : undefined,
      duration: videoMeta?.duration,
    };
  }

  return {
    mimeType,
    fileSize,
    dataBase64,
    fileName,
    isVideo,
  };
}

async function readFileAsBase64(file: File): Promise<string> {
  if (typeof file.arrayBuffer === "function") {
    try {
      const buffer = await file.arrayBuffer();
      if (typeof Buffer !== "undefined") {
        return Buffer.from(buffer).toString("base64");
      }
      const bytes = new Uint8Array(buffer);
      let binary = "";
      for (let i = 0; i < bytes.byteLength; i++) {
        binary += String.fromCharCode(bytes[i]);
      }
      return btoa(binary);
    } catch {
      // fallback to FileReader
    }
  }

  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      const comma = result.indexOf(",");
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export const MEDIA_PROBE_TIMEOUT_MS = 500;

function probeWithObjectUrl<T>(
  file: File,
  executor: (url: string, done: (result: T | null) => void) => void,
  timeoutMs = MEDIA_PROBE_TIMEOUT_MS,
): Promise<T | null> {
  return new Promise((resolve) => {
    if (typeof URL === "undefined" || typeof URL.createObjectURL !== "function") {
      resolve(null);
      return;
    }

    let url: string | null = null;
    try {
      url = URL.createObjectURL(file);
    } catch {
      resolve(null);
      return;
    }

    let settled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const done = (result: T | null) => {
      if (settled) return;
      settled = true;
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
      if (url) {
        try {
          URL.revokeObjectURL(url);
        } catch {}
      }
      resolve(result);
    };

    timer = setTimeout(() => done(null), timeoutMs);

    try {
      executor(url, done);
    } catch {
      done(null);
    }
  });
}

function probeImageDimensions(file: File): Promise<{ width: number; height: number } | null> {
  if (typeof Image === "undefined") {
    return Promise.resolve(null);
  }
  return probeWithObjectUrl(file, (url, done) => {
    const img = new Image();
    img.onload = () => {
      const width = img.naturalWidth;
      const height = img.naturalHeight;
      done(width && height ? { width, height } : null);
    };
    img.onerror = () => {
      done(null);
    };
    img.src = url;
  });
}

function probeVideoMetadata(
  file: File,
): Promise<{ width?: number; height?: number; duration?: number } | null> {
  if (typeof document === "undefined") {
    return Promise.resolve(null);
  }
  return probeWithObjectUrl(file, (url, done) => {
    const video = document.createElement("video");
    video.preload = "metadata";
    video.onloadedmetadata = () => {
      const width = video.videoWidth;
      const height = video.videoHeight;
      const duration = Math.round(video.duration);
      done({
        width: width || undefined,
        height: height || undefined,
        duration: Number.isFinite(duration) ? duration : undefined,
      });
    };
    video.onerror = () => {
      done(null);
    };
    video.src = url;
  });
}
