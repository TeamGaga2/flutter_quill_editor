import type { RichTextEditor } from "@teamgaga/richtext-core";

/** Increase list/blockquote indent via Core `commands.indent()`. */
export function callIndent(editor: RichTextEditor): void {
  editor.commands.indent();
}

/** Decrease list/blockquote indent via Core `commands.outdent()`. */
export function callOutdent(editor: RichTextEditor): void {
  editor.commands.outdent();
}
