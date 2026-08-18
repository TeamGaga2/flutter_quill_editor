# flutter_quill_editor example

Minimal editor harness for local iteration: embeds `RichTextWebView` with the
package defaults (no emoji definitions, mobile-style config) plus a small
toolbar driving `RichTextEditorController`.

```sh
flutter pub get
flutter run
```

Runs on Android / iOS / macOS via the bundled `webview_flutter` host and on
Flutter Web via the iframe host.
