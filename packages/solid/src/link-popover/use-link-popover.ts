import { createMemo, createSignal, type Accessor } from "solid-js";
import type { RichTextEditor, RichTextSelection } from "@teamgaga/richtext-core";
import { resolveLinkPopoverLabels } from "./labels";
import { extractLinkContext } from "./link-selection";
import type {
  LinkFormState,
  LinkPopoverAnchor,
  LinkPopoverController,
  LinkPopoverLabels,
} from "./types";
import { isValidUrl } from "./url";

export interface UseLinkPopoverOptions {
  editor: Accessor<RichTextEditor | undefined>;
  locale?: Accessor<string | undefined> | string;
  isMobile?: Accessor<boolean> | boolean;
}

export function useLinkPopover(options: UseLinkPopoverOptions): LinkPopoverController {
  const [isOpen, setIsOpen] = createSignal(false);
  const [url, setUrl] = createSignal("");
  const [text, setText] = createSignal("");
  const [range, setRange] = createSignal<RichTextSelection | null>(null);
  const [anchor, setAnchor] = createSignal<LinkPopoverAnchor | null>(null);
  const [isEditingExisting, setIsEditingExisting] = createSignal(false);

  const getLocale = (): string | undefined => {
    if (typeof options.locale === "function") {
      return options.locale();
    }
    return options.locale;
  };

  const getIsMobile = (): boolean => {
    if (typeof options.isMobile === "function") {
      return options.isMobile();
    }
    if (typeof options.isMobile === "boolean") {
      return options.isMobile;
    }
    if (typeof window !== "undefined" && window.innerWidth <= 480) {
      return true;
    }
    return false;
  };

  const labels = createMemo<LinkPopoverLabels>(() => resolveLinkPopoverLabels(getLocale()));

  const canSubmit = createMemo<boolean>(() => {
    const trimmedText = text().trim();
    const trimmedUrl = url().trim();
    return trimmedText.length > 0 && isValidUrl(trimmedUrl);
  });

  const isMobileModal = createMemo<boolean>(() => getIsMobile());

  const state = createMemo<LinkFormState>(() => ({
    isOpen: isOpen(),
    url: url(),
    text: text(),
    range: range(),
    anchor: anchor(),
    isEditingExisting: isEditingExisting(),
    isMobileModal: isMobileModal(),
  }));

  const open = (): void => {
    const editor = options.editor();
    if (!editor) {
      return;
    }

    const context = extractLinkContext(editor);
    setUrl(context.url);
    setText(context.text);
    setRange(context.range);
    setIsEditingExisting(context.isEditingExisting);

    const caretRect = editor.getCaretRect();
    if (caretRect) {
      setAnchor({
        x: caretRect.x,
        y: caretRect.y,
        width: caretRect.width,
        height: caretRect.height,
      });
    } else {
      setAnchor(null);
    }

    setIsOpen(true);
  };

  const close = (): void => {
    if (!isOpen()) {
      return;
    }
    setIsOpen(false);
    const editor = options.editor();
    if (editor) {
      editor.focus();
    }
  };

  const submit = (): void => {
    if (!canSubmit()) {
      return;
    }

    const editor = options.editor();
    if (!editor) {
      return;
    }

    const trimmedUrl = url().trim();
    const trimmedText = text().trim();
    const targetRange = range() ?? editor.getSelection() ?? undefined;

    editor.commands.insertLink(
      {
        url: trimmedUrl,
        text: trimmedText,
      },
      targetRange,
    );

    setIsOpen(false);
    editor.focus();
  };

  return {
    state,
    isOpen,
    url,
    text,
    range,
    anchor,
    isEditingExisting,
    isMobileModal,
    labels,
    canSubmit,
    open,
    close,
    setUrl,
    setText,
    submit,
  };
}
