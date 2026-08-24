import type { RichTextSelection } from "./selection";
import type { EditorState } from "./state";

export interface PasteMediaPayload {
  mimeType: string;
  fileSize: number;
  dataBase64: string;
  width?: string;
  height?: string;
  fileName?: string;
  isVideo?: boolean;
  duration?: number;
  selection: RichTextSelection | null;
}

export type EditorAdapterEvent =
  | {
      type: "change";
    }
  | {
      type: "selection-change";
      selection: RichTextSelection | null;
    }
  | {
      type: "focus";
    }
  | {
      type: "blur";
    }
  | {
      type: "state-change";
      state: EditorState;
    }
  | {
      type: "paste-media";
      payload: PasteMediaPayload;
    };

export type EditorEvent =
  | EditorAdapterEvent
  | {
      type: "ready";
    };

export type EditorEventType = EditorEvent["type"];

export type EditorEventListener<Type extends EditorEventType = EditorEventType> = (
  event: Extract<EditorEvent, { type: Type }>,
) => void;

export type Unsubscribe = () => void;
