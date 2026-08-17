export interface RichTextSelection {
  start: number;
  end: number;
}

export function assertValidSelection(selection: RichTextSelection): void {
  if (!Number.isInteger(selection.start) || selection.start < 0) {
    throw new Error("Selection start must be a non-negative integer.");
  }

  if (!Number.isInteger(selection.end) || selection.end < selection.start) {
    throw new Error("Selection end must be an integer greater than or equal to start.");
  }
}
