import { createEffect, onCleanup, type Accessor, type JSX, type ParentProps } from "solid-js";
import type { RichTextEditor } from "@teamgaga/richtext-core";
import { LinkPopover } from "./LinkPopover";
import type { LinkPopoverController } from "./types";
import { useLinkPopover } from "./use-link-popover";

export type LinkPopoverHostProps = ParentProps<{
  editor: Accessor<RichTextEditor | undefined>;
  locale?: Accessor<string | undefined> | string;
  isMobile?: Accessor<boolean> | boolean;
  controller?: LinkPopoverController;
  onControllerReady?: (controller: LinkPopoverController) => void;
}>;

export function LinkPopoverHost(props: LinkPopoverHostProps): JSX.Element {
  const internalController = useLinkPopover({
    editor: props.editor,
    locale: props.locale,
    isMobile: props.isMobile,
  });

  const controller = () => props.controller ?? internalController;

  props.onControllerReady?.(controller());

  createEffect(() => {
    const handleKeyDown = (e: KeyboardEvent): void => {
      const isCmdOrCtrl = e.metaKey || e.ctrlKey;
      if (isCmdOrCtrl && (e.key === "k" || e.key === "K") && !e.shiftKey && !e.altKey) {
        const currentEditor = props.editor();
        const active = typeof document !== "undefined" ? document.activeElement : null;
        const isEditorFocused =
          currentEditor?.getState().focused ||
          Boolean(active && active.classList?.contains("ql-editor"));

        if (currentEditor && isEditorFocused) {
          e.preventDefault();
          e.stopPropagation();
          controller().open();
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown, true);
    onCleanup(() => {
      window.removeEventListener("keydown", handleKeyDown, true);
    });
  });

  return (
    <>
      {props.children}
      <LinkPopover controller={controller()} />
    </>
  );
}
