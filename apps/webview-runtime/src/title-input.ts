import type { RichTextEditor } from "@teamgaga/richtext-core";

export interface TitleInputOptions {
  placeholder: string;
  onFocus: () => void;
  onBlur: () => void;
  onEnter: () => void;
}

export interface TitleInputHandle {
  readonly element: HTMLTextAreaElement;
  syncFromTitle(title: string | undefined): void;
  bindEditor(editor: RichTextEditor): void;
  destroy(): void;
}

/**
 * Multiline title field for the Flutter Content-Only Shell (PC).
 * Figma: Font Size/XL 20, Line Height/LG 28, Semibold, Text/02; vertical pad 8
 * (single-line height 44). Placeholder uses Text/04.
 */
export function createTitleInput(options: TitleInputOptions): TitleInputHandle {
  const textarea = document.createElement("textarea");
  textarea.className = "tg-webview-title-input";
  textarea.setAttribute("rows", "1");
  textarea.setAttribute("aria-label", "Title");
  textarea.placeholder = options.placeholder;
  textarea.autocomplete = "off";
  textarea.spellcheck = false;

  let editor: RichTextEditor | null = null;
  let unsubscribeChange: (() => void) | undefined;
  let syncing = false;

  const autoResize = (): void => {
    textarea.style.height = "auto";
    textarea.style.height = `${textarea.scrollHeight}px`;
  };

  textarea.addEventListener("input", () => {
    autoResize();
    if (syncing || !editor) {
      return;
    }
    editor.setTitle(textarea.value);
  });

  textarea.addEventListener("focus", () => {
    options.onFocus();
  });

  textarea.addEventListener("blur", () => {
    options.onBlur();
  });

  textarea.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" || event.shiftKey) {
      return;
    }
    event.preventDefault();
    options.onEnter();
  });

  return {
    element: textarea,

    syncFromTitle(title: string | undefined) {
      const next = title ?? "";
      if (textarea.value === next) {
        autoResize();
        return;
      }
      syncing = true;
      textarea.value = next;
      autoResize();
      syncing = false;
    },

    bindEditor(nextEditor: RichTextEditor) {
      unsubscribeChange?.();
      editor = nextEditor;
      unsubscribeChange = editor.on("change", () => {
        if (document.activeElement === textarea) {
          return;
        }
        const snapshotTitle = editor?.getSnapshot().title;
        syncing = true;
        textarea.value = snapshotTitle ?? "";
        autoResize();
        syncing = false;
      });
      const initialTitle = editor.getSnapshot().title;
      syncing = true;
      textarea.value = initialTitle ?? "";
      autoResize();
      syncing = false;
    },

    destroy() {
      unsubscribeChange?.();
      unsubscribeChange = undefined;
      editor = null;
      textarea.remove();
    },
  };
}
