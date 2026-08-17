import type { RichTextEditor, RichTextSelection } from "@teamgaga/richtext-core";

/**
 * Context passed when the desktop toolbar asks the host to open a link dialog.
 * The toolbar never builds an in-web link form; the host (or app shell) owns UI
 * and applies the result via Core `insertLink` / Protocol `insert_link`.
 *
 * Webview desktop chrome should forward this to `RichTextHost.requestLink`,
 * which emits Protocol event `request_link` to Flutter.
 */
export interface LinkRequestContext {
  selection: RichTextSelection | null;
  /** Plain text under the current selection, if any (host dialog prefill). */
  selectedText: string;
}

export type RequestLinkHandler = (context: LinkRequestContext) => void;

/** Collect plain text under a selection for host link-dialog prefill. */
export function getSelectedPlainText(editor: RichTextEditor): string {
  const selection = editor.getSelection();
  if (!selection || selection.start === selection.end) {
    return "";
  }

  const { content } = editor.getSnapshot();
  let index = 0;
  let text = "";

  for (const operation of content) {
    if (typeof operation.insert === "string") {
      const length = operation.insert.length;
      const start = Math.max(0, selection.start - index);
      const end = Math.min(length, selection.end - index);
      if (start < end) {
        text += operation.insert.slice(start, end);
      }
      index += length;
      continue;
    }

    // Embeds occupy one document index; skip non-text content.
    index += 1;
  }

  return text;
}

export function buildLinkRequestContext(editor: RichTextEditor): LinkRequestContext {
  return {
    selection: editor.getSelection(),
    selectedText: getSelectedPlainText(editor),
  };
}
