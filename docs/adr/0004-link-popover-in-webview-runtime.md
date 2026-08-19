# 0004: 链接浮层移入 WebView 运行时（协议 v2）

插入链接浮层原由 Flutter 宿主实现（request_link 事件 → 宿主对话框 → insert_link 命令回写），代价是跨边界的光标锚定、pointer gate、焦点/IME 恢复机制，以及主题/文案在宿主与运行时两套维护。决定：浮层移入 WebView 运行时渲染，宿主对话框与 request_link 移除，协议升 v2、无兼容层。

1. **浮层在运行时内渲染**：组件与状态 hook 放 packages/solid，CSS 放 webview-runtime 的 style.css；桌面锚定选区（editor.getCaretRect()）、移动居中模态；颜色全部走 --tgg-* 变量，缺失 token（fill04 / text05 / schemesPrimary / schemesOutlineVariant / primary03 / primary04 / effects.primary 阴影）按 tgg_design 明暗表补齐；文案 en/zh/hi 三语逐字对照参考，locale 由 Flutter 经 **TG_RICHTEXT_CONFIG**.locale 注入、navigator 兜底。
2. **触发面**：桌面 Solid 工具栏 link 按钮本地打开；移动端 Flutter 底栏按钮经新命令 open_link_form（零载荷）触发；Cmd/Ctrl+K 由运行时内 keydown 绑定处理——Quill 默认的 Cmd+K 绑定仅 Snow 主题存在，本运行时 theme 为 undefined，必须自建。Flutter 侧对话框、快捷键与 request_link 监听一并删除。
3. **协议 v2**：移除 request_link；保留 insert_link（通用能力）；新增 Flutter→Web 命令 open_link_form；PROTOCOL_VERSION 升 2，不设 v1 兼容层（运行时资产与 Flutter 客户端同仓共发版）；golden fixtures 迁 v2、Dart 拷贝同步。
4. **应用链接不经协议往返**：浮层确认后由运行时直接执行 editor.commands.insertLink；预填/编辑扩展（原 prepareWebTextLink）迁移进运行时。

## Considered Options

- **浮层留在 Flutter 宿主、仅重样式**（否决）：双端各持一套主题/文案，跨边界锚定、pointer gate、焦点恢复的复杂度原样保留，样式无法真正 1:1。
- **浮层移入 Flutter 客户端包（clients/flutter_quill_editor）**（否决）：包需跨仓库依赖 tgg_design 与业务 l10n，破坏运行时仓库独立性。
- **快捷键由 Flutter 转发兜底**（否决）：保持宿主零编辑器 UI 边界；接受"焦点在 Flutter 底栏时 Cmd+K 无响应"的盲区，换取快捷键完全归运行时所有。

## Consequences

- teamgaga-client 删除 link_dialog/ 三文件、web_editor_host_link.dart、web_text_link.dart、两页 onRequestLink 监听/重入锁与 CallbackShortcuts；底栏 link 按钮改为发送 open_link_form。
- style.css token 表新增上述 7 项（明暗各一），沿用 ADR 0002 的 token 同步纪律；theme.css（Figma 生成物）不改。
- 协议文档事件目录需补全（现缺 title_focus / title_blur / request_link / request_close）；tooltip-i18n 设计文档「不使用 RuntimeConfig.locale」「不重构 Link request」条款作废，需修订。
- 快捷键仅编辑器聚焦时生效；Quill Snow 主题自带的 Cmd+K 绑定在本运行时不存在，勿依赖。
