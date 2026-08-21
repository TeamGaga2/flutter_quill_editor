# richtext 链接浮层移入 WebView 运行时实施计划

## 文档状态

- 日期：2026-08-19
- 状态：运行时浮层已落地（见 docs/adr/0004-link-popover-in-webview-runtime.md）；teamgaga-client 宿主清理是否完成以该仓为准
- 涉及仓库：flutter_quill_editor（运行时 TS 包 + Flutter 客户端 clients/flutter_quill_editor）与 teamgaga-client（宿主清理）
- 验收依据：docs/plans/INSERT_LINK_LAYER_REFERENCE.md（参考规格全文与明暗色值表）

## 背景与目标

现状链路：Solid 桌面工具栏 link 按钮 / 移动端 Flutter 底栏 link 项 / Cmd/Ctrl+K → request_link 事件（或直接调用）→ Flutter 宿主对话框（teamgaga-client 的 link_dialog/ + web_editor_host_link.dart）→ insert_link 命令回写运行时。宿主侧为此维护了跨边界光标锚定、DesktopPlatformViewPointerGate、焦点/IME 恢复等机制。

目标：插入链接浮层移入 WebView 运行时内渲染，样式 1:1 还原现役参考（桌面锚定浮层 360x230 + 移动居中模态），颜色全部走 --tgg-* 变量（主题切换自动生效），文案 en/zh/hi 三语（locale 由 Flutter 注入、navigator 兜底）；宿主侧旧实现全部删除；协议升 v2。

## 已确认决策要点（与 ADR 0004 一致）

- 浮层组件与状态 hook 放 packages/solid；CSS 放 webview-runtime 的 style.css；两端 mount 均挂载浮层宿主。
- 触发三入口：Solid 工具栏按钮本地打开；Flutter 底栏按钮经新命令 open_link_form（零载荷）；Cmd/Ctrl+K 由运行时内绑定（Quill 默认绑定仅 Snow 主题存在，本运行时 theme 为 undefined，必须自建；仅编辑器聚焦时生效）。
- 协议 v2：移除 request_link；保留 insert_link（通用能力）；新增 Flutter→Web 命令 open_link_form；PROTOCOL_VERSION 升 2、无 v1 兼容层；golden fixtures 迁 v2、Dart 拷贝同步。
- 浮层确认后由运行时直接执行 editor.commands.insertLink，不经协议往返；prepareWebTextLink 预填逻辑迁移进 web。
- 行为怪癖原样保留：URL 必须显式 scheme（不自动补 https）、无错误文案（无效即禁用提交）、Enter 不绑定提交、无 Escape 绑定、无取消链接入口。
- 验收：CSS 变量值契约测试 + 截图视觉测试（两形态 x 明暗），对照参考文档测量级比对。
- 发布：跨两仓变更完成后，通过 exact runtime promotion 和 Flutter lock/vendor 更新；详见 ADR 0007。

## 参考行为规格（实施逐项对照）

### 桌面锚定浮层（LandscapeLinkDialog 等价）

- 面板：宽 360、maxHeight 230、padding 24、radius 16、背景 fill04、阴影 effects.primary（ARGB(52,0,0,0)、offset(0,8)、blur 40、明暗同值）；无标题栏。
- 遮挡层：全屏透明（无压暗），点外部关闭。
- 锚定：光标矩形（editor.getCaretRect()，viewport 相对 CSS px）下方 (anchorRect.left, anchorRect.bottom)，空间不足自动向上翻转，横向 clamp 进视口（对齐 Menu 的 auto 语义）。
- 布局：链接输入框（autofocus，hint=enterLink）→ 间距 16 → 文本输入框（hint=enterText1）→ 间距 24 → Row(end)：取消（宽 92）间距 16 确认（宽 92）。
- 输入框：radius 8；边框 常态 border01 / 聚焦 primary03 / 错误 redSecondary；填充 base fill03、focus fill04、hover fill04；文字 14px/w400 text01；hint 14px/w400 text04；contentPadding 水平 16。
- 确认按钮：FilledButton 风格，背景 schemesPrimary、文字 schemesOnPrimary；禁用态背景 primary04、文字 text05；尺寸 84x40；radius 8；文字 14px/w500；padding 水平 16。
- 取消按钮：OutlinedButton 风格，边框 schemesOutlineVariant、边框宽 1、文字 schemesOnSurfaceVariant、宽 92。

### 移动居中模态（PortraitLinkDialog 等价）

