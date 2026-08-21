# TeamGaga RichText 待办与下一阶段

- 更新时间：2026-08-21
- 范围：`docs/plans` 中尚未完成的事项 + 推荐执行顺序
- 说明：本文件是跨计划总览，细节仍以各专项计划为准
- Flutter 客户端实现：`teamgaga-client` / `refactor-richtext`（`ca1de52e5` 起，含 Link/Divider Toolbar 接入）
- 当前 Flutter 内置 runtime：`buildId` `2026-07-29T02:20:55.955Z`（已含 `insert_link` / `insert_divider`）

## 计划文档状态

| 文档                                     | 状态                          | 说明                                                                             |
| ---------------------------------------- | ----------------------------- | -------------------------------------------------------------------------------- |
| `richtext-host-web-lifecycle.md`         | 已完成                        | Host 生命周期、事件桥、webview-runtime 壳、浏览器开发闭环                        |
| `richtext-host-web.md`                   | Flutter 接入完成 / 真机未完   | Channel adapter、runtime 加载、Host ready 已落地；iOS/Android 人工联调待做       |
| `richtext-flutter-bridge.md`             | 契约与客户端基线完成          | `webview_flutter`、inject 顺序、`TgRichTextBridge` adapter 已落地                |
| `richtext-protocol.md`                   | TS / Dart 对齐完成            | Protocol v2；含 Link/Divider、`open_link_form`、插入操作 `request_*`             |
| `richtext-solid-toolbar.md`              | 拆包完成 / 插入操作第一刀完成 | Desktop Toolbar 可独立使用；插入操作按钮已落地，选择器仍归宿主（ADR 0005）       |
| `richtext-insert-actions.md`             | 第一刀已完成                  | Solid 工具栏插入操作 + 协议事件；`teamgaga-client` 接线仍待做                    |
| `richtext-link-popover.md`               | 运行时已落地                  | 链接浮层在 WebView 内（ADR 0004）；宿主仓清理以 teamgaga-client 为准             |
| `richtext-solid-toolbar-tooltip-i18n.md` | 代码已落地                    | 自定义 Tooltip + zh/en labels；文末完成定义仍作验收清单                          |
| `richtext-inline-embed-clipboard.md`     | 已完成                        | 内联嵌入复制/粘贴/拖放（ADR 0006）；保住提及/频道/表情实体，剔除正文媒体与分割线 |
| Flutter 专项计划                         | 客户端基线完成                | `teamgaga-client` 已接入正文、原生 Toolbar、草稿和发送；完整 SDK 文档可扩展      |

---

## 待完成任务汇总

### A. Host Web / Runtime（主线）

来源：`richtext-host-web.md`、`richtext-host-web-lifecycle.md`、`richtext-flutter-bridge.md`

| ID                     | 任务                                      | 优先级             | 备注                                                                                                                |
| ---------------------- | ----------------------------------------- | ------------------ | ------------------------------------------------------------------------------------------------------------------- |
| `HOST-PRE-02`          | 确认 Flutter WebView 插件及 JS Bridge API | **已决策**         | **P0：`webview_flutter` + `JavascriptChannel` `TgRichTextBridge`**；Desktop 可后续用 inappwebview，共用 inject 契约 |
| `HOST-05`              | 实现 Flutter channel transport adapter    | **已完成**         | `webview_flutter` 注册 `TgRichTextBridge`，并注入 `CONFIG`、transport factory 与 deliver 回调                       |
| `VERIFY-06`（父计划）  | iOS / Android Flutter WebView 人工联调    | **挂起**           | 按当前优先级暂缓；后续恢复时验证 runtime、IME、中文、Emoji、返回键与销毁                                            |
| Runtime 生产 bootstrap | Web 侧 fail-fast + inject 模板            | **端到端接入完成** | Flutter 已打包 runtime assets，经 loopback HTTP 加载，并在导航周期幂等注入 transport                                |

本阶段 Web 已完成（不必重做）：

- Transport 契约、Window transport、Memory transport、`createCallbackTransport`
- Protocol → Core dispatcher
- Solid HostApp、`createRichTextHost`、ready FIFO、event bridge、幂等 destroy、可选 `renderChrome`
- `apps/webview-runtime`：`base: './'`、config 注入、生产 transport fail-fast、desktop toolbar 条件挂载、`runtime-version.json`、`scripts/flutter-inject-template.js`

