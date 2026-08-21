# `@teamgaga/richtext-host-web` 实施计划

## 状态

- 当前阶段：生命周期、事件桥、Flutter channel transport 与 embed command 已完成
- 状态：自动化接入完成；Android 焦点/滑动抖动与 iOS/Android 真机联调暂时挂起
- 目标：在 WebView 中挂载 Solid 编辑器，连接 Flutter Bridge，并将 Protocol 消息与 Core API 双向映射

## 定位

`packages/host-web` 是 WebView 宿主库，不是最终 Web App。

```text
Flutter App
    │
    │ WebView Bridge
    ▼
@teamgaga/richtext-host-web
    ├── @teamgaga/richtext-protocol
    └── @teamgaga/richtext-solid
            └── richtext-core → richtext-quill → richtext-delta

apps/webview-runtime
    ├── 默认只组合 host-web + richtext-solid editor
    └── Desktop/Web 变体可选组合 @teamgaga/richtext-solid-toolbar
```

## 职责边界

### Host Web 负责

- WebView 启动和销毁生命周期。
- 挂载/卸载 Solid UI。
- 接收、解析和校验 Flutter command。
- 将 command 调度到 Core editor/controller。
- 将 Core event 转换成 protocol event 发回 Flutter。
- 将命令结果或错误响应给 Flutter。
- 适配不同 WebView 的消息传输方式。

### Host Web 不负责

- 定义 wire schema；由 Protocol 负责。
- 定义富文本数据结构；由 Delta 负责。
- 实现编辑器业务；由 Core/Quill 负责。
- 实现 Toolbar UI；移动端由 Flutter 原生负责，Desktop/PC Web 由可选 `@teamgaga/richtext-solid-toolbar` 负责。
- 上传图片或视频；由 Flutter/业务服务负责。
- 剪贴板 / 拖放策略；由 `@teamgaga/richtext-quill` 负责（ADR 0006）。
- 决定最终 HTML、CSP、资源路径和发布方式；由 `apps/webview-runtime` 负责。

## 前置条件与已知缺口

当前 Core 已支持：

- Snapshot get/set。
- Selection get/set。
- Inline/block format。
- Emoji。
- Mention/Channel。
- Image/Video（上传仍由 Flutter/业务层负责）。
- Undo/redo 及 `canUndo` / `canRedo` 状态。
- ready/change/selection/focus/blur/state event。

当前 Core 公共 API 已提供主动 `focus()` / `blur()` 与 Mention、Channel、Image、Video、Link、Divider 插入命令，Host 可完整路由当前 Protocol 命令（现为 v2）。Host 仍不得直接操作 Quill 绕过 Core。剪贴板不经 Host、不经 Protocol。

## 设计原则

1. Host 只能依赖 Solid/Core 公共 API，不直接 import Quill；默认 Host 不依赖 Solid Toolbar。
2. 所有入站消息先经 Protocol decoder 校验，再进入 dispatcher。
3. Bridge transport 与编辑器调度分离，测试不依赖真实 Flutter WebView。
4. 一条 command 必须产生一条关联 response，即使执行失败。
5. Editor 未 ready 时不得静默丢弃 command。
6. `destroy()` 必须幂等，并清理 DOM、Bridge 和 Editor listeners。
7. WebView 全局对象只允许出现在 transport adapter，不扩散到业务代码。
8. Host 不缓存正文副本；Snapshot 真源仍是 Editor。

## 建议目录

```text
packages/host-web/
├── src/
│   ├── bridge/
│   │   ├── transport.ts
│   │   ├── window-message-transport.ts
│   │   └── flutter-channel-transport.ts
│   ├── dispatcher/
│   │   ├── command-dispatcher.ts
│   │   └── command-error.ts
│   ├── lifecycle/
│   │   └── create-host.ts
│   ├── ui/
│   │   └── HostApp.tsx
│   ├── types.ts
│   └── index.ts
├── tests/
│   ├── transport.test.ts
│   ├── dispatcher.test.ts
│   └── host.test.tsx
├── package.json
└── README.md

apps/webview-runtime/
├── src/main.tsx
├── src/style.css
├── index.html
└── vite.config.ts
```

