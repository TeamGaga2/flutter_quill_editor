# Changelog

## 0.1.5

### Fixes

- fix(flutter): suppress WebView tap highlights (2e8e06c)

## 0.1.4

### Fixes

- fix(web): resolve web runtime assets against document baseURI instead of route URI (#25) (8628365)

### Other changes

- chore(ci): remove temporary v0.1.3 recovery workflow (14f93bc)
- chore(ci): temporarily republish flutter_quill_editor 0.1.3 (53827c7)

## 0.1.3

### Fixes

- fix(flutter): restore Android WebView IME focus (#17) (e52038a)

### Other changes

- docs: document build and release workflows (#16) (0173917)

## 0.1.2

### Fixes

- fix(ci): preserve release evidence source variable (#14) (95f9846)
- fix(ci): tolerate expected publish warnings (#13) (a7b7863)
- fix(ci): use downloaded release plan filename (#12) (86ef210)
- fix(ci): build workspace packages before validation (#11) (f26153c)
- fix(ci): checkout before release trigger validation (#10) (6e75eba)

### Other changes

- ci(release): automate Flutter package publishing (#9) (7c4591a)

## 0.1.1

- Refresh the vendored WebView runtime to hide Windows scrollbar stepper
  buttons and pin the verified immutable runtime artifact.

## 0.1.0

- Initial release: protocol, transport, `RichTextEditorController`,
  `RichTextWebView` widget, `webview_flutter` and iframe hosts, draft/media
  utilities, vendored webview-runtime assets, and a runnable example.
