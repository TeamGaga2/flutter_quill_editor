import type { RichTextSnapshotV1 } from "@teamgaga/richtext-delta";
import type { ProtocolCommand } from "./envelope";

export type ProtocolInlineFormat = "bold" | "italic" | "underline" | "strike";
export type ProtocolHeaderLevel = 1 | 2 | 3;
export type ProtocolListType = "ordered" | "bullet";

export interface ProtocolSelection {
  start: number;
  end: number;
}

export interface ProtocolImageAttributes {
  width: string;
  height: string;
  mimeType: string;
  fileSize: number;
}

export interface ProtocolVideoAttributes extends ProtocolImageAttributes {
  poster?: string;
  duration?: number;
}

export type SetSnapshotCommand = ProtocolCommand<"set_snapshot", { snapshot: RichTextSnapshotV1 }>;
export type GetSnapshotCommand = ProtocolCommand<"get_snapshot", Record<string, never>>;
export type SetSelectionCommand = ProtocolCommand<
  "set_selection",
  { selection: ProtocolSelection }
>;
export type GetSelectionCommand = ProtocolCommand<"get_selection", Record<string, never>>;
export type ToggleInlineFormatCommand = ProtocolCommand<
  "toggle_inline_format",
  { format: ProtocolInlineFormat }
>;
export type ToggleBlockFormatCommand =
  | ProtocolCommand<"toggle_block_format", { format: "header"; value: ProtocolHeaderLevel }>
  | ProtocolCommand<"toggle_block_format", { format: "list"; value: ProtocolListType }>
  | ProtocolCommand<"toggle_block_format", { format: "blockquote" }>;
export type InsertEmojiCommand = ProtocolCommand<"insert_emoji", { id: string }>;
export type InsertMentionCommand = ProtocolCommand<
  "insert_mention",
  {
    id: string;
    sign: "!" | "&";
    displayText: string;
    selection?: ProtocolSelection;
  }
>;
export type InsertChannelCommand = ProtocolCommand<
  "insert_channel",
  {
    id: string;
    displayText: string;
    selection?: ProtocolSelection;
  }
>;
export type InsertImageCommand = ProtocolCommand<
  "insert_image",
  ProtocolImageAttributes & { src: string; selection?: ProtocolSelection }
>;
export type InsertVideoCommand = ProtocolCommand<
  "insert_video",
  ProtocolVideoAttributes & { src: string; selection?: ProtocolSelection }
>;
export type InsertLinkCommand = ProtocolCommand<
  "insert_link",
  { url: string; text: string; selection?: ProtocolSelection }
>;
export type InsertDividerCommand = ProtocolCommand<
  "insert_divider",
  { selection?: ProtocolSelection }
>;
export type IndentCommand = ProtocolCommand<"indent", Record<string, never>>;
export type OutdentCommand = ProtocolCommand<"outdent", Record<string, never>>;
/** Pixel rect relative to the WebView viewport (CSS pixels). */
export interface ProtocolCaretRect {
  x: number;
  y: number;
  width: number;
  height: number;
}
export type GetCaretRectCommand = ProtocolCommand<"get_caret_rect", Record<string, never>>;
export type UndoCommand = ProtocolCommand<"undo", Record<string, never>>;
export type RedoCommand = ProtocolCommand<"redo", Record<string, never>>;
export type FocusCommand = ProtocolCommand<"focus", Record<string, never>>;
export type BlurCommand = ProtocolCommand<"blur", Record<string, never>>;

export type EditorCommandMessage =
  | SetSnapshotCommand
  | GetSnapshotCommand
  | SetSelectionCommand
  | GetSelectionCommand
  | ToggleInlineFormatCommand
  | ToggleBlockFormatCommand
  | InsertEmojiCommand
  | InsertMentionCommand
  | InsertChannelCommand
  | InsertImageCommand
  | InsertVideoCommand
  | InsertLinkCommand
  | InsertDividerCommand
  | IndentCommand
  | OutdentCommand
  | GetCaretRectCommand
  | UndoCommand
  | RedoCommand
  | FocusCommand
  | BlurCommand;

export type EditorCommandType = EditorCommandMessage["type"];
