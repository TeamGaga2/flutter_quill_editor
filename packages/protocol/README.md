# @teamgaga/richtext-protocol

Versioned, runtime-validated JSON contract between TeamGaga Flutter UI and the WebView rich-text runtime.

Protocol defines how the two sides communicate. It does not send messages or execute editor operations. `@teamgaga/richtext-host-web` is responsible for mapping validated wire commands explicitly to `@teamgaga/richtext-core`.

## Boundaries

- Production dependency: `@teamgaga/richtext-delta` only.
- No Solid, Solid Toolbar, Quill, DOM, Flutter plugin, or Host dependency.
- Wire messages use stable `snake_case` names.
- Protocol v1 recursively rejects unknown or missing fields.
- Snapshot validation delegates to the canonical Delta validator.
- Core domain types and Protocol wire types intentionally remain separate.

## Messages

Every message includes `version: 1` and a discriminating `kind`.

Commands additionally include a non-empty request `id`, `type`, and object `payload`. Responses reuse the request `id`. Events contain `type` and object `payload`.

Supported commands:

- `set_snapshot` / `get_snapshot`
- `set_selection` / `get_selection`
- `toggle_inline_format`
- `toggle_block_format`
- `insert_emoji`
- `insert_mention` / `insert_channel`
- `insert_image` / `insert_video`
- `insert_link` / `insert_divider`
- `indent` / `outdent`
- `get_caret_rect`
- `undo` / `redo`
- `focus` / `blur`

Mention, channel, and media insertion commands may include an optional `selection` range. The
range is replaced atomically; mention insertion appends one plain space, while the other embeds
do not append text. Media `src` and video `poster` values are canonical HTTPS URLs or
`tgg-local-media://token` values. The WebView resolves local tokens only for DOM rendering and
keeps the canonical URI in snapshots.

`indent` / `outdent` adjust block indent levels (Delta `indent` 1–5, typically with list or
blockquote). `get_caret_rect` returns `{ rect: { x, y, width, height } | null }` in CSS pixels
relative to the WebView viewport (null when no caret/selection is available).

Supported events:

- `ready`
- `change`
- `selection_change`
- `focus` / `blur`
- `state_change`
- `request_link`

The v1 `state_change` payload includes `focused`, `selection`, `formats`, `canUndo`, and `canRedo`, so native and Web toolbars can derive history-button availability from the same state contract.

`request_link` is a Web→Flutter UI intent (e.g. desktop Solid toolbar) asking the host to open
its link dialog. Payload may include optional `selection` for the range to wrap.

Additive command/event types stay on `PROTOCOL_VERSION = 1`. Flutter golden fixtures should be
updated when wire fixtures change.

`focus` and `blur` are frozen in the wire contract and have corresponding Core/Quill APIs for Host dispatch.

## Usage

```ts
import {
  decodeProtocolMessage,
  encodeProtocolMessage,
  parseProtocolCommand,
  PROTOCOL_VERSION,
  type EditorCommandMessage,
} from "@teamgaga/richtext-protocol";

const command: EditorCommandMessage = {
  version: PROTOCOL_VERSION,
  kind: "command",
  id: "request-42",
  type: "toggle_inline_format",
  payload: { format: "bold" },
};

const encoded = encodeProtocolMessage(command);
const decoded = decodeProtocolMessage(encoded);
const parsed = parseProtocolCommand(JSON.parse(encoded) as unknown);
```

All boundary input must be treated as `unknown` until parsing succeeds. Parse failures contain a stable error code and JSONPath-like issue paths.

## Shared fixtures

`fixtures/v1.json` contains legal command, event, success-response, and failure-response messages. It is exported as:

```text
@teamgaga/richtext-protocol/fixtures/v1.json
```

The Flutter implementation should decode the same file in Dart golden tests and compare its own encoded output against these fixtures.