### B. Protocol 跨端对齐

来源：`richtext-protocol.md`

| ID            | 任务                                  | 优先级     | 备注                                                                             |
| ------------- | ------------------------------------- | ---------- | -------------------------------------------------------------------------------- |
| `PROTOCOL-16` | Flutter 侧实现对应 Dart 模型          | **已完成** | sealed class / union、编解码、`PROTOCOL_VERSION = 1`                             |
| `PROTOCOL-17` | TypeScript / Dart golden fixture 测试 | **已完成** | Dart 使用 vendored fixture；当前与 `packages/protocol/fixtures/v1.json` 内容一致 |

对齐原则：

- TS 编码结果必须能被 Dart 解码，反向亦然
- 协议字段变更必须同时更新 TS 与 Dart golden fixture
- Protocol 不依赖 Solid、Quill、DOM 或具体 Flutter 插件

### C. Solid Toolbar / Desktop（非移动主路径）

来源：`richtext-solid-toolbar.md`

| 任务                                                             | 优先级 | 备注                                                                  |
| ---------------------------------------------------------------- | ------ | --------------------------------------------------------------------- |
| 明确 embed payload 后增加 image / mention / channel / video 命令 | 已完成 | Core / Protocol / Host / Quill 已实现                                 |
| 按需增加 EmojiPicker、ImageButton、Mention UI                    | P2     | 仅 Desktop/PC Web                                                     |
| 上传与资源选择保持业务注入                                       | P2     | 不进入 Core                                                           |
| Windows / macOS / PC Web 人工交互验证                            | P2     | 自动化已通过；runtime 可用 `toolbarMode=desktop`                      |
| Desktop Toolbar SVG 图标（`vite-solid-svg`）                     | P2     | **已完成（改道）**：手写 `ToolbarIcons.tsx`；checklist D11 待目视验收 |

移动端 Toolbar **不走** Solid Toolbar，由 Flutter 原生实现。Runtime 默认 `toolbarMode: 'none'`。

### D. Link / Divider（本轮已完成）

| 任务                                                             | 优先级     | 备注                                                                                              |
| ---------------------------------------------------------------- | ---------- | ------------------------------------------------------------------------------------------------- |
| Protocol / Core / Host / Quill：`insert_link` / `insert_divider` | **已完成** | 选区替换链接、编辑已有链接；Divider 在当前或最后选区原子插入                                      |
| TS / Dart fixture 同步与 golden                                  | **已完成** | `packages/protocol/fixtures/v1.json` 与 Flutter golden 已对齐                                     |
| Flutter 原生 Toolbar 复用 More 面板 / LinkDialog                 | **已完成** | `MoreTabGridView`、Divider item、`QuillToolbarLinkStyleButton`、`LinkDialog`                      |
| webview-runtime 重建并同步 Flutter assets                        | **已完成** | `app/assets/richtext_webview_runtime` ← `apps/webview-runtime/dist`（`2026-07-29T02:20:55.955Z`） |

### E. 内联嵌入剪贴板（ADR 0006）

来源：`richtext-inline-embed-clipboard.md`

| ID        | 任务                                                           | 优先级     | 备注                                               |
| --------- | -------------------------------------------------------------- | ---------- | -------------------------------------------------- |
| `CLIP-01` | 复制 HTML 重写：表情为 `:id:` 文本 span，剥离媒体/分割线/`src` | **已完成** | `rewriteCopyHtml` + `extractPlainText` 落地        |
| `CLIP-02` | 粘贴/拖放 matcher + `stripEmbeds` 对齐残缺表                   | **已完成** | `ClipboardPolicy` + `stripEmbeds` 对齐残缺与降级表 |
| `CLIP-03` | 纯文本不升格、未注册表情保留、剪切丢图有意缺口                 | **已完成** | 单测与 DOM 契约全量覆盖                            |
| `CLIP-04` | `vp check` / `vp test` / runtime 构建与客户端同步              | **已完成** | 自动化测试与构建产物通过                           |

### F. 尚未成文的工作（建议单独开计划）

