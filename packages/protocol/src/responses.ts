import type { RichTextSnapshotV1 } from "@teamgaga/richtext-delta";
import type { EditorCommandType, ProtocolCaretRect, ProtocolSelection } from "./commands";
import type { ProtocolFailure, ProtocolSuccess } from "./envelope";

export type EmptyCommandSuccessType = Exclude<
  EditorCommandType,
  "get_snapshot" | "get_selection" | "get_caret_rect"
>;

export type EmptyCommandSuccess = ProtocolSuccess<EmptyCommandSuccessType, Record<string, never>>;
export type GetSnapshotSuccess = ProtocolSuccess<"get_snapshot", { snapshot: RichTextSnapshotV1 }>;
export type GetSelectionSuccess = ProtocolSuccess<
  "get_selection",
  { selection: ProtocolSelection | null }
>;
export type GetCaretRectSuccess = ProtocolSuccess<
  "get_caret_rect",
  { rect: ProtocolCaretRect | null }
>;

export type EditorSuccessResponse =
  | EmptyCommandSuccess
  | GetSnapshotSuccess
  | GetSelectionSuccess
  | GetCaretRectSuccess;
export type EditorFailureResponse = ProtocolFailure;
export type EditorResponseMessage = EditorSuccessResponse | EditorFailureResponse;
