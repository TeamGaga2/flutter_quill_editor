# 桌面 Solid 工具栏插入操作实施计划

## 文档状态

- 日期：2026-08-20
- 状态：grilling 决策已确认（见 `docs/adr/0005-host-owned-insert-actions.md`），本计划固化实施细节；尚未修改功能代码
- 涉及仓库：
  - 第一刀：仅 `flutter_quill_editor`（Solid 工具栏、协议、host-web、webview-runtime、Dart 客户端）
  - 后续：`teamgaga-client`（Circle 桌面接线 + 抽出插入操作宿主）
- 术语：`flutter_quill_editor/CONTEXT.md`（插入操作、工具栏分隔线、提及、频道引用、正文媒体）

## 背景与目标

Circle 横屏只挂 in-Web Solid 工具栏，不挂 `WebRichTextToolbar`，因此桌面 Circle 没有表情 / 提及 / 频道引用 / 图片入口。IM 横屏已经把这四个放在 Flutter 底栏。协议已有 Flutter→Web 的 `insert_emoji` / `insert_mention` / `insert_channel` / `insert_image`（以及 `insert_video`），缺的是 Web→Flutter 的「请打开选择器」事件。

目标：在 Solid 桌面工具栏最前方补上这四个插入操作和一条工具栏分隔线；点击只通知宿主，选择器留在 Flutter。第一刀把运行时和 Dart 客户端打通并默认隐藏；后续由 Circle 横屏打开并接上现有选择器。

这与 ADR 0004 相反：链接是无业务依赖的表单，所以浮层进了运行时；插入操作依赖成员列表、频道列表、表情资源和系统文件选择器，所以必须留在宿主。

## 已确认决策

| 项               | 决定                                                                                                                                            |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| 第一刀范围       | 只动 `flutter_quill_editor`。`teamgaga-client` 不动。生产环境在后续 PR 之前四个按钮不可见。                                                     |
| 显隐             | `visibleInsertActions?: Array<"emoji" \| "mention" \| "channel" \| "image">`。未传或空 = 全隐藏。未知字符串忽略，重复只渲染一次。数组不管顺序。 |
| 展示顺序         | 永远：表情 → 提及 → 频道引用 → 图片 → 工具栏分隔线 → 现有 11 项排版控件 →（可选）关闭                                                           |
| 图片语义         | 打开宿主媒体选择器，往正文插图或视频（对齐现有 `imgBtn`）。不是封面。按钮 / action / 事件仍叫 `image`。                                         |
| 点击             | 四个事件 `request_emoji` / `request_mention` / `request_channel` / `request_image`，不调 Core，不 `restoreFocus`                                |
| payload          | `{ selection: ProtocolSelection \| null }`，字段必在。选区取 `editor.getState().selection`（失焦后仍是上次选区）                                |
| 协议版本         | 不升。运行时与客户端继续共发版，无兼容层                                                                                                        |
| 标题聚焦         | 与排版按钮一样禁用，不发事件                                                                                                                    |
| 有列表项、没回调 | 仍渲染，禁用（对齐 Link 没有 `onOpenLinkForm`）                                                                                                 |
| Playground       | 四个全开，回调 `console.log`，便于人工看                                                                                                        |
| 后续归属         | 从 `WebRichTextToolbar` 抽出共用插入操作宿主。Circle 桌面只挂宿主，不挂 Flutter 底栏                                                            |
| 后续 `@` / `#`   | 同一宿主订阅 `MentionTriggerManager`，补上 Circle 桌面打字缺口                                                                                  |
| 后续锚点         | 表情、提及、频道引用都走 caret 锚定（编辑器左缘 + caret Y）。不在协议里加 `button_rect`                                                         |
| 谁传入允许列表   | 仅 Circle 横屏传入四个全开。IM 永不传。Circle 竖屏不传                                                                                          |

## 非目标