## Transport 目标接口

```ts
export interface HostTransport {
  send(message: string): void | Promise<void>;
  subscribe(listener: (message: unknown) => void): () => void;
  destroy(): void;
}
```

说明：

- Transport 只搬运原始消息，不解释 command。
- `subscribe()` 的输入仍为 `unknown`，由 Protocol codec 统一处理。
- 测试使用 `MemoryTransport`，浏览器开发使用 window transport，Flutter 使用 channel transport。
- **已决策（HOST-PRE-02）**：P0 使用 `webview_flutter` `JavascriptChannel` 名称 `TgRichTextBridge`；Desktop 可后续改用 `flutter_inappwebview`，共用 inject 全局名与 `HostTransport` 形状。不写死在 Host 核心中；见 `richtext-flutter-bridge.md` 与 `apps/webview-runtime/scripts/flutter-inject-template.js`。

## Host API 目标

```ts
export interface CreateRichTextHostOptions {
  root: HTMLElement;
  transport: HostTransport;
}

export interface RichTextHost {
  readonly ready: Promise<void>;
  destroy(): void;
}

export function createRichTextHost(options: CreateRichTextHostOptions): RichTextHost;
```

测试可增加内部依赖注入，但公共 API 第一版只暴露必要参数。

## 生命周期

```text
createRichTextHost()
    │
    ├── 1. 订阅 transport，避免漏掉早期消息
    ├── 2. render Solid HostApp
    ├── 3. RichTextEditor mount Core/Quill
    ├── 4. 绑定 Core event listeners
    ├── 5. 发布 ready event
    └── 6. 开始执行 command

destroy()
    │
    ├── 停止接收入站消息
    ├── 移除 Core event listeners
    ├── 卸载 Solid root
    ├── destroy editor/controller
    └── destroy transport
```

ready 前收到的 command 采用以下 MVP 规则：

- 暂存到有界 FIFO 队列。
- ready 后按接收顺序执行。
- 队列达到上限后返回 `editor_not_ready`，防止无限增长。
- Host 已 destroy 时拒绝新命令。

## Command 映射

| Protocol command       | Host 行为                             |
| ---------------------- | ------------------------------------- |
| `set_snapshot`         | `editor.setSnapshot(snapshot)`        |
| `get_snapshot`         | `editor.getSnapshot()`                |
| `set_selection`        | `editor.setSelection(selection)`      |
| `get_selection`        | `editor.getSelection()`               |
| `toggle_inline_format` | 映射到 `editor.commands.toggle*()`    |
| `toggle_block_format`  | 映射到 Header/List/Blockquote command |
| `insert_emoji`         | `editor.commands.insertEmoji(id)`     |
| `undo`                 | `editor.history.undo()`               |
| `redo`                 | `editor.history.redo()`               |
| `focus`                | `editor.focus()`                      |
| `blur`                 | `editor.blur()`                       |

Dispatcher 使用穷尽 `switch`，不得通过动态方法名调用 Editor。该 switch 同时是 Protocol wire contract 与 Core domain contract 的显式映射边界；Flutter Toolbar 和 Solid Toolbar 共享 Core 命令语义，但不共享 UI，也不让本地 Toolbar 经过 Protocol JSON 往返。

## Event 映射

| Core event         | Protocol event                                 |
| ------------------ | ---------------------------------------------- |
| `ready`            | 不直接转发；由 Host lifecycle 唯一生成 `ready` |
| `change`           | `change`，payload 包含最新 snapshot            |
| `selection-change` | `selection_change`                             |
| `focus`            | `focus`                                        |
| `blur`             | `blur`                                         |
| `state-change`     | `state_change`                                 |

事件策略：

- `change` 在事件发生时读取一次 `editor.getSnapshot()`。
- 不在 Solid signal 中保存正文。
- MVP 不节流；若真实设备出现高频 Bridge 压力，再基于测量增加合并策略。
- 事件发送失败不能破坏 Editor 内部状态，但应交给可注入的错误处理器记录。

