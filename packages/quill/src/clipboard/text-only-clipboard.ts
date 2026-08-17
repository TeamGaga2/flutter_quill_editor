import Quill, { Delta, type Range as QuillRange } from "quill";
import Module from "quill/core/module";
import Clipboard from "quill/modules/clipboard";

/**
 * ADR-0016: the IM Editor Surface accepts textual clipboard/drop data only.
 * Rich HTML may keep the inline/block formats Quill already supports, but
 * every embed (image, video, mention, channel, emoji, divider, ...) is
 * stripped, and `DataTransfer.files` is never read on paste or drop — no
 * upload, no local-media token, no placeholder, no error.
 */
class TextOnlyClipboard extends Clipboard {
  constructor(...args: ConstructorParameters<typeof Clipboard>) {
    super(...args);
    this.quill.root.addEventListener("drop", this.onCaptureDrop);
  }

  override convert(
    source: { html?: string; text?: string },
    formats: Record<string, unknown> = {},
  ): Delta {
    const html = source.html ? stripBlockEmbedTags(source.html) : source.html;
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
class NoopUploader extends Module {
  upload(): void {
    // ADR-0016: paste/drop never becomes a second media ingestion path.
  }
}

/**
 * Installs the text-only clipboard/drop policy globally for every Quill
 * instance created afterwards. Mirrors `registerBlots()`: call once before
 * constructing a `Quill` instance.
 */
export function installTextOnlyClipboardPolicy(): void {
  Quill.register(
    {
      "modules/clipboard": TextOnlyClipboard,
      "modules/uploader": NoopUploader,
    },
    true,
  );
}

/** Drops non-string inserts (images, mentions, emoji embeds, …). */
export function stripEmbeds(delta: Delta): Delta {
  return delta.reduce((sanitized, op) => {
    if (typeof op.insert !== "string") {
      return sanitized;
    }
    return sanitized.insert(op.insert, op.attributes);
  }, new Delta());
}

/**
 * Tags Quill parses into BLOCK embeds must not leave stray newlines once
 * stripEmbeds drops the embed op: pasting `<p>Before<img>After</p>` must keep
 * the text flowing inline as `BeforeAfter`. The `<img>` tag maps to the
 * tgg-image BlockEmbed (tagName img), so removing the tag from the HTML before
 * Quill walks it preserves the ADR-0016 text-only contract.
 */
function stripBlockEmbedTags(html: string): string {
  return html.replace(/<img\b[^>]*\/?>/gi, "");
}

function normalizeUriList(uriList: string): string {
  return uriList
    .split(/\r?\n/)
    .filter((url) => url[0] !== "#")
    .join("\n");
}

interface CaretPositionFromPoint {
  caretPositionFromPoint(x: number, y: number): { offsetNode: Node; offset: number } | null;
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