- 不把选择器、Picker、Popover 做进 `solid-toolbar` 或 webview-runtime。
- 不把 `isCircle` / Circle 模块名写进编辑器包。
- 不改移动端 `toolbarMode: "none"`。Circle 竖屏、IM 竖屏继续用 Flutter `WebRichTextToolbar`。
- 不把 IM 桌面底栏四个按钮迁进 Solid 工具栏（会重复）。
- 不升 `PROTOCOL_VERSION`。
- 工具栏 i18n 不加印地语，仍是「zh / zh-* 中文，其余英文」。
- 第一刀不改 `teamgaga-client`，Circle 生产环境暂时看不到这四个按钮。

## 架构

```text
第一刀（本仓库）

  Solid RichTextToolbar
    visibleInsertActions 控制渲染
    点击 → onRequestEmoji(selection) 等
        → webview-runtime
        → host.requestEmoji(selection)
        → protocol event request_emoji
        → Dart RichTextEditorController.onRequestEmoji

  插入本身仍是已有命令：
    Flutter insertEmoji / insertMention / insertChannel / insertImage / insertVideo
        → protocol insert_*
        → Core

后续（teamgaga-client）

  Circle 横屏传入 visibleInsertActions
  监听 onRequest*
  WebRichTextInsertHost 打开选择器，再 insert_*
  同一宿主订阅 MentionTriggerManager（打字 @ / #）
```

插入操作不进入 `useToolbarState`：没有 active 格式。`disabled` 在 `RichTextToolbar` 内计算：`editor == null` 或标题聚焦或对应回调缺失。

## 文案、图标、顺序

| 顺序 | action       | 中文       | 英文       | 图标来源                          | 回调               | 事件              |
| ---- | ------------ | ---------- | ---------- | --------------------------------- | ------------------ | ----------------- |
| 1    | `emoji`      | 表情       | Emoji      | `IconEmoji.svg` → `IconEmoji`     | `onRequestEmoji`   | `request_emoji`   |
| 2    | `mention`    | 提及       | Mention    | `IconAT.svg` → `IconMention`      | `onRequestMention` | `request_mention` |
| 3    | `channel`    | 频道       | Channel    | `IconChannel.svg` → `IconChannel` | `onRequestChannel` | `request_channel` |
| 4    | `image`      | 图片       | Image      | `IconIMG.svg` → `IconImage`       | `onRequestImage`   | `request_image`   |
| 5    | 工具栏分隔线 | （无文案） | （无文案） | 不是 `IconDividingLine`           | 无                 | 无                |

图标：`packages/solid-toolbar/src/assets/raw-icons/` 里已有 SVG，但填色是 `#404942`。按现有 `ToolbarIcons.tsx` 纪律手写 `IconBase` + `currentColor`，`size={20}`。不要走 `vite-solid-svg`。组件名用 `IconMention` / `IconImage`，不要用 `IconAT` / `IconIMG`（那是资源文件名）。

`ToolbarLabels` 增补四键。Close 仍然硬编码英文，不动。

工具栏分隔线不是正文分割线按钮。class `tg-toolbar-separator`：`aria-hidden="true"`。至少有一个插入操作可见时才渲染。

## API 契约

### `RichTextToolbarProps`（`packages/solid-toolbar`）

```ts
export type InsertAction = "emoji" | "mention" | "channel" | "image";

export interface RichTextToolbarProps {
  // 现有字段保持不变
  visibleInsertActions?: readonly InsertAction[];
  onRequestEmoji?: (selection: ProtocolSelection | null) => void;
  onRequestMention?: (selection: ProtocolSelection | null) => void;
  onRequestChannel?: (selection: ProtocolSelection | null) => void;
  onRequestImage?: (selection: ProtocolSelection | null) => void;
}
```

`ProtocolSelection` 从 `@teamgaga/richtext-core` 或 `@teamgaga/richtext-protocol` 取与现有 toolbar 依赖一致的那一个。若 toolbar 目前不依赖 protocol，用 core 的 selection 形状 `{ start: number; end: number }`，runtime 映射到协议。不要为了四个回调让 toolbar 直接依赖 protocol。

内部渲染顺序硬编码为 `INSERT_ACTION_ORDER = ["emoji","mention","channel","image"]`。可见性：`new Set(visibleInsertActions ?? [])` 去掉未知值后，按该顺序 `Show`。

