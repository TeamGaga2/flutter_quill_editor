# REFERENCE: Rich-Text Editor "Insert Link" Floating Layer (插入链接)

Full 1:1 implementation reference for the TeamGaga rich-text editor insert-link overlay.

## 0. Editor type (Q7 answered first)

The editor is NOT vanilla flutter_quill, and NOT the flutter_quill_editor pub package as a normal dependency. It is the TeamGaga **flutter_quill_editor fork** (a monorepo), consumed via a path: dependency that points OUTSIDE the teamgaga-client monorepo, and the actual editing surface is a **web WebView runtime (HTML/JS, Quill.js)** driven over a wire protocol. The Flutter side is a thin controller/protocol client.

- root pubspec.yaml dependency_overrides: flutter_quill_editor: path: ../flutter_quill_editor/clients/flutter_quill_editor -> /Volumes/TeamGagaHD/projects/flutter_quill_editor/clients/flutter_quill_editor
- app/pubspec.yaml: flutter_quill_editor: ^0.1.0
- fork layout: clients/flutter_quill_editor (Flutter SDK), packages/{protocol,quill,host-web,solid-toolbar,...} (TS runtime source), apps/webview-runtime (dist), committed runtime assets under clients/flutter_quill_editor/assets/richtext_webview_runtime/ ("vendored runtime" per CONTEXT.md).

Consequence: the link dialog is a pure-Flutter overlay; caret/selection/document state lives in the WebView and is obtained via protocol (get_snapshot, get_selection, get_caret_rect), and applied via insert_link command (no Flutter-side Quill delta).

## 1. Files implementing the layer + toolbar button

(paths relative to /Volumes/TeamGagaHD/projects/teamgaga-client)

Core dialog widgets:

- app/lib/pages/richtext/components/link_dialog/link_dialog.dart — RichTextLink model, abstract LinkDialog factory, AddLink, LinkOkButton, LinkSubmitGate
- app/lib/pages/richtext/components/link_dialog/landscape_link_dialog.dart — desktop/web floating layer (global Menu())
- app/lib/pages/richtext/components/link_dialog/portrait_link_dialog.dart — mobile centered modal (showDialogRoute)

Orchestration / entry:

- app/lib/pages/richtext/utils/web_editor_host_link.dart — openWebEditorHostLinkDialog(...): single entry, per-editor lock, snapshot/selection/caret capture, pointer-gate acquire, blur, show dialog, insertLink, focus restore
- app/lib/pages/richtext/utils/web_text_link.dart — prepareWebTextLink(snapshot, selection): prefill text/link/selection incl. edit-existing-link expansion
- app/lib/pages/richtext/components/web_rich_text_toolbar.dart — _handleWebLink() (line 1121) + "more" grid item (1539-1543)
- app/lib/pages/richtext/rich_text_input_page.dart — page host: onRequestLink (417), _webLinkDialogOpen guard (78), _openWebHostLink (466), Cmd/Ctrl+K CallbackShortcuts (688-696)
- app/lib/pages/circle/circle_publish_rich_text_page.dart — second host (circle post), same guard + call (77, 319-330)

Toolbar link button (inside "more" tab -> MoreTabGridView), web_rich_text_toolbar.dart:1539-1543:
MoreTabDataItem(label: tr.links, icon: AppIcons.linkLinear, onTap: () => unawaited(_handleWebLink()))
_handleWebLink() (1121-1129) -> openWebEditorHostLinkDialog(context, editor, preferredSelection: _lastWebSelection, webViewKey, focusNode).

Additional entries: Solid desktop toolbar emits request_link -> onRequestLink -> _openWebHostLink; Cmd/Ctrl+K (688-696) only when focus NOT inside WebView.

## 2. Exact visual specs

### Landscape/desktop (LandscapeLinkDialog)

