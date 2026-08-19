import type { Accessor, JSX } from "solid-js";
import type { RichTextEditor } from "@teamgaga/richtext-core";
import { useRichText, type SolidRichTextController } from "@teamgaga/richtext-solid";
import { buildLinkRequestContext, type RequestLinkHandler } from "../commands/link-request";
import { browserToolbarLabels } from "../i18n/toolbar-labels";
import { useToolbarState } from "../hooks/useToolbarState";
import { HeaderStyleMenu, type HeaderStyleValue } from "./HeaderStyleMenu";
import { ToolbarButton } from "./ToolbarButton";
import {
  IconBlockquote,
  IconBold,
  IconBulletedList,
  IconClose,
  IconDividingLine,
  IconItalic,
  IconLeftIndent,
  IconLink,
  IconNumberedList,
  IconRightIndent,
  IconUnderline,
} from "./icons/ToolbarIcons";

export interface RichTextToolbarProps {
  editor?: SolidRichTextController;
  id?: string;
  class?: string;
  "aria-label"?: string;
  /**
   * Open the in-WebView link popover / modal.
   */
  onOpenLinkForm?: () => void;
  /**
   * Host extension: open a native/app link dialog.
   * @deprecated In Protocol v2, use onOpenLinkForm for in-WebView link popover.
   */
  onRequestLink?: RequestLinkHandler;
  /** Host extension: close the native/app editor shell. */
  onRequestClose?: () => void;
  /** True while the host title input owns focus. */
  titleFocused?: boolean | Accessor<boolean>;
}

export function RichTextToolbar(props: RichTextToolbarProps): JSX.Element {
  // Resolve the browser language once at mount; language changes apply on refresh.
  const labels = browserToolbarLabels();
  const controller = props.editor ?? useRichText();
  const state = useToolbarState(controller, {
    get canRequestLink() {
      return props.onOpenLinkForm !== undefined || props.onRequestLink !== undefined;
    },
    get titleFocused() {
      return props.titleFocused;
    },
  });
  const run =
    (command: (editor: RichTextEditor) => void, options?: { restoreFocus?: boolean }) =>
    (): void => {
      const editor = controller.editor();

      if (!editor) {
        return;
      }

      command(editor);
      // Restore only when the format actually cost us the caret. Focusing an
      // already-focused editor re-emits protocol `focus`, and the host reacts to
      // that by re-entering WebView2's native focus path, which drops the caret.
      // Link/Close skip restore — they hand off to host chrome.
      if (options?.restoreFocus !== false) {
        restoreFocus(editor);
      }
    };

  const restoreFocus = (editor: RichTextEditor): void => {
    if (editor.getState().focused) {
      return;
    }

    editor.focus();
  };

  const headerValue = (): HeaderStyleValue => {
    if (state().header1.active) return 1;
    if (state().header2.active) return 2;
    if (state().header3.active) return 3;
    return "body";
  };

  const applyHeader = (value: HeaderStyleValue): void => {
    const editor = controller.editor();
    if (!editor) return;

    const activeHeader = state().header1.active
      ? 1
      : state().header2.active
        ? 2
        : state().header3.active
          ? 3
          : undefined;

    if (value === "body") {
      if (activeHeader) {
        editor.commands.toggleHeader(activeHeader);
      }
    } else if (activeHeader !== value) {
      editor.commands.toggleHeader(value);
    }

    restoreFocus(editor);
  };

  return (
    <div
      id={props.id}
      class={props.class}
      role="toolbar"
      aria-label={props["aria-label"] ?? "Text formatting"}
    >
      <HeaderStyleMenu
        label={labels.header}
        value={headerValue()}
        disabled={state().header1.disabled}
        onSelect={applyHeader}
      />
      <ToolbarButton
        label={labels.bold}
        tooltip={labels.bold}
        active={state().bold.active}
        disabled={state().bold.disabled}
        onPress={run((editor) => editor.commands.toggleBold())}
      >
        <IconBold size={20} />
      </ToolbarButton>
      <ToolbarButton
        label={labels.italic}
        tooltip={labels.italic}
        active={state().italic.active}
        disabled={state().italic.disabled}
        onPress={run((editor) => editor.commands.toggleItalic())}
      >
        <IconItalic size={20} />
      </ToolbarButton>
      <ToolbarButton
        label={labels.underline}
        tooltip={labels.underline}
        active={state().underline.active}
        disabled={state().underline.disabled}
        onPress={run((editor) => editor.commands.toggleUnderline())}
      >
        <IconUnderline size={20} />
      </ToolbarButton>
      <ToolbarButton
        label={labels.link}
        tooltip={labels.link}
        active={state().link.active}
        disabled={state().link.disabled}
        onPress={run(
          (editor) => {
            if (props.onOpenLinkForm) {
              props.onOpenLinkForm();
            } else if (props.onRequestLink) {
              props.onRequestLink(buildLinkRequestContext(editor));
            }
          },
          { restoreFocus: false },
        )}
      >
        <IconLink size={20} />
      </ToolbarButton>
      <ToolbarButton
        label={labels.divider}
        tooltip={labels.divider}
        active={state().divider.active}
        disabled={state().divider.disabled}
        onPress={run((editor) => editor.commands.insertDivider())}
      >
        <IconDividingLine size={20} />
      </ToolbarButton>
      <ToolbarButton
        label={labels.outdent}
        tooltip={labels.outdent}
        active={state().outdent.active}
        disabled={state().outdent.disabled}
        onPress={run((editor) => editor.commands.outdent())}
      >
        <IconLeftIndent size={20} />
      </ToolbarButton>
      <ToolbarButton
        label={labels.indent}
        tooltip={labels.indent}
        active={state().indent.active}
        disabled={state().indent.disabled}
        onPress={run((editor) => editor.commands.indent())}
      >
        <IconRightIndent size={20} />
      </ToolbarButton>
      <ToolbarButton
        label={labels.bulletList}
        tooltip={labels.bulletList}
        active={state().bulletList.active}
        disabled={state().bulletList.disabled}
        onPress={run((editor) => editor.commands.toggleList("bullet"))}
      >
        <IconBulletedList size={20} />
      </ToolbarButton>
      <ToolbarButton
        label={labels.orderedList}
        tooltip={labels.orderedList}
        active={state().orderedList.active}
        disabled={state().orderedList.disabled}
        onPress={run((editor) => editor.commands.toggleList("ordered"))}
      >
        <IconNumberedList size={20} />
      </ToolbarButton>
      <ToolbarButton
        label={labels.blockquote}
        tooltip={labels.blockquote}
        active={state().blockquote.active}
        disabled={state().blockquote.disabled}
        onPress={run((editor) => editor.commands.toggleBlockquote())}
      >
        <IconBlockquote size={20} />
      </ToolbarButton>
      <span class="tg-toolbar-spacer" aria-hidden="true" />
      <ToolbarButton
        label="Close"
        disabled={props.onRequestClose === undefined}
        onPress={() => props.onRequestClose?.()}
      >
        <IconClose size={20} />
      </ToolbarButton>
    </div>
  );
}