点击：

```ts
onPress={run(
  (editor) => props.onRequestEmoji?.(editor.getState().selection),
  { restoreFocus: false },
)}
```

`run` 在 `editor` 为空时直接 return，与现有格式按钮相同。

导出：`InsertAction`、更新后的 `RichTextToolbarProps`。

### `RuntimeConfig`（`apps/webview-runtime`）

```ts
visibleInsertActions?: InsertAction[];
```

解析规则：

- 必须是数组。非数组忽略。
- 元素只能是四个字面量。其他字符串丢掉。
- 去重，保留首次出现（不影响展示顺序）。
- 缺省 / 空数组 = 未传。

Dev query（仅 DEV）：`?visibleInsertActions=emoji,mention,channel,image`。

`mount-editor` 的 `resolveDesktopChrome`：

```tsx
<RichTextToolbar
  visibleInsertActions={config.visibleInsertActions}
  onRequestEmoji={(selection) => hostRef.current?.requestEmoji(selection)}
  onRequestMention={(selection) => hostRef.current?.requestMention(selection)}
  onRequestChannel={(selection) => hostRef.current?.requestChannel(selection)}
  onRequestImage={(selection) => hostRef.current?.requestImage(selection)}
  // 现有 onOpenLinkForm / onRequestClose / showCloseButton / titleFocused 不变
/>
```

四个回调始终传入（和生产 host 方法绑定）。显隐只看允许列表。Playground 自己传列表和 mock 回调，不走 host。

### 协议事件（`packages/protocol`，v2 不升版本）

```ts
export type RequestInsertSelectionPayload = { selection: ProtocolSelection | null };

export type RequestEmojiEvent = ProtocolEvent<"request_emoji", RequestInsertSelectionPayload>;
export type RequestMentionEvent = ProtocolEvent<"request_mention", RequestInsertSelectionPayload>;
export type RequestChannelEvent = ProtocolEvent<"request_channel", RequestInsertSelectionPayload>;
export type RequestImageEvent = ProtocolEvent<"request_image", RequestInsertSelectionPayload>;
```

校验：与 `selection_change` 相同，`validateNullableSelectionContainer`（精确键 `selection`，值对象或 `null`）。多余字段失败。

`EVENT_TYPES`、`EditorEventMessage`、`index.ts` 导出、`fixtures/v2.json` 四个样例（一个带选区、至少一个 `selection: null`）。`fixtures/v1.json` 不动。

host-web：

```ts
interface RichTextHost {
  requestClose(): void;
  requestEmoji(selection: ProtocolSelection | null): void;
  requestMention(selection: ProtocolSelection | null): void;
  requestChannel(selection: ProtocolSelection | null): void;
  requestImage(selection: ProtocolSelection | null): void;
}
```

未 ready 时 no-op，与 `requestClose` 相同。`editor-event-bridge.ts` 增加四个 `createProtocolRequest*Event`。

### Dart 客户端（`clients/flutter_quill_editor`）

- `messages.dart`：`RequestEmojiEvent` 等四个 `ProtocolEvent` 子类，`payload => {'selection': selection?.toJson()}`。
- `codec.dart`：`_eventTypes` 加入四个 type；decode 走与 `selection_change` 相同的 nullable selection。
- `richtext_editor_controller.dart`：四条 `Stream<Request*Event> get onRequest*`，`dispose` 时 close；`onEvent` 仍转发全部事件。
- `RichTextWebView.visibleInsertActions`：`List<String> visibleInsertActions = const <String>[]`。注入 config 的 `visibleInsertActions` 键。`didUpdateWidget` 与 `showCloseButton` 一样，变化则重注入。
- `buildRichTextTransportBootstrapJs` 增加可选 `List<String>? visibleInsertActions`，JSON 写入 `__TG_RICHTEXT_CONFIG__`。默认 `[]`。
- native loader 各后端把该字段传到 bootstrap / `initializeRuntime`。
- golden / `test/fixtures/richtext_protocol/v2.json` 与 TS fixture 同步。`v1.json` 不动。

