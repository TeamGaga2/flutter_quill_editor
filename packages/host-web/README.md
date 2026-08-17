# @teamgaga/richtext-host-web

WebView host that mounts the Solid editor, bridges Flutter Protocol messages to Core, and owns the host lifecycle.

## Responsibilities

- Mount and dispose a Solid editor shell (no toolbar).
- Accept Protocol commands over a `HostTransport`.
- Queue commands safely until the editor is ready (bounded FIFO).
- Map Core events to Protocol events (except Core `ready`).
- Send exactly one Protocol `ready` event from the host lifecycle.
- Tear down transport, listeners, and DOM idempotently.

## Public API

```ts
import {
  createRichTextHost,
  createWindowMessageTransport,
  type CreateRichTextHostOptions,
  type HostTransport,
  type RichTextHost,
  type RichTextHostError,
} from "@teamgaga/richtext-host-web";

const transport = createWindowMessageTransport({
  listenWindow: window,
  targetWindow: parent,
  targetOrigin: "https://app.example.com",
  allowedOrigin: "https://app.example.com",
});

const host = createRichTextHost({
  root: document.getElementById("editor")!,
  transport,
  onError: (error) => {
    console.error(error.phase, error.code, error.message);
  },
});

await host.ready;
// ...
host.destroy();
```

### Options

| Option               | Description                                                                               |
| -------------------- | ----------------------------------------------------------------------------------------- |
| `root`               | DOM element that owns the Solid mount                                                     |
| `transport`          | Message transport (`HostTransport`)                                                       |
| `maxPendingCommands` | Ready-queue capacity (default `64`)                                                       |
| `onError`            | Sanitized host error callback                                                             |
| `renderChrome`       | Optional factory for chrome inside `RichTextProvider` (e.g. desktop toolbar from runtime) |
| `headerElement`      | Optional DOM header between chrome and editor (toolbar → title → body)                    |

### Lifecycle

```text
mounting → draining → ready → destroyed
    └──────────────→ failed
```

- Commands received before `ready` enter a FIFO queue.
- When the queue is full, the host replies with `editor_not_ready`.
- Protocol `ready` is emitted once by the host after the event bridge is bound.
- Core `ready` is never forwarded.
- `destroy()` is idempotent and best-effort cleans transport, listeners, Solid root, and the active-root registry.

## Transports

- **Window message transport** — origin/source filtered, for iframe/desktop development.
- **Callback transport** (`createCallbackTransport`) — plugin-agnostic `send` + `deliver()`; tests and pure-JS bridges. Production Flutter inject inlines the same shape (see `apps/webview-runtime/scripts/flutter-inject-template.js`).
- **Memory transport** — test-only, not part of the public API.
- **Flutter channel** — inject `window.__TG_RICHTEXT_CREATE_TRANSPORT__` before boot (`webview_flutter` + `TgRichTextBridge`); see `docs/plans/richtext-flutter-bridge.md`.

## Dependency boundary

Host depends on Protocol, Core, and Solid public APIs only. It must not import Quill or `@teamgaga/richtext-solid-toolbar`.

## Runtime shell

Production WebView HTML is assembled by `apps/webview-runtime`. That app:

- mounts `createRichTextHost` into a full-height root
- uses Window transport in development
- fails fast in production when a Flutter transport factory is not injected

See `docs/plans/richtext-host-web-lifecycle.md` for the full lifecycle contract.
