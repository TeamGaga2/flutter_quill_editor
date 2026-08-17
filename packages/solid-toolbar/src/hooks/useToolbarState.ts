import { createMemo, type Accessor } from "solid-js";
import {
  useEditorState,
  useRichText,
  type SolidRichTextController,
} from "@teamgaga/richtext-solid";

export interface ToolbarItemState {
  active: boolean;
  disabled: boolean;
}

export interface ToolbarState {
  bold: ToolbarItemState;
  italic: ToolbarItemState;
  underline: ToolbarItemState;
  strike: ToolbarItemState;
  header1: ToolbarItemState;
  header2: ToolbarItemState;
  header3: ToolbarItemState;
  orderedList: ToolbarItemState;
  bulletList: ToolbarItemState;
  blockquote: ToolbarItemState;
  link: ToolbarItemState;
  divider: ToolbarItemState;
  indent: ToolbarItemState;
  outdent: ToolbarItemState;
  undo: ToolbarItemState;
  redo: ToolbarItemState;
}

export interface UseToolbarStateOptions {
  /**
   * When false, the Link button stays disabled (no host dialog handler).
   * Defaults to true for standalone state checks; `RichTextToolbar` passes
   * `false` until `onRequestLink` is provided.
   */
  canRequestLink?: boolean;
  /** Disable body-dependent formatting while the host title input is focused. */
  titleFocused?: boolean | Accessor<boolean>;
}

export function useToolbarState(
  controller?: SolidRichTextController,
  options: UseToolbarStateOptions = {},
): Accessor<ToolbarState> {
  const resolvedController = controller ?? useRichText();
  const editorState = useEditorState(resolvedController);

  return createMemo(() => {
    const editorUnavailable = resolvedController.editor() === undefined;
    const state = editorState();
    const formats = state.formats;
    const titleFocused =
      typeof options.titleFocused === "function"
        ? options.titleFocused()
        : options.titleFocused === true;
    const bodyDisabled = editorUnavailable || titleFocused;
    const item = (active: boolean): ToolbarItemState => ({ active, disabled: bodyDisabled });
    // Prefer reactive read of options each memo tick (toolbar may wire handler later).
    const canRequestLink = options.canRequestLink !== false;

    return {
      bold: item(formats.bold),
      italic: item(formats.italic),
      underline: item(formats.underline),
      strike: item(formats.strike),
      header1: item(formats.header === 1),
      header2: item(formats.header === 2),
      header3: item(formats.header === 3),
      orderedList: item(formats.list === "ordered"),
      bulletList: item(formats.list === "bullet"),
      blockquote: item(formats.blockquote),
      // Link active state needs Core formats.link (not exposed yet).
      link: {
        active: false,
        disabled: bodyDisabled || !canRequestLink,
      },
      divider: item(false),
      // Indent/outdent have no active format in Core state yet.
      indent: {
        active: false,
        disabled: bodyDisabled || (formats.list === false && !formats.blockquote),
      },
      outdent: {
        active: false,
        disabled: bodyDisabled || (formats.list === false && !formats.blockquote),
      },
      undo: { active: false, disabled: editorUnavailable || !state.canUndo },
      redo: { active: false, disabled: editorUnavailable || !state.canRedo },
    };
  });
}
