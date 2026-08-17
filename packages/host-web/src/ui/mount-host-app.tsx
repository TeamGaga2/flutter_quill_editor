import type { RichTextEditor as CoreRichTextEditor } from "@teamgaga/richtext-core";
import type { RichTextAdapterFactory } from "@teamgaga/richtext-solid";
import type { JSX } from "solid-js";
import { render } from "solid-js/web";
import { HostApp } from "./HostApp";

export interface MountHostAppOptions {
  adapterFactory?: RichTextAdapterFactory;
  renderChrome?: () => JSX.Element;
  /** Optional DOM header between chrome and editor (toolbar → title → body). */
  headerElement?: HTMLElement;
}

export interface MountedHostApp {
  readonly editorReady: Promise<CoreRichTextEditor>;
  dispose(): void;
}

export function mountHostApp(root: HTMLElement, options: MountHostAppOptions = {}): MountedHostApp {
  let settled = false;
  let resolveEditor!: (editor: CoreRichTextEditor) => void;
  let rejectEditor!: (error: unknown) => void;
  let disposed = false;
  let disposeRender: (() => void) | undefined;

  const editorReady = new Promise<CoreRichTextEditor>((resolve, reject) => {
    resolveEditor = resolve;
    rejectEditor = reject;
  });

  // Prevent unhandled rejection when dispose rejects before settle and no one awaits.
  editorReady.catch(() => undefined);

  const settleReject = (error: unknown): void => {
    if (settled || disposed) {
      return;
    }

    settled = true;
    rejectEditor(error);
  };

  const settleResolve = (editor: CoreRichTextEditor): void => {
    if (settled || disposed) {
      return;
    }

    settled = true;
    resolveEditor(editor);
  };

  try {
    disposeRender = render(
      () => (
        <HostApp
          adapterFactory={options.adapterFactory}
          renderChrome={options.renderChrome}
          headerElement={options.headerElement}
          onEditorReady={settleResolve}
          onEditorFailed={settleReject}
        />
      ),
      root,
    );
  } catch (error) {
    root.replaceChildren();
    settleReject(error);
    throw error;
  }

  return {
    editorReady,

    dispose() {
      if (disposed) {
        return;
      }

      disposed = true;

      try {
        disposeRender?.();
      } catch {
        // best-effort
      }

      try {
        root.replaceChildren();
      } catch {
        // best-effort
      }

      if (!settled) {
        settled = true;
        rejectEditor(new Error("HostApp disposed before editor became ready."));
      }
    },
  };
}
