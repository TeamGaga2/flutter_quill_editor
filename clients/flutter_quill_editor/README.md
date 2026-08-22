# flutter_quill_editor

Flutter client for the TeamGaga rich-text editor WebView runtime: the wire
protocol, transport, `RichTextEditorController` and a ready-to-embed
`RichTextWebView` widget. The editor itself is a TypeScript web runtime that
lives in this repository (`apps/webview-runtime`) and is **vendored** into the
package's assets — consumers get a version-locked, offline-usable editor with
no build step.

> Not a fork of [`flutter_quill`](https://pub.dev/packages/flutter_quill).
> This package ships its own WebView-based editor runtime; it only borrows the
> Quill Delta data model at the snapshot layer on the host side.

## Quickstart

```yaml
dependencies:
  flutter_quill_editor: ^0.1.0
```

```dart
import 'package:flutter_quill_editor/flutter_quill_editor.dart';

RichTextWebView(
  onControllerReady: (controller) {
    // Keep the controller; drive the editor imperatively:
    controller.toggleInlineFormat(ProtocolInlineFormat.bold);
    controller.setSnapshot(snapshot);
  },
  onReady: () => debugPrint('editor ready'),
  onFailure: (failure) => debugPrint('editor failed: ${failure.stage}'),
)
```

Run the bundled example for a working editor with a small toolbar:

```sh
cd clients/flutter_quill_editor/example
flutter run
```

## Platform support

| Platform | Backend | Notes |
| --- | --- | --- |
| Android / iOS / macOS | `webview_flutter` | Ships in the package, no extra setup. |
| Flutter Web | same-origin iframe host | Ships in the package; requires the vendor-ed asset origin. |
| Windows | host-provided | The package carries **no** InAppWebView/WebView2 code. Register a creator via `RichTextWebView.windowsHostCreator` (see the TeamGaga app for a reference `flutter_inappwebview` implementation). |

The runtime is served from a loopback HTTP server on native platforms and
materialized into an app-support cache directory.

## Host app injections

The package is deliberately free of host-app and business-layer dependencies.
Hosts inject everything app-specific:

- **Emoji** — `RichTextWebView.emojiDefinitions` (`id` + Flutter asset path of
  the PNG; the app declares the assets in its own pubspec).
- **Platform config** — `RichTextWebView.isDesktopRichTextSurface` selects the
  in-web desktop chrome (`toolbarMode: desktop`, larger media box).
- **Windows backend** — `RichTextWebView.windowsHostCreator`.

## Runtime assets

`assets/richtext_webview_runtime/` is the committed runtime selected by
`richtext-runtime.lock.json`. The lock points to one exact promoted Release and
the package can verify the vendor, lock, and generated manifest offline:

```sh
cd clients/flutter_quill_editor
dart run tool/richtext_runtime_prepare.dart --verify
```

For Flutter/runtime local integration use `--local <distPath>`; it never reads
or writes the formal lock and prints an explicit non-publish warning. A
controlled artifact directory may be used with `--from-artifact ...
--allow-unpublished` only for local migration/tests; it also never writes a
formal lock and cannot run in CI. Formal updates use only
`--update --release-tag <exactTag>`.

## Local Flutter integration

For the complete local integration flow with the TeamGaga Flutter client,
including building the TypeScript runtime, switching the client to a local
path dependency, checking the native runtime cache, and testing iOS focus
scrolling, see the
[Flutter client local integration runbook](../../docs/runbooks/flutter-local-integration.md).

## License

MIT — see the repository [LICENSE](../../LICENSE).
