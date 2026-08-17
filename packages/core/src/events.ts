import type { RichTextSelection } from "./selection";
import type { EditorState } from "./state";

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
