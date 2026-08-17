# @teamgaga/richtext-solid-toolbar

Optional SolidJS toolbar UI for desktop and PC Web editors.

This package owns buttons and toolbar state projection. It calls the public command API from `@teamgaga/richtext-core` through a controller from `@teamgaga/richtext-solid`; it does not access Quill directly.

Mobile Flutter applications should implement toolbar, picker, upload, menu, and popover UI natively and communicate with the WebView runtime through `@teamgaga/richtext-protocol`.

```tsx
import { RichTextEditor, RichTextProvider, createRichTextEditor } from "@teamgaga/richtext-solid";
import { RichTextToolbar } from "@teamgaga/richtext-solid-toolbar";

const editor = createRichTextEditor();

<RichTextProvider editor={editor}>
  <RichTextToolbar
    // Host owns the link dialog — toolbar never opens a web form.
    // Apply the result with Core insertLink / Protocol insert_link.
    onRequestLink={({ selection, selectedText }) => {
      /* open native / shell link dialog, then insert_link */
    }}
  />
  <RichTextEditor />
</RichTextProvider>;
```

### Desktop format controls

| Control          | Behavior                                               |
| ---------------- | ------------------------------------------------------ |
| Divider          | Core `insertDivider`                                   |
| Indent / Outdent | Core `indent()` / `outdent()`                          |
| Link             | Calls optional `onRequestLink` only — no in-web dialog |
