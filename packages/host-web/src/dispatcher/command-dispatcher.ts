import type { RichTextEditor } from "@teamgaga/richtext-core";
import {
  PROTOCOL_VERSION,
  type EditorCommandMessage,
  type EditorResponseMessage,
} from "@teamgaga/richtext-protocol";

export interface HostUIController {
  openLinkForm?: () => void;
}

export function dispatchEditorCommand(
  editor: RichTextEditor,
  command: EditorCommandMessage,
  uiController?: HostUIController,
): EditorResponseMessage {
  try {
    switch (command.type) {
      case "set_snapshot":
        editor.setSnapshot(command.payload.snapshot);
        return success(command);

      case "get_snapshot":
        return {
          version: PROTOCOL_VERSION,
          kind: "response",
          id: command.id,
          type: command.type,
          ok: true,
          value: { snapshot: editor.getSnapshot() },
        };

      case "set_selection":
        editor.setSelection(command.payload.selection);
        return success(command);

      case "get_selection":
        return {
          version: PROTOCOL_VERSION,
          kind: "response",
          id: command.id,
          type: command.type,
          ok: true,
          value: { selection: editor.getSelection() },
        };

      case "toggle_inline_format":
        dispatchInlineFormat(editor, command.payload.format);
        return success(command);

      case "toggle_block_format":
        dispatchBlockFormat(editor, command.payload);
        return success(command);

      case "insert_emoji":
        editor.commands.insertEmoji(command.payload.id);
        return success(command);

      case "insert_mention":
        editor.commands.insertMention(
          {
            id: command.payload.id,
            sign: command.payload.sign,
            displayText: command.payload.displayText,
          },
          command.payload.selection,
        );
        return success(command);

      case "insert_channel":
        editor.commands.insertChannel(
          {
            id: command.payload.id,
            displayText: command.payload.displayText,
          },
          command.payload.selection,
        );
        return success(command);

      case "insert_image":
        editor.commands.insertImage(
          {
            src: command.payload.src,
            width: command.payload.width,
            height: command.payload.height,
            mimeType: command.payload.mimeType,
            fileSize: command.payload.fileSize,
          },
          command.payload.selection,
        );
        return success(command);

      case "insert_video":
        editor.commands.insertVideo(
          {
            src: command.payload.src,
            width: command.payload.width,
            height: command.payload.height,
            mimeType: command.payload.mimeType,
            fileSize: command.payload.fileSize,
            ...(command.payload.poster === undefined ? {} : { poster: command.payload.poster }),
            ...(command.payload.duration === undefined
              ? {}
              : { duration: command.payload.duration }),
          },
          command.payload.selection,
        );
        return success(command);

      case "insert_link":
        editor.commands.insertLink(
          {
            url: command.payload.url,
            text: command.payload.text,
          },
          command.payload.selection,
        );
        return success(command);

      case "insert_divider":
        editor.commands.insertDivider(command.payload.selection);
        return success(command);

      case "indent":
        editor.commands.indent();
        return success(command);

      case "outdent":
        editor.commands.outdent();
        return success(command);

      case "get_caret_rect":
        return {
          version: PROTOCOL_VERSION,
          kind: "response",
          id: command.id,
          type: command.type,
          ok: true,
          value: { rect: editor.getCaretRect() },
        };

      case "undo":
        editor.history.undo();
        return success(command);

      case "redo":
        editor.history.redo();
        return success(command);

      case "focus":
        editor.focus();
        return success(command);

      case "blur":
        editor.blur();
        return success(command);

      case "open_link_form":
        uiController?.openLinkForm?.();
        return success(command);

      default:
        command satisfies never;
        throw new Error("Unsupported editor command.");
    }
  } catch {
    // Intentionally omit the underlying error: protocol failures must not leak
    // internal exception text to the host (see dispatcher security test).
    return {
      version: PROTOCOL_VERSION,
      kind: "response",
      id: command.id,
      ok: false,
      error: {
        code: "command_failed",
        message: "Editor command failed.",
      },
    };
  }
}

function dispatchInlineFormat(
  editor: RichTextEditor,
  format: "bold" | "italic" | "underline" | "strike",
): void {
  switch (format) {
    case "bold":
      editor.commands.toggleBold();
      return;
    case "italic":
      editor.commands.toggleItalic();
      return;
    case "underline":
      editor.commands.toggleUnderline();
      return;
    case "strike":
      editor.commands.toggleStrike();
  }
}

function dispatchBlockFormat(
  editor: RichTextEditor,
  payload:
    | { format: "header"; value: 1 | 2 | 3 }
    | { format: "list"; value: "ordered" | "bullet" }
    | { format: "blockquote" },
): void {
  switch (payload.format) {
    case "header":
      editor.commands.toggleHeader(payload.value);
      return;
    case "list":
      editor.commands.toggleList(payload.value);
      return;
    case "blockquote":
      editor.commands.toggleBlockquote();
  }
}

type EmptySuccessCommand = Exclude<
  EditorCommandMessage,
  { type: "get_snapshot" | "get_selection" | "get_caret_rect" }
>;

function success(command: EmptySuccessCommand): EditorResponseMessage {
  return {
    version: PROTOCOL_VERSION,
    kind: "response",
    id: command.id,
    type: command.type,
    ok: true,
    value: {},
  };
}
