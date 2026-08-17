# @teamgaga/richtext-solid

SolidJS bindings and Web editor runtime for TeamGaga rich text.

## Responsibilities

- Create and mount the Core/Quill editor.
- Provide Solid context and lifecycle management.
- Expose editor state hooks for optional UI layers and host runtimes.
- Ship editor-area styles.

This package intentionally does **not** include a toolbar, picker, menu, popover, upload flow, or other product UI. Desktop and PC Web applications can install `@teamgaga/richtext-solid-toolbar`; Flutter mobile applications should provide native UI and send versioned commands through the WebView protocol.

```tsx
import { RichTextEditor, RichTextProvider, createRichTextEditor } from "@teamgaga/richtext-solid";

const editor = createRichTextEditor();

<RichTextProvider editor={editor}>
  <RichTextEditor />
</RichTextProvider>;
```