- 居中模态：背板黑色 70%（transparentOpacityOpacityBlack70，精确 ARGB 实施时从 tgg_design 实例读取）、点背板关闭。
- 面板：宽 420（GeneralDialog 默认）、padding fromLTRB(24,28,24,24)（实施时核对 portrait_link_dialog.dart 的 showDialogRoute 调用参数：radius / dialogBgColor / boxShadow）。
- 标题：addLink，标题与表单间距 12；表单与按钮间距 12。
- 输入框：radius 8；填充 base fill01；文字 16px/w400 text01；hint text04；contentPadding 垂直 14 水平 16。
- 按钮：Row([Expanded 取消, 间距 16, Expanded 确认])；确认文字 14px/w500、padding 水平 24、radius 移动端无圆角限制（跟随参考）。

### 行为

- 打开：读取当前选区——有选中文本 → 文本预填为选中文本、链接为空；光标（零长选区）落在既有链接内 → 选区扩展到整段链接、预填链接文字与 URL（编辑模式）；无选区 → 空表单。链接输入框获得焦点。
- 提交校验：text 非空 且 link 匹配正则 r"(http|mp)s?:\/\/[a-zA-Z\d@:._+~#=-]{1,256}\.[a-z\d]{2,18}\b([-a-zA-Z\d!@:_+.~#?&\/=%,$]*)"（与 business_layer string_extension.dart 的 urlPattern 逐字一致）；不满足则确认按钮禁用，无错误提示。
- 确认：editor.commands.insertLink({url, text}, selection)——Delta retain(start)+delete(end-start)+insert(text,{link:url})，光标置插入文本后（SILENT），ensureSelectionVisible；关闭浮层，焦点回编辑器（preventScroll）。
- 取消 / 点外部 / 点背板：关闭，不做任何文档改动。
- 重入：浮层已打开时再次触发为 no-op（替代宿主侧 _webLinkDialogOpen 锁）。
- 快捷键：Cmd/Ctrl+K 打开（浮层已开时 no-op）；Enter 不提交；Escape 不绑定。

### 文案（zh / en / hi，逐字对照）

| 键         | zh                 | en                            | hi                                              |
| ---------- | ------------------ | ----------------------------- | ----------------------------------------------- |
| enterLink  | 粘贴或输入链接地址 | Paste or enter a link address | 见 app_hi.arb（参考文档中截断，实施时整段复制） |
| enterText1 | 输入文本           | Enter text                    | 同上                                            |
| addLink    | 添加链接           | Add link                      | 同上                                            |
| cancel     | 取消               | Cancel                        | 同上                                            |
| ok         | 确定               | OK                            | 同上                                            |

## CSS 变量补全（style.css 两段，theme.css 不改）

新增（:root 亮色 / html.tg-theme-dark 暗色）：

| 变量                             | 亮                                | 暗         | 用途                                          |
| -------------------------------- | --------------------------------- | ---------- | --------------------------------------------- |
| --tgg-fill04                     | #FFFFFF                           | #3A3A3A    | 浮层面板背景                                  |
| --tgg-fill03                     | #FAFAFA                           | #313131    | 桌面输入框 base                               |
| --tgg-fill01                     | #E9E9E9                           | #272727    | 移动输入框 base                               |
| --tgg-text01                     | #121212                           | #FAFAFA    | 输入文字                                      |
| --tgg-text05                     | #FFFFFF                           | #FFFFFF    | 确认按钮禁用文字                              |
| --tgg-schemes-primary            | #009C64                           | #91D5AC    | 确认按钮背景                                  |
| --tgg-schemes-on-primary         | #FFFFFF                           | #003921    | 确认按钮文字                                  |
| --tgg-schemes-outline-variant    | #A0A7A1                           | #4E5550    | 取消按钮边框                                  |
| --tgg-schemes-on-surface-variant | 实施时读值                        | 实施时读值 | 取消按钮文字（tgg_design AppColors 明暗实例） |
| --tgg-primary03                  | #38C585                           | #009C64    | 输入框聚焦边框                                |
| --tgg-primary04                  | #88DCB6                           | #4A8F70    | 确认按钮禁用背景                              |
| --tgg-shadow-primary             | 0px 8px 40px 0px rgba(0,0,0,0.20) | 同左       | 面板阴影（ARGB52/255=0.204）                  |

已有复用：--tgg-border01（#E3E3E3/#474747）、--tgg-text04（#ACACAC）、--tgg-red-secondary（#BA1A1A）。

移动背板色：rgba(0,0,0,0.70) 量级（opacityBlack70），精确 ARGB 实施时从 tokens.g.dart 读取。

命名沿用现有 --tgg-* 风格；token 来源注释按 ADR 0002 纪律标注。

## 架构落点

