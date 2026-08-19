import type { RichTextEditor, RichTextSelection } from "@teamgaga/richtext-core";

export interface ExtractedLinkContext {
  range: RichTextSelection | null;
  text: string;
  url: string;
  isEditingExisting: boolean;
}

interface DeltaOpWithLink {
  insert?: unknown;
  attributes?: {
    link?: string;
    [key: string]: unknown;
  };
}

export function extractLinkContext(editor: RichTextEditor): ExtractedLinkContext {
  const selection = editor.getSelection();
  if (!selection) {
    return {
      range: null,
      text: "",
      url: "",
      isEditingExisting: false,
    };
  }

  const { content } = editor.getSnapshot();
  const { start, end } = selection;

  // Case 1: Collapsed selection (caret at a point)
  if (start === end) {
    let offset = 0;
    for (const rawOp of content) {
      const op = rawOp as DeltaOpWithLink;
      if (typeof op.insert === "string") {
        const opLen = op.insert.length;
        const opStart = offset;
        const opEnd = offset + opLen;
        offset += opLen;

        const linkAttr = op.attributes?.link;
        if (typeof linkAttr === "string" && linkAttr.trim().length > 0) {
          // Caret is inside or right at the boundary of this link op
          if (start >= opStart && start <= opEnd && opStart < opEnd) {
            return {
              range: { start: opStart, end: opEnd },
              text: op.insert,
              url: linkAttr,
              isEditingExisting: true,
            };
          }
        }
      } else {
        offset += 1;
      }
    }

    return {
      range: selection,
      text: "",
      url: "",
      isEditingExisting: false,
    };
  }

  // Case 2: Range selection
  let offset = 0;
  let selectedText = "";
  let matchedLinkUrl = "";

  for (const rawOp of content) {
    const op = rawOp as DeltaOpWithLink;
    if (typeof op.insert === "string") {
      const opLen = op.insert.length;
      const opStart = offset;
      const sliceStart = Math.max(0, start - opStart);
      const sliceEnd = Math.min(opLen, end - opStart);

      if (sliceStart < sliceEnd) {
        selectedText += op.insert.slice(sliceStart, sliceEnd);
        const linkAttr = op.attributes?.link;
        if (typeof linkAttr === "string" && linkAttr.trim().length > 0) {
          matchedLinkUrl = linkAttr;
        }
      }
      offset += opLen;
    } else {
      offset += 1;
    }
  }

  return {
    range: selection,
    text: selectedText,
    url: matchedLinkUrl,
    isEditingExisting: Boolean(matchedLinkUrl),
  };
}
