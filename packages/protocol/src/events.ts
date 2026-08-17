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
/** Web→Flutter UI intent: open host link dialog (e.g. desktop Solid toolbar). */
export type RequestLinkEvent = ProtocolEvent<"request_link", { selection?: ProtocolSelection }>;
/** Web→Flutter UI intent: close the host editor shell. */
export type RequestCloseEvent = ProtocolEvent<"request_close", Record<string, never>>;

export type EditorEventMessage =
  | ReadyEvent
  | ChangeEvent
  | SelectionChangeEvent
  | FocusEvent
  | BlurEvent
  | TitleFocusEvent
  | TitleBlurEvent
  | StateChangeEvent
  | RequestLinkEvent
  | RequestCloseEvent;

export type EditorEventType = EditorEventMessage["type"];
