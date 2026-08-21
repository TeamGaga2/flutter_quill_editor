# `@teamgaga/richtext-solid-toolbar` 可选 Desktop Toolbar 计划

## 状态

- 当前阶段：Toolbar 从 `@teamgaga/richtext-solid` 拆包
- 状态：源码迁移与自动化验证完成，待人工交互验证
- 目标：让 Solid 编辑器运行时不再内置产品 UI，同时保留 Desktop/PC Web Toolbar 闭环

## 架构决策

移动端 iOS/Android 的 Toolbar、EmojiPicker、Mention Selector、Image Picker 和上传流程由 Flutter 原生实现。Windows、macOS 和 PC Web 可按需安装 Solid Toolbar。

```text
Flutter native Toolbar
  -> Protocol wire command
  -> host-web dispatcher
  -> Core command/state contract
  -> Quill adapter

Optional Solid Toolbar
  -> Solid controller/context
  -> Core command/state contract
  -> Quill adapter
```

共享的是 Command、State、Protocol 和 Delta；不共享 Button、Popup、Picker 或 Layout。

## 包职责

### `@teamgaga/richtext-solid`

只负责：

- `RichTextEditor`
- `RichTextProvider` / `useRichText`
- controller、生命周期和 editor state hooks
- Quill editor-area runtime 与样式

不得包含或重新导出 Toolbar、ToolbarButton、Picker、Menu、Popover。

### `@teamgaga/richtext-solid-toolbar`

只负责可选 Desktop/PC Web UI：

- `RichTextToolbar`
- `ToolbarButton`
- `useToolbarState`
- 后续按需增加 Desktop menus/popovers/pickers

允许依赖 Solid 和 Core 公共 API；不得直接访问 Quill。

## 目标目录

```text
packages/solid/
└── src/
    ├── components/RichTextEditor.tsx
    ├── context/
    ├── hooks/
    ├── adapters/
    └── styles/

packages/solid-toolbar/
└── src/
    ├── components/
    │   ├── RichTextToolbar.tsx
    │   └── ToolbarButton.tsx
    ├── hooks/useToolbarState.ts
    └── index.ts
```

## 使用方式

```tsx
import { createRichTextEditor, RichTextEditor, RichTextProvider } from "@teamgaga/richtext-solid";
import { RichTextToolbar } from "@teamgaga/richtext-solid-toolbar";

const editor = createRichTextEditor();

<RichTextProvider editor={editor}>
  <RichTextToolbar />
  <RichTextEditor />
</RichTextProvider>;
```

Flutter WebView Runtime 默认只挂载 `RichTextEditor`，不安装或打包 Toolbar。

## 当前功能范围

- Bold / Italic / Underline / Strike
- H1 / H2 / H3
- Ordered List / Bullet List / Blockquote
- Undo / Redo
- active/disabled 状态派生
- pointer/mousedown selection 保留

插入操作按钮已在工具栏落地，选择器仍归宿主（ADR 0005）。不在 toolbar 内做 EmojiPicker、Mention 列表、频道列表或系统文件选择器。内联嵌入复制/粘贴见 ADR 0006。

## Todo List

### 拆包

- [x] 创建 `packages/solid-toolbar`。
- [x] 迁移 Toolbar components 与 `useToolbarState`。
- [x] 从 `@teamgaga/richtext-solid` 公共入口移除 Toolbar 导出。
- [x] 将 Toolbar 测试迁移到新包。
- [x] Playground 显式依赖并导入新包。
- [x] 更新 Solid 与根 README 的职责说明。

### Core Command System

- [x] 当前 inline/block/emoji/history 命令通过 Core 公共 API 执行。
- [x] 为 Host MVP 补齐主动 `focus` / `blur` 能力。
- [x] 在明确 embed payload 后增加 image/mention/channel/video Core 命令（Desktop UI 仍按需实现）。
- [x] 定义 `canUndo` / `canRedo` 状态语义，并纳入 Core 与 Protocol（现为 v2）。

### 可选 Desktop UI

- [ ] 根据产品需求增加 EmojiPicker、ImageButton、Mention UI。
- [ ] 上传和资源选择保持业务注入，不进入 Core。
- [ ] 完成 Windows、macOS、PC Web 人工交互验证。
- [x] 完成 Toolbar SVG 图标接入（手写 `IconBase` + `currentColor` 组件，绕开 `vite-solid-svg`/`vp pack` 不兼容；见 `ToolbarIcons.tsx`）。

### Validation

- [x] 运行 `vp install`。
- [x] 运行 `vp check`。
- [x] 运行 `vp test`。
- [x] 运行 `vp run -r build`。
- [x] 确认 Solid 不导出 Toolbar。
- [x] 确认 Toolbar 包不直接依赖 Quill。

## 完成定义

- 不安装 Toolbar 包时，`@teamgaga/richtext-solid` 可独立构建和运行。
- Flutter WebView Runtime 的默认 bundle 不包含 Desktop Toolbar。
- Desktop Toolbar 只调用 Core command/history 并读取 Core state。
- Core、Protocol、Delta 均不依赖任何 UI 包。
- 自动化检查、测试和构建通过；桌面端交互验证完成。
