# TeamGaga Rich Text

Cross-platform rich-text editor packages for Flutter mobile, desktop, and Web.

## Architecture

```text
Flutter native toolbar
  -> richtext-protocol (versioned wire contract)
  -> richtext-host-web
  -> richtext-core (domain commands and state)
  -> richtext-quill
  -> richtext-delta

Optional desktop/Web toolbar
  -> richtext-solid-toolbar
  -> richtext-solid
  -> richtext-core -> richtext-quill -> richtext-delta
```

Package responsibilities:

- `@teamgaga/richtext-delta`: canonical document data and validation.
- `@teamgaga/richtext-core`: platform-independent editor commands, state, and events.
- `@teamgaga/richtext-quill`: Quill adapter.
- `@teamgaga/richtext-solid`: Solid editor runtime, context, lifecycle, and hooks; no toolbar UI.
- `@teamgaga/richtext-solid-toolbar`: optional desktop/PC Web toolbar UI.
- `@teamgaga/richtext-protocol`: versioned Flutter/WebView wire contract.
- `@teamgaga/richtext-host-web` (planned package name): WebView lifecycle and Protocol-to-Core mapping.

The shared cross-platform surface is command semantics, state, protocol, and document data—not buttons, popovers, pickers, or layout.

## Development

```bash
vp install
vp check
vp test
vp run -r build
```

Run the desktop toolbar playground with:

```bash
vp run dev
```
