import type { RichTextSnapshotV1 } from "@teamgaga/richtext-delta";
import type { ProtocolHeaderLevel, ProtocolListType, ProtocolSelection } from "./commands";
import type { ProtocolEvent } from "./envelope";
import type { ProtocolVersion } from "./version";

export interface ProtocolEditorFormats {
  bold: boolean;
  italic: boolean;
  underline: boolean;
  strike: boolean;
  header: ProtocolHeaderLevel | false;
  list: ProtocolListType | false;
  blockquote: boolean;
}

export interface ProtocolEditorState {
  focused: boolean;
  selection: ProtocolSelection | null;
  canUndo: boolean;
  canRedo: boolean;
  /** Formats at the active selection, or the last valid selection while blurred. */
  formats: ProtocolEditorFormats;
}

export type ReadyEvent = ProtocolEvent<"ready", { protocol_version: ProtocolVersion }>;
export type ChangeEvent = ProtocolEvent<"change", { snapshot: RichTextSnapshotV1 }>;
export type SelectionChangeEvent = ProtocolEvent<
  "selection_change",
  { selection: ProtocolSelection | null }
>;
export type FocusEvent = ProtocolEvent<"focus", Record<string, never>>;
export type BlurEvent = ProtocolEvent<"blur", Record<string, never>>;
/** Title input (WebView shell) took focus — host disables chrome while editing title. */
export type TitleFocusEvent = ProtocolEvent<"title_focus", Record<string, never>>;
/** Title input (WebView shell) lost focus. */
export type TitleBlurEvent = ProtocolEvent<"title_blur", Record<string, never>>;
export type StateChangeEvent = ProtocolEvent<"state_change", { state: ProtocolEditorState }>;
/** Web→Flutter UI intent: close the host editor shell. */
export type RequestCloseEvent = ProtocolEvent<"request_close", Record<string, never>>;
export type RequestInsertSelectionPayload = { selection: ProtocolSelection | null };
/** Web→Flutter UI intent: request host to open emoji picker. */
export type RequestEmojiEvent = ProtocolEvent<"request_emoji", RequestInsertSelectionPayload>;
/** Web→Flutter UI intent: request host to open mention selector. */
export type RequestMentionEvent = ProtocolEvent<"request_mention", RequestInsertSelectionPayload>;
/** Web→Flutter UI intent: request host to open channel selector. */
export type RequestChannelEvent = ProtocolEvent<"request_channel", RequestInsertSelectionPayload>;
/** Web→Flutter UI intent: request host to open media picker. */
export type RequestImageEvent = ProtocolEvent<"request_image", RequestInsertSelectionPayload>;

export interface RequestPasteMediaPayload {
  mimeType: string;
  fileSize: number;
  width?: string;
  height?: string;
  dataBase64: string;
  fileName?: string;
  isVideo?: boolean;
  duration?: number;
  selection: ProtocolSelection | null;
}

/** Web→Flutter UI intent: user pasted or dropped a media file onto the editor surface. */
export type RequestPasteMediaEvent = ProtocolEvent<"request_paste_media", RequestPasteMediaPayload>;

export type EditorEventMessage =
  | ReadyEvent
  | ChangeEvent
  | SelectionChangeEvent
  | FocusEvent
  | BlurEvent
  | TitleFocusEvent
  | TitleBlurEvent
  | StateChangeEvent
  | RequestCloseEvent
  | RequestEmojiEvent
  | RequestMentionEvent
  | RequestChannelEvent
  | RequestImageEvent
  | RequestPasteMediaEvent;

export type EditorEventType = EditorEventMessage["type"];