合法字符串（与 TS 闭集一致，不在此包引入业务枚举也可）：`emoji`、`mention`、`channel`、`image`。非法值由 runtime 丢掉；Dart 侧原样下发即可。

## 样式

`apps/webview-runtime/src/style.css` 与 `apps/playground/src/style.css` 同步：

```css
.tg-webview-toolbar .tg-toolbar-separator,
.toolbar .tg-toolbar-separator {
  flex: 0 0 auto;
  width: 1px;
  height: 16px;
  margin: 0 6px;
  background: var(--tgg-divider-low, #e3e8e5);
  border: none;
  align-self: center;
}
```

playground 亮色兜底 `#e3e8e5`（`--tgg-divider-low` 在 playground 可能不存在）。runtime 用 token，暗色已有 `#313532`。

solid-toolbar 包继续不带 CSS。

## 实施步骤

### 阶段 0 文档

- [x] grilling 决策写入 `CONTEXT.md`
- [x] `docs/adr/0005-host-owned-insert-actions.md`
- [x] 本计划
- [x] 实施时修订 `docs/plans/richtext-solid-toolbar.md`：把「暂不实现 EmojiPicker…」改为「按钮在 toolbar，选择器仍归宿主，见 ADR 0005」
- [x] `docs/plans/richtext-protocol.md` 的 Web→Flutter 事件目录补四条
- [x] `packages/solid-toolbar/README.md` 说明插入操作、`visibleInsertActions`、宿主回调

### 阶段 1 协议 + host-web + Dart codec

可与阶段 2 并行，但 fixture / golden 必须 TS 与 Dart 同源。

- [x] protocol：类型、guards、`EVENT_TYPES`、导出、v2 fixture、events 测试（接受带选区、接受 `null`、拒绝缺字段、拒绝多余键）。
- [x] host-web：四个 `request*`、event-bridge、create-host 未 ready no-op、event-bridge 测试。
- [x] Dart：messages / codec / controller streams / `request_*_event_test.dart`（对照 `request_close_event_test.dart`）/ protocol golden。

### 阶段 2 solid-toolbar UI

- [x] `toolbar-labels.ts` 四键。
- [x] `ToolbarIcons.tsx` 四个 `currentColor` 图标。
- [x] `RichTextToolbar`：允许列表、固定顺序、分隔线、四个回调、标题聚焦 / 无回调禁用、点击带 selection 且 `restoreFocus: false`。
- [x] 测试（`packages/solid-toolbar/tests/index.test.tsx`）：
  - [x] 默认（不传允许列表）仍是现在的 11 项顺序，没有插入按钮、没有分隔线。
  - [x] 传入四个全开：英文顺序前插 `Emoji, Mention, Channel, Image`；中文前插 `表情, 提及, 频道, 图片`。
  - [x] 只传 `["image","emoji"]`：只出现表情和图片，且表情在图片前（顺序不跟数组）。
  - [x] 传入未知值 / 重复：忽略 / 去重。
  - [x] 有列表无回调：按钮存在且 `disabled`。
  - [x] 有回调：点击调用一次，参数为当前 `getState().selection`（含 `null`）。
  - [x] `titleFocused`：插入按钮 disabled，点击不调用。
  - [x] 分隔线：有插入操作时 DOM 里有 `.tg-toolbar-separator`；没有时无。

### 阶段 3 webview-runtime + playground

- [x] `runtime-config.ts` 解析允许列表；测试覆盖注入、query、非法值、缺省。
- [x] `mount-editor.tsx` 把 config 和四个 host 方法接到 toolbar。
- [x] runtime / playground CSS 分隔线。
- [x] playground：`visibleInsertActions` 四个全开；四个回调 `console.log(type, selection)`。不在 playground 里插真实 embed（第一刀无 Flutter 选择器）。
- [x] DEV query 可单独点亮，便于不改 playground 代码时预览。

### 阶段 4 Flutter WebView 注入

