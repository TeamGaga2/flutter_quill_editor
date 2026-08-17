import { createSignal, onCleanup, type Accessor } from "solid-js";
import { createEditor, type RichTextEditor as CoreRichTextEditor } from "@teamgaga/richtext-core";
import {
  createSolidAdapterFactory,
  type RichTextAdapterFactory,
  type SolidAdapterOptions,
} from "../adapters/solidAdapter";

export interface UseRichTextEditorOptions extends SolidAdapterOptions {
  adapterFactory?: RichTextAdapterFactory;
}

export interface SolidRichTextController {
  readonly editor: Accessor<CoreRichTextEditor | undefined>;

  mount(element: HTMLElement): CoreRichTextEditor;
  destroy(): void;
}

export function createRichTextEditor(
  options: UseRichTextEditorOptions = {},
): SolidRichTextController {
  const adapterFactory =
    options.adapterFactory ??
    createSolidAdapterFactory({
      emojiRegistry: options.emojiRegistry,
    });
  const [editor, setEditor] = createSignal<CoreRichTextEditor>();

  const destroy = (): void => {
    const currentEditor = editor();

    if (!currentEditor) {
      return;
    }

    currentEditor.destroy();
    setEditor(undefined);
  };

  const controller: SolidRichTextController = {
    editor,

    mount(element) {
      const currentEditor = editor();

      if (currentEditor) {
        return currentEditor;
      }

      const nextEditor = createEditor({
        adapter: adapterFactory(element),
      });

      try {
        nextEditor.mount();
      } catch (error) {
        nextEditor.destroy();
        throw error;
      }

      setEditor(nextEditor);
      return nextEditor;
    },

    destroy,
  };

  onCleanup(destroy);

  return controller;
}

export function useRichTextEditor(options: UseRichTextEditorOptions = {}): SolidRichTextController {
  return createRichTextEditor(options);
}
