# Flutter ↔ WebView richtext bridge contract

- Status: Phase 0/1 foundation (Web ready; Flutter client implements separately)
- Channel name: **`TgRichTextBridge`**
- Runtime app: `apps/webview-runtime`
- Protocol: `@teamgaga/richtext-protocol` v1 (`PROTOCOL_VERSION = 1`)

## HOST-PRE-02 decision

| Item             | Decision                                                                                |
| ---------------- | --------------------------------------------------------------------------------------- |
| P0 mobile plugin | **`webview_flutter`** + `JavascriptChannel`                                             |
| Channel          | `TgRichTextBridge`                                                                      |
| Desktop          | May use `flutter_inappwebview` later; **same** inject globals and `HostTransport` shape |
| Adapter location | Inject factory on the JS side; do not probe multiple Flutter globals inside Host        |

## Load order

```text
1. Register JavascriptChannel(name: 'TgRichTextBridge')
2. Inject CONFIG  → window.__TG_RICHTEXT_CONFIG__
3. Inject TRANSPORT factory → window.__TG_RICHTEXT_CREATE_TRANSPORT__
4. Navigate / load apps/webview-runtime/dist/index.html
   (built with base: './' for asset / file URLs)
5. Runtime calls createRuntimeTransport() → factory() → createRichTextHost
6. Host emits one Protocol ready event over transport.send
```

Canonical inject source: [`apps/webview-runtime/scripts/flutter-inject-template.js`](../../apps/webview-runtime/scripts/flutter-inject-template.js)

## Window contracts

### `window.__TG_RICHTEXT_CONFIG__` (optional)

```ts
{
  toolbarMode?: "none" | "desktop"; // default "none" (mobile editor-only)
  theme?: string;                   // stub
  locale?: string;                  // stub
}
```

Priority: injected config > URL query (**dev only**) > `{ toolbarMode: "none" }`.

### `window.__TG_RICHTEXT_CREATE_TRANSPORT__` (required in production)

```ts
type HostTransport = {
  send(message: string): void | Promise<void>;
  subscribe(listener: (message: unknown) => void): () => void;
  destroy(): void;
};

type ProductionTransportFactory = () => HostTransport;
```

Missing factory in production → runtime throws before host mount.

### `window.__TG_RICHTEXT_DELIVER__(message)` (set by inject template)

Flutter → Web inbound path: `controller.runJavaScript` invoking this helper with a **raw Protocol JSON string**.

Assigned when the production transport factory runs. The inject template also sets the alias `__TG_RICHTEXT_DELIVER_FROM_FLUTTER__` for older client drafts — prefer the canonical name in new code.

## Message directions

| Direction     | Mechanism                                         | Payload                  |
| ------------- | ------------------------------------------------- | ------------------------ |
| Web → Flutter | `TgRichTextBridge.postMessage(json)`              | Raw Protocol JSON string |
| Flutter → Web | `runJavaScript` → `__TG_RICHTEXT_DELIVER__(json)` | Raw Protocol JSON string |

Host encodes/decodes Protocol; transport only carries strings/`unknown`.

## Optional host helper

`@teamgaga/richtext-host-web` exports `createCallbackTransport({ send })` with `.deliver()` for the same shape — useful in tests or pure-JS harnesses. Production Flutter inject uses the **standalone** template (no ESM import before boot).

## Build fingerprint

After `vp run webview-runtime#build` (or package build):

- `dist/runtime-version.json` — `{ protocolVersion, buildId, builtAt, package }`
- Override build id with env `TG_BUILD_ID` when needed

## Asset loading

- Vite `base: './'` so JS/CSS are relative.
- Flutter should load `index.html` from bundled assets (or a local/file URL) without rewriting absolute `/assets/*` paths.
- Default mobile UI: editor only; set `toolbarMode: "desktop"` only for PC shells that want Solid toolbar chrome.

## Out of scope (this doc)

- Dart Protocol models (`PROTOCOL-16`)
- Native mobile toolbar UI
- Mention/image protocol commands
- Dual desktop entry HTML (optional later; runtime currently uses single entry + dynamic toolbar chunk)