Container (35-41): padding all 24; color tokens.colors.fill04; radius 16; boxShadow tokens.effects.primary. menuWidth 360, menuMaxHeight 230. NO title bar. Scrim = full-screen Listener(HitTestBehavior.opaque), transparent (no dim), no MouseRegion cursor on barrier (menu.dart:237-244,234-236). Layout: link field (autofocus, hint enterLink), y16, text field (hint enterText1), y24, Row(end) [SizedBox(w92 cancel), x16, SizedBox(w92 ok)].

### Portrait/mobile (PortraitLinkDialog)

showDialogRoute showDialogClose:false; GeneralDialogTitle(title: tr.addLink, padding bottom 12); PowerForm + AddLink + LinkSubmitGate; y12 gap; Row([Expanded(cancel), x16, Expanded(ok)]).

### InputField (default InputFieldStyle.fill)

Web (input_field_web.dart): radius 8, normal border border01, focus primary03, error redSecondary, fill base fill03 / focus fill04, hover fill04, hint bodySmall(14/w400) text04, text 14/w400 text01, contentPadding h:16, keepErrorHeight:false, textInputAction done.
Mobile (input_field_mobile.dart): radius 8, normal border border01, fill base fill01, hint text04, text bodyXlarge(16/w400) text01, contentPadding v:14 h:16.

### Buttons

LinkOkButton = raw FilledButton matching AppFilledButton.primary with custom disabled: bg schemesPrimary, fg schemesOnPrimary, disabledBg primary04, disabledFg text05, elevation 0, minSize Size(84,40), padding h16(desktop)/24(mobile), shape radius8 desktop / null mobile, text bodyMedium(14/w500).
Cancel = AppOutlinedButton.primary, borderColor schemesOutlineVariant (override of default schemesOutlineVariantSubtle), label schemesOnSurfaceVariant, border width 1 desktop/0.5 mobile, SizedBox(width:92) desktop.

### Token colors (light / dark)

schemesPrimary #009C64 / #91D5AC; schemesOnPrimary #FFFFFF / #003921; primary04 #88DCB6 / #4A8F70; text05 #FFFFFF / #FFFFFF; schemesOutlineVariant #A0A7A1 / #4E5550; fill04 #FFFFFF / #3A3A3A; fill03 #FAFAFA / #313131; fill01 #E9E9E9 / #272727; fill02 #F1F1F1 / #373737; border01 #E3E3E3 / #474747; primary03 #38C585 / #009C64; primary02 #00A66A / #009C64; text01 #121212 / #FAFAFA; text02 #313131 / #E3E3E3; text03 #5F5F5F / #ACACAC; text04 #ACACAC/#ACACAC; icon03 #5F5F5F / #919191; icon04 #ACACAC; redSecondary #BA1A1A.
Effects.primary (both themes): ARGB(52,0,0,0) offset(0,8) blur40 spread0.
Spacing x16=16 y12=12 y16=16 y24=24. Icon linkLinear = IconData(0xf217).

## 3. Theme tokens vs hardcoded

Tokens: all colors/shadows/typography/spacing from tgg_design ThemeExtension (AppColors, AppEffects, TggDesignTokensBundle) via context.tokens.* (extensions/index.dart:21-26); light/dark in packages/tgg_design/lib/src/design_token/tokens.g.dart (Figma-generated). Fonts system w/ fallback (Microsoft YaHei win, PingFang SC mac-ios).
Hardcoded: menuWidth 360, menuMaxHeight 230, radius 16, EdgeInsets.all(24), y16/y24, SizedBox(width:92); InputField radius 8 + paddings; ButtonSize geometry (button.dart); literal BoxShadow values in tokens file.

## 4. Strings + i18n

Mechanism: ARB -> FlutterGen (NOT gen_l10n) -> class AppLocalizations. ARBs layers/business_layer/lib/src/l10n/app_{zh,en,hi}.arb; generated app_localizations*.dart checked in. Config business_layer/pubspec.yaml flutter.generate:true, flutter_gen.output lib/src/l10n. Access via global late AppLocalizations tr (business_layer.dart:199), assigned main.dart:447, exported app/extension/preclude.dart.

Strings (key | zh | en | hi | usage):