## 实施步骤

### 1. 整理 package 元数据

修改：

```text
packages/host-web/package.json
packages/host-web/README.md
packages/host-web/vite.config.ts
packages/host-web/tsconfig.json
```

工作内容：

- 包名改为 `@teamgaga/richtext-host-web`。
- 添加 Protocol、Solid、SolidJS 相关 workspace/runtime dependencies。
- 配置 TSX/Solid 构建与 happy-dom 测试。
- 删除 starter API。

验收：

- Host 不直接依赖 `@teamgaga/richtext-quill` 或 `@teamgaga/richtext-solid-toolbar`。

### 2. 实现 Transport 抽象

新增：

```text
src/bridge/transport.ts
src/bridge/window-message-transport.ts
src/bridge/flutter-channel-transport.ts
```

工作内容：

- 定义 transport 生命周期。
- 实现浏览器调试 transport。
- 在确认 Flutter 插件后实现对应 channel transport。
- 对全局 channel 缺失给出明确启动错误。

验收：

- Dispatcher 测试可完全使用内存 transport。
- 多次 destroy 不抛错、不残留 listener。

### 3. 实现 Command Dispatcher

新增：

```text
src/dispatcher/command-dispatcher.ts
src/dispatcher/command-error.ts
```

工作内容：

- 只接收 Protocol 已解析的 command。
- 将 command 显式映射到 Core API。
- 返回类型正确的 success response。
- 将校验错误、未支持命令和执行异常映射为 failure response。
- 不向 Flutter 暴露 JS stack trace。

验收：

- 每条 command 恰好产生一条 response。
- Dispatcher 不访问 DOM、window 或 Flutter 全局对象。

### 4. 实现 Solid Host UI

新增：

```text
src/ui/HostApp.tsx
```

工作内容：

- 创建 `SolidRichTextController`。
- 使用 `RichTextProvider` 和 `RichTextEditor` 挂载正文。
- HostApp 只挂载编辑器，不内置 Toolbar option；移动 WebView 由 Flutter 原生 Toolbar 控制。
- Desktop/PC Web Toolbar 由 `apps/*` 组合层显式引入 `@teamgaga/richtext-solid-toolbar`，避免进入默认移动 bundle。
- 将 controller/editor ready 状态回传生命周期层。

验收：

- UI 不包含 Bridge 解析或 command switch。
- 卸载 Solid root 会销毁 Editor。

### 5. 实现 Host 生命周期

新增：

```text
src/lifecycle/create-host.ts
src/types.ts
```

工作内容：

- 串联 transport、Protocol decoder、dispatcher 和 Solid mount。
- 实现 ready 前有界队列。
- 订阅 Core events 并发送 Protocol events。
- 实现幂等 destroy 与失败回滚。

验收：

- mount 中途失败时不会留下 transport 或 DOM listener。
- destroy 后不会继续发送 editor event。
- 同一个 root 不允许重复创建活动 Host。

### 6. 整理公共导出

修改：

```text
src/index.ts
```

仅导出：

- `createRichTextHost`
- `RichTextHost`
- `CreateRichTextHostOptions`
- `HostTransport`
- 官方 transport factories

Dispatcher 和 UI 内部实现不作为公共 API。

### 7. 接入 `apps/webview-runtime`

修改：

```text
apps/webview-runtime/package.json
apps/webview-runtime/src/main.tsx
apps/webview-runtime/src/style.css
apps/webview-runtime/vite.config.ts
```

工作内容：

- 将当前 Vite starter 页面替换为 WebView Runtime。
- 创建 root 和 Flutter transport。
- 调用 `createRichTextHost()`。
- 引入 Solid editor CSS。
- 配置移动端 viewport、全高布局和生产构建。
- 开发模式允许切换到 window/memory transport 调试。

验收：

- `vp run webview-runtime#build` 生成可被 Flutter WebView 加载的静态资源。
- 生产 bundle 不包含调试页面和 fake transport。

### 8. 自动化测试

Transport：

- 入站消息订阅与取消。
- 出站 JSON 发送。
- channel 缺失。
- destroy 幂等。

