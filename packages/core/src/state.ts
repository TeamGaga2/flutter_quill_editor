import type { HeaderLevel, ListType } from "./commands";
import type { RichTextSelection } from "./selection";

export interface EditorFormats {
  bold: boolean;
  italic: boolean;
  underline: boolean;
  strike: boolean;
  header: HeaderLevel | false;
  list: ListType | false;
  blockquote: boolean;
}

export interface EditorState {
  focused: boolean;
  selection: RichTextSelection | null;
  canUndo: boolean;
  canRedo: boolean;
  formats: EditorFormats;
}