- enterLink | 粘贴或输入链接地址 | Paste or enter a link address | ...दर्ज करें | link hint
- enterText1 | 输入文本 | Enter text | पाठ दर्ज करें | text hint
- addLink | 添加链接 | Add link | लिंक जोड़ें | portrait title
- cancel | 取消 | Cancel | रद्द करें | cancel
- ok | 确定 | OK | ठीक है | confirm
- links | 链接 | Links | लिंक | toolbar item
  No error strings (silent validation).

## 5. Behavior spec

Opening: openWebEditorHostLinkDialog -> re-entry lock (Set per editor, sync add before first await, finally release); editor.isReady guard; getSnapshot (fallback empty) + getSelection/preferredSelection; prepareWebTextLink; caret placement getCaretRect+resolveWebTriggerAnchorRect -> (Offset(anchorRect.left,anchorRect.bottom), anchorRect) fallback webView origin; DesktopPlatformViewPointerGate.acquire + editor.blur + focusNode.unfocus + 50ms + endOfFrame; LinkDialog.create() portrait vs landscape.
Landscape: Menu().show(position, anchorRect, verticalDirection auto(if anchorRect)/below, 360x230). Portrait: centered modal.
Focus/defaults: link autofocus; unFocusOnTapOutside:false (Web HtmlElementView); initialValues link/text. New link: text=selected, link=null. Edit existing: text=link inner text, link=attributes.link, selection=full span (web_text_link.dart:48-60). No selection: empty. (edit support exists; no remove-link flow.)
Validation: canSubmit = text.isNotEmpty && StringExtension.urlPattern.hasMatch(link). Pattern: (http|mp)s?://... (explicit scheme required, no auto-prepend https). Invalid -> button disabled. JS mirror: TgLinkBlot whitelist [http,https,mailto,tel,sms,mp,mps], sanitize URL.parse + data-tg-href; converters.ts drops invalid link attrs.
Confirm: RichTextLink(text,link); close (Menu().hide(false)/Navigator.pop(value)); host skips empty then editor.insertLink(url,text,selection).
Cancel: close -> null.
Outside-tap: LandscapeLinkDialog completes own Completer null (if !isCompleted) after Menu().show returns (98-105) to avoid caller hang + guard wedge.
insertLink (JS): Delta retain(start) delete(end-start) insert(text,{link:url}); caret nextIndex (SILENT); ensureSelectionVisible.
Focus restore (desktop/web): reapply + requestRichTextWebViewSurfaceFocus + wakeEditingSession + focus + showAndroidWebViewIme (Android), 50ms gaps.
Keyboard: Escape not bound (outside-tap/barrier); Enter NOT wired to submit (raw FilledButton, not AppFilledButton OnEnterKey); Cmd/Ctrl+K opens (gated by _webLinkDialogOpen).

## 6. Tests / docs

app/test/pages/richtext/: web_text_link_test.dart (prepareWebTextLink unit); web_editor_host_link_reentry_test.dart (per-editor lock widget tests w/ MemoryRichTextTransport); web_editor_host_link_contract_test.dart (SOURCE-level contract reads .dart text, asserts caret anchoring + pointer gate + lock ordering + focus restore + no Quill types + guard finally + completer safety + onRequestLink/CallbackShortcuts/keyK).
Docs: referenced docs/设计方案/WebView 宿主链接对话框并发重入修复方案.md (NOT on disk). CONTEXT.md glossary only. Fork has its own CONTEXT.md/AGENTS.md.

## 7. Dependency path & overrides

flutter_quill_editor path dependency -> fork's clients/flutter_quill_editor; backend-neutral (protocol/transport/controller/pointer gate/caret anchor/surface focus/draft/media). NO custom Quill toolbar overrides: WebRichTextToolbar fully custom (QuillToolBarButton wraps AppIconButton3/Icon); MoreTabGridView hosts link item; in-WebView Solid toolbar emits request_link.

(link_dialog.dart 171 lines, landscape 107, portrait 77 — small enough to reproduce verbatim from the reads.)