- [x] `RichTextWebView.visibleInsertActions`
- [x] bootstrap JS / native loader / web `initializeRuntime` config map
- [x] `transport_bootstrap_test.dart`：默认注入 `[]`；传入四个时 JS 含该数组
- [x] `didUpdateWidget` 变化时重注入（与 `showCloseButton` 相同路径）

### 阶段 5 验证

在 `flutter_quill_editor` 根目录：

- [x] `vp check` / `vp test` / `vp run -r build`（至少 protocol、host-web、solid-toolbar、webview-runtime）
- [x] Dart：`flutter test`（codec、controller、bootstrap、golden）
- [x] 人工：playground 四个按钮、分隔线、tooltip 中英文、点击日志带 selection；不传允许列表时与现在一模一样
- [x] 不跑 teamgaga-client 的 Circle 发布页（第一刀接不上，按钮被默认隐藏）

## 后续（teamgaga-client，第一刀禁止改）

单独 PR。依赖第一刀已发布/已 path 依赖的 `flutter_quill_editor`。

### 抽出 `WebRichTextInsertHost`

从 `app/lib/pages/richtext/components/web_rich_text_toolbar.dart` 挪出与 UI 底栏无关的插入流程，供 IM 底栏和 Circle 桌面共用：

- 表情：打开现有表情面板（桌面 `ReactionPanelWeb`），选中后 `editor.insertEmoji`
- 提及：`_ensureWebTriggerChar('@')` + `showAtListWeb` / 竖屏 `showAtListDialog`，再 `insertMention`
- 频道引用：`_ensureWebTriggerChar('#')` + `MentionChannelListSheet.showChannelWeb` / 竖屏 sheet，再 `insertChannel`
- 正文媒体：桌面 `pickFiles(..., fileType: FileType.media)`，竖屏 `AssetPickerWidget`；`insertImage` 或 `insertVideo`
- 桌面菜单定位：复用 `_resolveWebDesktopMenuPlacement`（编辑器左缘 + caret Y）
- 打字 `@` / `#`：订阅 `MentionTriggerManager`

IM 的 `WebRichTextToolbar` 改为调用该宿主，视觉底栏保留。不要 Offstage 挂整条工具栏。

### Circle 横屏接线

`CirclePublishRichTextPage.webChild()`：

- `RichTextWebView(visibleInsertActions: ['emoji','mention','channel','image'], ...)` 仅 `UniversalPlatformX.isLandscape`
- 竖屏不传（默认 `[]`），继续 `inputting` 时挂 `WebRichTextToolbar`
- 监听四条 `onRequest*`，交给插入操作宿主；payload 的 `selection` 传给插入路径（工具栏点击常会先 blur，不能只信事后的 `getSelection`）
- 挂上插入操作宿主（含 `MentionTriggerManager`），这样打字 `@` / `#` 在 Circle 桌面也可用
- 表情面板也走 caret 锚定，不要虚构一个 Flutter 工具栏按钮当锚点
- 不挂 `WebRichTextToolbar.buildWeb()`（Circle 桌面发布按钮是自己的，不是 Send/Complete 底栏）

IM 的 `RichTextInputPage` 永不传 `visibleInsertActions`。

## 完成定义（第一刀）

- 不传 `visibleInsertActions` 时，Solid 工具栏 DOM 与现在的 11 项 + 可选关闭完全一致。
- 传入允许列表时，四个插入操作出现在最前，其后是工具栏分隔线，再是原排版控件。
- 点击只发协议事件，不改 Delta。
- Dart controller 能收到四条 `onRequest*`，payload 含 `selection` 或 `null`。
- Playground 可看见并可点（日志）。
- teamgaga-client 零 diff。
- 协议仍为 v2。
- 自动化检查、测试、构建通过。

## 完成定义（后续，不在第一刀验收）

- Circle 横屏四个按钮可见，点开会打开现有 Flutter 选择器，选中后正文出现对应 embed。
- Circle 横屏打字 `@` / `#` 弹出与 IM 桌面相同的 caret 菜单。
- IM 桌面 Solid 工具栏仍无这四个按钮；IM 底栏行为不变。
- Circle 竖屏仍走 Flutter 底栏，无回归。
