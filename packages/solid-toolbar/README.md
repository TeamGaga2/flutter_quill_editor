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
    visibleInsertActions={["emoji", "mention", "channel", "image"]}
    onRequestEmoji={(selection) => {
      /* open host emoji picker, then insert_emoji */
    }}
    onRequestMention={(selection) => {
      /* open host mention list, then insert_mention */
    }}
    onRequestChannel={(selection) => {
      /* open host channel list, then insert_channel */
    }}
    onRequestImage={(selection) => {
      /* open host media picker, then insert_image / insert_video */
    }}
    onOpenLinkForm={() => {
      /* open in-web link popover */
    }}
  />
  <RichTextEditor />
</RichTextProvider>;
```

### Desktop insert actions (Host-owned)

Insert action controls (Emoji, Mention, Channel, Image) are optional and disabled by default. When enabled via `visibleInsertActions`, they are rendered in a fixed order at the start of the toolbar, followed by a separator (`.tg-toolbar-separator`). Clicking an insert action invokes the corresponding host callback with the current editor selection (`{ start: number, end: number } | null`) without modifying the document Delta or shifting focus back.

| Action    | Callback           | Protocol Event    | Description                       |
| --------- | ------------------ | ----------------- | --------------------------------- |
| `emoji`   | `onRequestEmoji`   | `request_emoji`   | Request host to open emoji picker |
| `mention` | `onRequestMention` | `request_mention` | Request host to open member list  |
| `channel` | `onRequestChannel` | `request_channel` | Request host to open channel list |
| `image`   | `onRequestImage`   | `request_image`   | Request host to open media picker |

### Desktop format controls

| Control          | Behavior                                           |
| ---------------- | -------------------------------------------------- |
| Divider          | Core `insertDivider`                               |
| Indent / Outdent | Core `indent()` / `outdent()`                      |
| Link             | Calls `onOpenLinkForm` or optional `onRequestLink` |