| 包                           | 职责                                                                                                                                                                                                                                                                                               |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| packages/solid               | LinkPopover 表单组件；LinkPopoverHost（桌面锚定 + 移动模态/背板、翻转与 clamp）；useLinkPopover 状态机（closed/open）；prefill 逻辑（port prepareWebTextLink：quill.getSelection + getText/getFormat + Link blot 扩展）；link-popover-labels i18n（zh/en/hi，locale 判定 zh-*→zh、hi→hi、其余 en） |
| apps/webview-runtime         | style.css 新增变量与浮层/模态样式（z-index：锚定浮层 30、模态层 40）；mount-editor 恒挂 LinkPopoverHost；locale 解析 runtimeConfig.locale ?? navigator.language 传入组件；Cmd/Ctrl+K 绑定（quill.keyboard.addBinding({key:'k', shortKey:true})，注意与现有绑定冲突检查）                           |
| packages/solid-toolbar       | RichTextToolbar link 按钮改为本地 openLinkForm()；删除 onRequestLink prop、link-request.ts 与相关注释                                                                                                                                                                                              |
| packages/protocol            | 移除 RequestLinkEvent；新增 OpenLinkFormCommand {type:'open_link_form', payload:{}}；guards.ts 校验；PROTOCOL_VERSION=2；fixtures v2.json                                                                                                                                                          |
| packages/host-web            | 命令分发新增 open_link_form → 运行时 UI 控制器 openLinkForm() → 成功响应 {}；删除 requestLink() 与事件桥接                                                                                                                                                                                         |
| clients/flutter_quill_editor | messages.dart 移除 RequestLinkEvent、新增 OpenLinkFormCommand 编解码；richtext_editor_controller.dart 删除 _requestLinkController/onRequestLink、新增 openLinkForm()；richtext_webview.dart 配置 map 注入 locale（web 与 native 两处）；golden 测试与 test/fixtures/richtext_protocol/ 迁 v2       |
| teamgaga-client              | 删除与接入（见下）                                                                                                                                                                                                                                                                                 |

## 实施步骤

### 阶段 0 文档落库

- 本计划；参考文档已拷入 docs/plans/INSERT_LINK_LAYER_REFERENCE.md（teamgaga-client 根目录原件于阶段 8 删除）。

### 阶段 1 CSS token 补全 + 契约测试

- style.css 两段按上表新增变量（schemes-on-surface-variant 与背板 ARGB 现场读值）。
- Vitest 源码契约：断言 style.css 内各变量明暗值 == 参考表。
- clients/flutter_quill_editor/test/runtime_style_contract_test.dart 同步补断言。

### 阶段 2 协议 v2

- packages/protocol：events.ts 删 RequestLinkEvent；commands.ts 增 OpenLinkFormCommand；guards.ts；version.ts 升 2；fixtures v2.json（移除 request_link 样例、新增 open_link_form 样例）。
- packages/host-web：command-dispatcher 新 case；删 create-host requestLink 与 editor-event-bridge 的 request_link。
- Dart 侧：messages.dart、codec、controller、golden 测试、vendored fixture 同步；全量测试绿。

### 阶段 3 packages/solid 浮层

- link-popover-labels.ts（三语逐字复制，hi 从 app_hi.arb 整段复制）。
- useLinkPopover 状态机 + prefill 函数（三情形单元测试）。
- LinkPopover 表单（两输入框、双按钮、禁用态、autofocus、无 Enter/Escape 绑定）。
- LinkPopoverHost：toolbarMode==='desktop' → 锚定浮层（getCaretRect + 翻转 + clamp）；否则居中模态（背板 + 面板）；点外部/背板关闭；关闭后 quill.focus({preventScroll:true})。

### 阶段 4 webview-runtime 接线

- CSS：.tg-link-popover（桌面）与 .tg-link-popover-modal（背板/面板）双形态。
- mount-editor：恒挂 LinkPopoverHost；locale 解析传入。
- Cmd/Ctrl+K：quill.keyboard.addBinding（检查 adapter 现有 bindings 无冲突）。
- open_link_form 命令 → openLinkForm() 的运行时桥接（经 host-web 分发层）。

### 阶段 5 solid-toolbar 改造

- RichTextToolbar：link 按钮 onPress → openLinkForm()；删除 onRequestLink 类型与 buildLinkRequestContext 引用；删除 link-request.ts。

### 阶段 6 web 测试

- 引入 Playwright 基建（仓库现仅有 Vitest + happy-dom，无 Playwright 依赖/配置）：workspace 根加 playwright 依赖与 playwright.config（chromium 单浏览器即可）、截图基线与对比脚本、CI 接入（vp run 脚本）。
- packages/solid 单元测试：prefill 三情形、状态机（打开/取消/提交/验证禁用/重入 no-op）。
- Playwright 截图基线（apps/playground 加浮层演示页）：桌面锚定 x 亮/暗、移动模态 x 亮/暗，共四张；CI 比对。

