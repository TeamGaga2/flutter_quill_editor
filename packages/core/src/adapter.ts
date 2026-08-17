import type { RichTextSnapshotV1 } from "@teamgaga/richtext-delta";
import type { CaretRect, EditorCommand } from "./commands";
import type { EditorAdapterEvent, Unsubscribe } from "./events";
import type { RichTextSelection } from "./selection";
import type { EditorState } from "./state";

export interface RichTextAdapter {
  getSnapshot(): RichTextSnapshotV1;

  setSnapshot(snapshot: RichTextSnapshotV1): void;

  /** Updates snapshot title metadata without resetting document content. */
  setTitle(title: string): void;

  getSelection(): RichTextSelection | null;

  setSelection(selection: RichTextSelection): void;

  /**
   * Caret (or selection start) bounds in CSS pixels relative to the WebView viewport.
   * Returns null when no selection/caret is available.
   */
  getCaretRect(): CaretRect | null;

  getState(): EditorState;

  focus(): void;

  blur(): void;

  execute(command: EditorCommand): void;

  subscribe(listener: (event: EditorAdapterEvent) => void): Unsubscribe;

  destroy(): void;
}