| 工作项                                            | 优先级               | 说明                                                                              |
| ------------------------------------------------- | -------------------- | --------------------------------------------------------------------------------- |
| 扩展 Flutter 客户端计划（SDK 结构、原生 Toolbar） | 基线完成 / 文档待补  | 客户端结构与原生 Toolbar 已落地；完整 Flutter SDK 计划仍可单独成文                |
| Flutter 工程（本 monorepo 外或内）                | **已完成**           | 外部仓库 `teamgaga-client` 的 `refactor-richtext` 分支                            |
| 媒体 / Mention / Channel 协议与 Core 命令         | **已完成（自动化）** | Protocol → Core → Host → Quill 与 Flutter 接入已完成；真机验证随 `VERIFY-06` 恢复 |
| 多编辑器实例路由                                  | P3                   | Host lifecycle 明确本阶段不做                                                     |
| command/event 节流                                | P3                   | 无真实设备数据前不提前优化                                                        |

### G. WebView 富文本视觉对齐（ADR 0002）

| ID               | 任务                                                                        | 状态       | 完成定义                                                                            |
| ---------------- | --------------------------------------------------------------------------- | ---------- | ----------------------------------------------------------------------------------- |
| `STYLE-QUOTE-01` | 对齐 Quote 内容透明度、左侧色块尺寸/颜色/圆角及内容间距，并同步 App runtime | **已完成** | 连续色块零间距且不重叠，仅组首顶部/组尾底部保留圆角；runtime 与 client 双端契约通过 |

---

## 下一阶段要做的事

### 阶段目标

端到端通信主链路已经打通。Mention、Channel、图片、视频、Link、Divider、插入操作请求事件、内联嵌入剪贴板往返（ADR 0006）已完成自动化验证。Android 标题/WebView 焦点与滑动抖动、iOS/Android 真机联调按产品优先级暂时挂起。

```text
Flutter App（已接入）
  → WebView 加载 apps/webview-runtime/dist（base './'）
  → Inject CONFIG + __TG_RICHTEXT_CREATE_TRANSPORT__
  → Channel transport（JS ↔ Dart，TgRichTextBridge）
  → Protocol command / response / event
  → Host → Core 编辑器
```

上述链路及 Mention、Channel、媒体、Link、Divider 命令、剪贴板内联嵌入往返已有实现与自动化测试；iOS/Android 基础人工联调仍待恢复。

### 推荐顺序

```text
1. HOST-PRE-02 — 已完成
   webview_flutter + TgRichTextBridge（见 richtext-flutter-bridge.md）

2. Flutter 客户端：加载 dist + 注入脚本 — 已完成
   复制 scripts/flutter-inject-template.js
   CONFIG → TRANSPORT → 导航 index.html

3. PROTOCOL-16 + PROTOCOL-17 — 已完成
   Dart 模型 + 与 packages/protocol/fixtures 的 golden 测试

4. HOST-05（Flutter 侧）— 已完成
   用 channel 实现 inject 模板中的 send / deliver
   生产 bootstrap 注入 __TG_RICHTEXT_CREATE_TRANSPORT__

5. Mention / Channel / 媒体全链路 — 已完成（自动化）
   Flutter 原生 Toolbar 与原有选择面板保持样式不变
   Toolbar 与键入 @/# 均可触发，支持选区原子替换与多选顺序插入
   图片/视频使用本地 token 预览，草稿还原本地路径，发送时沿用现有上传与加密语义

6. Link / Divider 全链路 — 已完成（自动化 + runtime 已同步）
   复用 More 面板 Divider item 与 QuillToolbarLinkStyleButton / LinkDialog
   insert_link 支持选区替换与编辑已有链接；insert_divider 原子插入
   Flutter 内置 runtime buildId 2026-07-29T02:20:55.955Z

7. 桌面插入操作第一刀 — 已完成
   Solid 工具栏 request_* + visibleInsertActions；选择器仍归宿主（ADR 0005）

8. 内联嵌入剪贴板 — 已完成
   见 `richtext-inline-embed-clipboard.md` / ADR 0006
   复制/粘贴/拖放保住提及、频道引用、表情实体；继续剔除正文媒体与分割线

9. Android 焦点与键盘稳定性修复 — 挂起
   标题聚焦时允许 WebView 滚动但不抢焦点
   仅真实正文点击触发 focus，等待 Web FocusEvent 后再切换 Flutter 焦点

10. VERIFY-06 真机联调 — 挂起
    ready / set_snapshot / get_snapshot / 格式 / focus-blur
    Link / Divider 交互、中文 IME、Emoji、剪贴板往返、返回键、destroy 无泄漏
```