### 阶段 7 Flutter 客户端

- richtext_webview.dart：web 与 native 两处配置 map 增加 locale（Localizations 语言码 en/zh/hi）；flutter-inject-template.js 注释同步说明。
- controller.openLinkForm()（发送 open_link_form，等待成功响应）。

### 阶段 8 teamgaga-client 清理与接入

- 删除：app/lib/pages/richtext/components/link_dialog/（三文件）、app/lib/pages/richtext/utils/web_editor_host_link.dart、app/lib/pages/richtext/utils/web_text_link.dart。
- rich_text_input_page.dart：删 onRequestLink 监听、_webLinkDialogOpen 锁、_openWebHostLink、Cmd/Ctrl+K CallbackShortcuts。
- circle_publish_rich_text_page.dart：删同名锁与监听。
- web_rich_text_toolbar.dart：底栏 link 项 onTap 改为 controller.openLinkForm()（删除 _handleWebLink 与宿主弹框编排）。
- 测试：删除 web_editor_host_link_contract_test.dart、web_editor_host_link_reentry_test.dart、web_text_link_test.dart；quill_toolbar_ui_contract_test.dart 改为断言 link 项发送 open_link_form。
- 删除根目录 INSERT_LINK_LAYER_REFERENCE.md 原件（规格已入库）。

### 阶段 9 文档同步与发布

- docs/plans/richtext-solid-toolbar-tooltip-i18n.md：修订「不使用 RuntimeConfig.locale、以浏览器语言为准」（L40 附近，浮层例外）与「明确不做…不重构 Link request」（L393-403）。
- docs/plans/richtext-solid-toolbar.md：L26「不共享 Button/Popup/Picker/Layout」改述（链接浮层为运行时自有 UI，非跨端共享面）；L117-122 待办更新。
- docs/plans/richtext-protocol.md：事件目录补全（title_focus/title_blur/request_link/request_close 现状修正）、命令表增 open_link_form、v2 说明。
- README.md：架构描述同步（浮层属运行时，宿主零编辑器 UI）。
- 发布：运行时构建资产刷新（vp run build → clients/flutter_quill_editor/assets/richtext_webview_runtime/），与 Flutter 客户端、teamgaga-client 变更同批提交（原子）。

## 测试清单汇总

1. style.css token 契约（明暗两段 == 参考表；Vitest + Dart runtime_style_contract_test）。
2. prefill 单元（无选区 / 选中文本 / 光标在链接内）。
3. 状态机（打开/取消/提交/验证禁用/重入 no-op/焦点恢复）。
4. 协议 v2 golden round-trip（TS fixtures + Dart）。
5. Playwright 截图四基线（两形态 x 明暗；Playwright 为本次新引入基建，见阶段 6），验收截图与参考并排比对。
6. teamgaga-client：删 3 个旧测试文件；更新 toolbar UI 契约测试。

## 实施时需现场读取的精确值（本计划不猜测）

- schemesOnSurfaceVariant 明暗色值：packages/tgg_design 的 AppColors 明暗实例（tokens.g.dart / theme.dart bundle 构造处）。
- transparentOpacityOpacityBlack70 精确 ARGB：tokens.g.dart。
- portrait_link_dialog.dart 的 showDialogRoute 调用参数：radius、dialogBgColor、boxShadow、面板宽。
- app_hi.arb 中 enterLink/enterText1/addLink/cancel/ok 完整 hi 文案（参考文档中截断）。
- packages/quill/src/adapter.ts 现有 keyboard bindings 全景（避免 Cmd/Ctrl+K 冲突）。

## 风险与已知取舍

- 语言判定并存：工具栏标签仍按 navigator.language（tooltip-i18n 计划范围），浮层按注入 locale——hi 用户将看到 hi 浮层配 en 工具栏。本次不扩大范围，留档待后续统一。
- 快捷键仅编辑器聚焦时生效；焦点在 Flutter 底栏时 Cmd+K 无响应（已确认的取舍）。
- Escape 不绑定、Enter 不提交（保留参考怪癖），桌面靠点外部关闭。
- Web 与 Flutter 字体渲染存在平台差异：验收时几何/颜色必须测量级一致，字体渲染允许引擎级差异。
- 协议 v2 无兼容层：两端必须同批落地，任何一端单独合入都会断链。
- Playwright 截图基建为本次新引入，环境搭建属阶段 6 前置；若 CI 无浏览器运行时需一并处理。
