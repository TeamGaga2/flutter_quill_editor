import { createEffect, createSignal, onCleanup, type Accessor } from "solid-js";
import type { EditorState } from "@teamgaga/richtext-core";
import { useRichText } from "../context/RichTextContext";
import type { SolidRichTextController } from "./useRichTextEditor";

export const EMPTY_EDITOR_STATE: EditorState = {
  focused: false,
  selection: null,
  canUndo: false,
  canRedo: false,
  formats: {
    bold: false,
    italic: false,
    underline: false,
    strike: false,
    header: false,
    list: false,
    blockquote: false,
  },
};

export function useEditorState(controller?: SolidRichTextController): Accessor<EditorState> {
  const resolvedController = controller ?? useRichText();
  const [state, setState] = createSignal<EditorState>(EMPTY_EDITOR_STATE);

  createEffect(() => {
    const editor = resolvedController.editor();

    if (!editor) {
      setState(EMPTY_EDITOR_STATE);
      return;
    }

    setState(editor.getState());

    const unsubscribe = editor.on("state-change", (event) => {
      setState(event.state);
    });

    onCleanup(unsubscribe);
  });

  return state;
}
