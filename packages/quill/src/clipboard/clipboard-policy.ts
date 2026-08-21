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
 * ADR-0006 / ADR-0005: The TeamGaga Editor Surface preserves body text,
 * supported basic formatting (bold, italic, underline, strike, link, header,
 * list, indent, blockquote), and inline embeds (mention, channel, emoji)
 * on copy, cut, paste, and drag-and-drop to caret.
 *
 * Block media embeds (image, video) and dividers are stripped on copy and
 * paste/drop, and `DataTransfer.files` is never read — no upload, no
 * local-media token, no placeholder, no error.
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

    // DataTransfer.files is intentionally never inspected here — clipboard
    // files are a silent no-op, text/html still pastes when present.
    this.onPaste(range, { html, text });
  }

  private readonly onCaptureDrop = (event: DragEvent): void => {
    if (event.defaultPrevented || !this.quill.isEnabled()) return;
    event.preventDefault();

    const dataTransfer = event.dataTransfer;
    if (!dataTransfer) return;

    // DataTransfer.files is intentionally never inspected here — dropped
    // files are a silent no-op, text/html still drops when present.
    const range = resolveDropRange(this.quill, event) ?? this.quill.getSelection(true);
    if (range == null) return;

    const html = dataTransfer.getData("text/html");
    const text = dataTransfer.getData("text/plain");
    if (!html && !text) return;

    this.onPaste(range, { html, text });
  };
}

/** Replaces Quill's default uploader so it never reads dropped/pasted files as data URLs. */
export class NoopUploader extends Module {
  upload(): void {
    // ADR-0006 / ADR-0005: paste/drop never becomes a second media ingestion path.
  }
}

/**
 * Installs the rich-text and inline-embed clipboard/drop policy globally for every Quill
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
 * Rewrites the semantic HTML produced for the copied range (ADR-0006):
 * - Mentions and channel references remain blot DOM (<span class="tgg-mention/channel" data-*...).
 * - Emoji spans are rewritten to span text :${emojiId}: without <img>, src, or data-emoji-missing.
 * - Body media (images, videos) and dividers are stripped completely without placeholders.
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

    // Remove remaining block images and media / dividers
    doc.body
      .querySelectorAll("img, .tgg-image, video, .tgg-video, hr, .tgg-divider")
      .forEach((node) => {
        node.remove();
      });

    return doc.body.innerHTML;
  } catch {
    return html;
  }
}

/**
 * Preprocesses pasted HTML before Quill converts it to Delta (ADR-0006):
 * - Clears inner children of .tgg-emoji spans so inner <img> does not trigger
 *   Quill's ImageBlot (BlockEmbed) splitting during HTML conversion.
 * - Strips block images, videos, and horizontal rules while preserving surrounding text.
 */
export function stripPasteHtml(html: string): string {
  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, "text/html");

    // Clear inner children of emoji spans so inner <img> does not trigger ImageBlot
    doc.body.querySelectorAll(".tgg-emoji").forEach((emoji) => {
      emoji.textContent = "";
    });

    // Remove block images, videos, and dividers
    doc.body
      .querySelectorAll("img, .tgg-image, video, .tgg-video, hr, .tgg-divider")
      .forEach((node) => {
        node.remove();
      });

    return doc.body.innerHTML;
  } catch {
    return html;
  }
}

/**
 * Formats Delta content into plain text (ADR-0006):
 * - Mention: `@${displayText}`
 * - Channel: `#${displayText}`
 * - Emoji: `:${emojiId}:`
 * - Media/dividers/unknown embeds: ignored (no placeholder)
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
      }
    }
  }
  return result;
}

/**
 * Sanitizes embeds on paste/drop (ADR-0006):
 * - Whitelists valid inline embeds (mention, channel, emoji).
 * - Degrades malformed mentions / channels with missing IDs to plain text (@displayText / #displayText).
 * - Drops malformed mentions / channels with IDs but missing displayText (no internal ID exposed).
 * - Drops malformed emojis with missing IDs.
 * - Drops block media embeds (images, videos) and dividers.
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
    }
    return sanitized;
  }, new Delta());
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