### 阶段完成定义（DoD）

- [x] Flutter 插件与 Bridge API 已书面确认（P0：`webview_flutter` / `TgRichTextBridge`）
- [x] Dart Protocol 模型与 TS fixtures 双向 golden 通过
- [x] 生产 runtime 可被 Flutter WebView 加载，且 transport 注入后 Host ready
- [x] 每条 command 有关联 success/failure response
- [x] Core 事件（除 Core ready 外）可发到 Flutter；Protocol ready 仅 Host 发一次
- [x] Mention / Channel 支持 Toolbar 与键入 `@` / `#`，且复用现有 Flutter 选择面板
- [x] 图片 / video 支持本地预览、草稿 round-trip 与发送时上传；未知 token 不进入业务 Delta
- [x] Link / Divider：Protocol → Core → Host → Quill → Flutter Toolbar；runtime assets 已同步
- [x] Flutter Toolbar 图标按钮、间距、尺寸及激活面板组件保持现有样式；仅按功能需要补入已有 Channel 按钮
- [ ] Android 标题 / WebView 焦点切换不因滑动造成键盘与页面抖动（挂起）
- [ ] iOS 与 Android 完成清单内人工联调（挂起）
- [x] Host 仍不直接依赖 Quill / Solid Toolbar；默认 runtime 为 editor-only（`toolbarMode: none`）
- [x] 内联嵌入复制/粘贴/拖放按 ADR 0006 往返（见 `richtext-inline-embed-clipboard.md`）

### 明确不做（本阶段）

- 在 Host 内实现 Flutter 原生 Toolbar UI
- 未确认插件前伪造多套 production channel
- 选取媒体时立即上传、通过 Protocol 传二进制或上传进度
- Desktop Solid Toolbar 作为移动默认路径
- 多编辑器实例协议
- 当前恢复 Android 标题/WebView 焦点与滑动抖动修复
- 当前执行 iOS/Android 真机联调
- 经剪贴板搬正文媒体，或从纯文本推断提及/频道引用/表情

---

## 与各计划的对照

| 下一步                             | 主要文档                                  |
| ---------------------------------- | ----------------------------------------- |
| 内联嵌入复制/粘贴/拖放             | `richtext-inline-embed-clipboard.md`      |
| 插件确认、channel inject、加载契约 | `richtext-flutter-bridge.md`              |
| Host 生命周期与 runtime 壳         | `richtext-host-web.md` / lifecycle        |
| Dart 模型与 golden                 | `richtext-protocol.md` § Flutter 对齐任务 |
| Desktop Toolbar 插入操作           | `richtext-insert-actions.md`              |
| Desktop Toolbar 增强               | `richtext-solid-toolbar.md`               |
| 本总览                             | `todos.md`（本文）                        |

---

## 建议的立即行动

1. ~~**产品/客户端确认** `HOST-PRE-02`~~ → **已完成**：`webview_flutter` + inject factory。
2. ~~**Flutter 工程加载 runtime 并注入 transport**~~ → **已完成**。
3. ~~**PROTOCOL-16 / PROTOCOL-17 Dart 模型与 golden**~~ → **已完成**。
4. ~~**媒体 / Mention / Channel 协议与 Core 命令**~~ → **已完成（自动化）**。
5. ~~**Flutter 原生 Toolbar 接入 Mention / Channel / 图片 / 视频**~~ → **已完成**，现有样式与面板保持不变。
6. ~~**Link / Divider 全链路 + runtime 同步**~~ → **已完成**（`2026-07-29T02:20:55.955Z`）。
7. ~~**桌面插入操作第一刀**~~ → **已完成**（ADR 0005；Circle 接线仍在 teamgaga-client）。
8. ~~**内联嵌入剪贴板**~~（`docs/plans/richtext-inline-embed-clipboard.md`，ADR 0006） → **已完成**：保住提及/频道/表情实体，剔除正文媒体与分割线。
9. **挂起：Android 标题 / WebView 焦点与滑动抖动**。
10. **挂起：iOS / Android 真机联调 `VERIFY-06`**（恢复时一并验证 Link / Divider / 剪贴板往返）。
