import { onCleanup, onMount, type JSX } from "solid-js";
import { useRichText } from "../context/RichTextContext";
import type { SolidRichTextController } from "../hooks/useRichTextEditor";

export interface RichTextEditorProps {
  editor?: SolidRichTextController;
  id?: string;
  class?: string;
  classList?: Record<string, boolean | undefined>;
  "aria-label"?: string;
}

export function RichTextEditor(props: RichTextEditorProps): JSX.Element {
  const controller = props.editor ?? useRichText();
  let container: HTMLDivElement | undefined;

  onMount(() => {
    if (!container) {
      throw new Error("RichTextEditor container was not mounted.");
    }

    controller.mount(container);
  });

  onCleanup(() => {
    controller.destroy();
  });

  return (
    <div
      ref={(element) => {
        container = element;
      }}
      id={props.id}
      class={props.class}
      classList={props.classList}
      aria-label={props["aria-label"]}
    />
  );
}
