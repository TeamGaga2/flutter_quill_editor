import { ErrorBoundary, createEffect, type JSX } from "solid-js";
import type { RichTextEditor as CoreRichTextEditor } from "@teamgaga/richtext-core";
import {
  createRichTextEditor,
  RichTextEditor,
  RichTextProvider,
  type RichTextAdapterFactory,
  type SolidRichTextController,
} from "@teamgaga/richtext-solid";

export interface HostAppProps {
  onEditorReady: (editor: CoreRichTextEditor) => void;
  onEditorFailed?: (error: unknown) => void;
  adapterFactory?: RichTextAdapterFactory;
  /** Optional chrome inside `RichTextProvider` (e.g. desktop toolbar). Host never imports toolbar. */
  renderChrome?: () => JSX.Element;
  /**
   * Optional DOM header (e.g. title input wrap) rendered between chrome and the
   * editor body so layout stays: toolbar → title → body.
   */
  headerElement?: HTMLElement;
}

export function HostApp(props: HostAppProps): JSX.Element {
  const controller: SolidRichTextController = createRichTextEditor({
    adapterFactory: props.adapterFactory,
  });
  let notified = false;

  createEffect(() => {
    const editor = controller.editor();

    if (!editor || notified) {
      return;
    }

    notified = true;
    props.onEditorReady(editor);
  });

  return (
    <ErrorBoundary
      fallback={(error) => {
        if (!notified) {
          notified = true;
          props.onEditorFailed?.(error);
        }
        return null;
      }}
    >
      <RichTextProvider editor={controller}>
        {props.renderChrome?.()}
        {props.headerElement ? (
          <div
            class="tg-webview-header-slot"
            ref={(slot) => {
              const header = props.headerElement;
              if (!slot || !header) return;
              if (header.parentElement !== slot) {
                slot.replaceChildren(header);
              }
            }}
          />
        ) : null}
        <RichTextEditor class="tg-richtext-host-editor" aria-label="Rich text editor" />
      </RichTextProvider>
    </ErrorBoundary>
  );
}
