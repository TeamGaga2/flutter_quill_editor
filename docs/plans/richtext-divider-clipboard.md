# 正文分隔线剪贴板传输实施计划

## 文档状态

- 日期：2026-08-24
- 状态：grilling 决策已确认（见 `docs/adr/0007-divider-clipboard-transfer.md`），本计划固化实施细节
- 涉及仓库：`flutter_quill_editor`（`packages/quill` 为主；webview-runtime 与 clients/flutter_quill_editor 随构建同步）
- 术语：`CONTEXT.md`（正文分隔线、顶层内容块、工具栏分隔线、正文媒体）
- 关联决策：ADR 0005（宿主媒体选择器）、ADR 0006（内联嵌入剪贴板）、ADR 0007（正文分隔线剪贴板）

## 背景与目标

ADR 0006 实现了内联嵌入（提及、频道引用、表情）的剪贴板往返，但当时正文分隔线（`<hr class="tgg-divider">`）与正文媒体一同被列入剔除白名单。用户在移动或复制包含分隔线的内容时，分隔线会被抹掉。

目标：复制、剪切、粘贴、拖放到光标放行正文分隔线；正文媒体（图片、视频）继续剔除并维持媒体隔离。

## 已确认决策

| 项               | 决定                                                                                   |
| ---------------- | -------------------------------------------------------------------------------------- |
| 操作集合         | 复制、剪切、粘贴、拖到光标，同一套契约                                                 |
| 载体             | 系统剪贴板 `text/html` 往返；`text/plain` 给人读降级                                   |
| 复制 HTML        | `<hr class="tgg-divider">`，不被 `rewriteCopyHtml` 剥离                                |
| 纯文本降级       | `extractPlainText` 遇到 `{ divider: "true" }` 输出 `---\n`                             |
| 粘贴 HTML 预处理 | `stripPasteHtml` 放行 `<hr>` 节点（包括外源 `<hr>` 和自产 `<hr class="tgg-divider">`） |
| 粘贴 Delta 校验  | `stripEmbeds` 白名单放行 `{ divider: "true" }`（容忍字符串 `"true"` 或布尔 `true`）    |
| 纯文本粘贴       | 纯文本中的 `---` / `***` 不升格，依然作为普通文字粘贴                                  |
| 剪切语义         | 选区含分隔线时，文档内删除该分隔线，剪贴板带走并在粘贴时能完整还原                     |
| 媒体隔离         | 图片、视频继续剔除，剪切带图选区依然丢图，媒体隔离边界不受影响                         |

## 实施步骤

### 阶段 1 核心代码实现（`packages/quill/src/clipboard/clipboard-policy.ts`）

- [x] `rewriteCopyHtml(html: string)`：选择器中移除 `hr, .tgg-divider`，仅删除 `img, .tgg-image, video, .tgg-video`。
- [x] `stripPasteHtml(html: string)`：选择器中移除 `hr, .tgg-divider`，仅删除 `img, .tgg-image, video, .tgg-video`。
- [x] `extractPlainText(delta: Delta)`：处理 `"divider" in op.insert`，输出 `---\n`。
- [x] `stripEmbeds(delta: Delta)`：处理 `"divider" in op.insert`，若值为 `"true"` 或 `true` 则放行 `{ divider: "true" }`。

### 阶段 2 测试覆盖（`packages/quill/tests/`）

- [x] `clipboard-strip-embeds.test.ts`：
  - `stripEmbeds`：保留 `{ divider: "true" }`，继续剥离媒体 `{ image: ... }` / `{ video: ... }`。
  - `extractPlainText`：输出 `---\n`。
  - `rewriteCopyHtml`：保留 `<hr class="tgg-divider">`，删除 `img` / `video`。
  - `stripPasteHtml`：保留 `<hr>` / `<hr class="tgg-divider">`，删除 `img` / `video`。
- [x] `clipboard-paste-drop.test.ts`：
  - 复制含分隔线的选区：`text/plain` 包含 `---`，`text/html` 包含 `<hr class="tgg-divider">`。
  - 剪切含分隔线的选区：文档中分隔线被删除，剪贴板包含分隔线。
  - 粘贴自产 HTML / 外源 `<hr>`：正确生成 `{ divider: "true" }` 顶层内容块。
  - 粘贴纯文本 `---`：保持为普通文字 `---`，不升格为实体。
  - 拖放含 `<hr>` 的 HTML：正常插入分隔线。
  - 混合正文媒体与分隔线：媒体被剥离，分隔线与文本/内联嵌入留下。

### 阶段 3 验证与构建

- [x] `vp check` 与 `vp test` 全量通过。
- [x] `vp run -r build` 构建最新包及 webview-runtime。
- [x] `clients/flutter_quill_editor` 同步最新构建产物并运行 `flutter test`。

## 完成定义

- 分隔线在编辑器内复制、剪切、粘贴、拖放到光标后完整往返为 `{ insert: { divider: "true" } }`。
- 外源标准 `<hr>` 粘贴到编辑器能转换为正文分隔线。
- 纯文本 `---` 不做自动推断升格。
- 媒体（图片、视频）隔离策略不受影响。