Dispatcher：

- 所有 MVP command 映射。
- get command 返回正确 value。
- Core 抛错时返回 `command_failed`。
- 未支持 command 不触碰 Editor。

Host 集成：

- mount 后只发送一次 ready。
- ready 前 command 按顺序执行。
- change event 带最新 snapshot。
- selection/focus/blur/state 正确映射。
- 非法消息返回失败且 Host 保持可用。
- destroy 清理 transport、Solid 和 Editor listeners。
- 使用 `@teamgaga/richtext-testing` 的 `MockEditorAdapter` 隔离 Quill。
- 不安装/不启用 Solid Toolbar 时 Host 仍可构建运行，默认 WebView bundle 不包含 Toolbar 代码。

### 9. Flutter WebView 联调

必须人工验证：

1. Flutter 加载 Runtime bundle。
2. Web 发送 `ready`。
3. Flutter `set_snapshot` 后正文正确显示。
4. Flutter `get_snapshot` 收到关联 response。
5. Flutter 设置 Selection 并执行格式命令。
6. Web 输入触发 `change`。
7. focus/blur/selection event 正确。
8. 页面销毁后不再收到事件。
9. iOS 与 Android 都验证中文输入法、Emoji 和返回键行为。

## Todo List

### Prerequisite

- [x] `HOST-PRE-01` 完成 Protocol v1 TypeScript 契约。
- [x] `HOST-PRE-02` 确认 Flutter WebView 插件及 JS Bridge API（P0：`webview_flutter` + `TgRichTextBridge`；见 `richtext-flutter-bridge.md`）。
- [x] `HOST-PRE-03` 在 Core/Quill 增加主动 focus/blur API。

### Package

- [x] `HOST-01` 更新 package 名称、依赖和构建配置（Core/Protocol 已完成；Solid 依赖在 HostApp 阶段加入）。
- [x] `HOST-02` 重写 README。

### Bridge

- [x] `HOST-03` 定义 `HostTransport`。
- [x] `HOST-04` 实现 window transport。
- [x] `HOST-05` 实现 Flutter channel transport（`webview_flutter` + `TgRichTextBridge`）。
- [x] `HOST-06` 增加 memory transport 测试工具。

### Dispatcher

- [x] `HOST-07` 实现 command dispatcher。
- [x] `HOST-08` 实现 success/failure response。
- [x] `HOST-09` 增加 command 穷尽检查。

### Lifecycle

- [x] `HOST-10` 实现 Solid HostApp。
- [x] `HOST-11` 实现 `createRichTextHost()`。
- [x] `HOST-12` 实现 ready 前有界队列。
- [x] `HOST-13` 实现 Core → Protocol event bridge。
- [x] `HOST-14` 实现幂等 destroy 和失败回滚。

### Runtime App

- [x] `HOST-15` 替换 `apps/webview-runtime` starter。
- [x] `HOST-16` 配置 WebView 生产构建。
- [x] `HOST-17` 增加开发模式 transport。

### Validation

- [x] `VERIFY-01` 运行 `vp install`。
- [x] `VERIFY-02` 运行 `vp check`。
- [x] `VERIFY-03` 运行 `vp test`。
- [x] `VERIFY-04` 运行 `vp run -r build`。
- [x] `VERIFY-05` 确认 Host 没有直接访问 Quill。
- [ ] `VERIFY-06` 完成 iOS/Android Flutter WebView 人工联调。

## 完成定义

满足以下条件后，Host Web MVP 完成：

- Flutter command 能通过 Protocol 安全映射到 Core editor。
- 每个请求都有可关联的成功或失败响应。
- Core 事件能稳定发送给 Flutter。
- Host 不直接依赖或操作 Quill。
- Transport、dispatcher、UI 和生命周期边界清晰且可独立测试。
- destroy 后不存在 DOM、Bridge 或 Editor listener 泄漏。
- `apps/webview-runtime` 可构建为 Flutter WebView 静态资源。
- 自动化测试、全仓 check/build 及 iOS/Android 人工联调全部通过。
