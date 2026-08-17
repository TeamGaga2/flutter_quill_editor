# `@teamgaga/richtext-host-web` 生命周期与事件桥实施计划

## 状态

- 当前阶段：已完成（含浏览器开发闭环 VERIFY-06）
- 父计划：`docs/plans/richtext-host-web.md`
- 目标：在现有 Transport 与 Protocol → Core Dispatcher 基础上，完成可测试、可销毁、与 Flutter 插件无关的 WebView Host 生命周期闭环
- 本阶段对应父计划：`HOST-01`、`HOST-10`～`HOST-17` 中不依赖具体 Flutter 插件的部分

## 已完成基线

本计划不重复实现以下能力：

- Protocol v1 schema、guards、codec 和共享 fixtures。
- Core/Quill `focus()`、`blur()`、`canUndo`、`canRedo`。
- `HostTransport`。
- 安全的 Window transport。
- Memory transport 测试工具。
- Protocol v1 → Core command dispatcher。
- success/failure response 与 command 穷尽测试。

## 本阶段范围

### 必须完成

1. Solid `HostApp`，只挂载编辑区域，不包含 Toolbar。
2. `createRichTextHost()` 生命周期入口。
3. ready 前有界 FIFO command 队列。
4. Core event → Protocol event bridge。
5. 出站消息有序发送和统一错误处理。
6. 幂等 destroy、初始化失败回滚、重复 root 防护。
7. `apps/webview-runtime` 的编辑器壳、开发 transport 和生产构建基础。
8. 完整自动化测试与文档更新。

### 本阶段不实现

- 具体 Flutter channel transport。
- Flutter/Dart model 和 golden test。
- iOS/Android WebView 人工联调。
- Solid Toolbar、EmojiPicker、Mention UI、Image Picker。
- 图片/视频上传。
- command/event 节流；没有真实设备数据前不提前优化。
- 多编辑器实例路由协议。

## 架构

```text
apps/webview-runtime
        │
        ▼
createRichTextHost(root, transport)
        │
        ├── inbound raw message
        │      └── Protocol parse/decode
        │             └── ready queue
        │                    └── command dispatcher
        │                           └── Core editor
        │
        ├── Solid HostApp
        │      └── RichTextProvider
        │             └── RichTextEditor
        │
        └── Core events
               └── Protocol events
                      └── ordered outbound transport
```

依赖方向：

```text
host-web
├── richtext-protocol
├── richtext-core
├── richtext-solid
└── solid-js

host-web 不直接依赖：
├── richtext-quill
└── richtext-solid-toolbar
```

## 冻结的生命周期语义

### Editor Ready

Core `ready` 在 `controller.mount()` 内、Solid controller signal 更新前同步发出，Host 无法可靠地提前订阅。因此本阶段采用：

- HostApp 观察 `controller.editor()` 首次出现。
- Editor 出现即视为 Host ready。
- Host 自己发送且只发送一次 Protocol `ready` event。
- 不转发 Core `ready`，避免重复 ready。
- 绑定所有 Core event listeners 后，才发送 Protocol `ready`。

### 状态机与 ready 前 command

Host 生命周期固定为：

```text
mounting → draining → ready → destroyed
    └──────────────→ failed
```

- outbound queue、入站 handler 和初始 `mounting` 状态必须先创建，再调用 `transport.subscribe()`；允许 transport 在 subscribe 内同步投递消息。
- `mounting` / `draining` 收到的合法 command 都追加到同一个 FIFO。
- 默认最大队列长度：`64`，允许通过 Host option 调整为正整数。
- Editor ready 后先绑定 event bridge，再将 Protocol ready 放入 outbound queue，然后进入 `draining`。
- draining 必须持续到 FIFO 真正为空；期间新到 command 继续追加队尾，不能插队或滞留。
- FIFO 为空后原子切换为 `ready`；此后 command 直接执行。
- 队列满时立即为该 request id 入队 `editor_not_ready` failure。
- 初始化失败或普通 destroy 会丢弃尚未执行的 pending command；exactly-one response 只保证 Host 仍处于 `draining` / `ready` 且 command 已被接受执行的情况。
- destroy 后不再接收入站消息，也不发送新的 command response。

### 非法入站消息

Protocol failure response 必须有可信 request id，因此：

- 仅当原始 `kind` 明确为 `command` 且 id 可安全提取时，非法 command 才返回对应 validation failure。
- 任何入站 event/response 只调用 `onError`，绝不回复，避免两个错误对称端形成响应回路。
- 非法 JSON、非字符串、缺失 id 或未知 kind：调用 `onError`，不伪造 request id，不发送不可关联 response。
- Host 必须保持可用，单条非法消息不能破坏后续 command。
- 不向边界暴露 JS stack、DOM 内容或原始异常对象。

实现前应增加一个内部 helper，集中执行“可否安全提取 request id”的判断，不能在 lifecycle 中散落强制类型断言。

### 出站顺序与关闭策略

`HostTransport.send()` 允许返回 Promise，因此 Host 使用单一 outbound queue：

- 所有 response/event 按入队顺序发送。
- 单次 send 失败进入 `onError`，但不能打断后续发送。
- Core command 同步触发的 event 会先于该 command response 入队；v1 固定保留这个真实执行顺序。
- queue 必须区分 pending 与 in-flight send。
- 普通 destroy 立即停止接收新消息并丢弃尚未开始的 pending outbound item；此场景不保证 exactly-one response。
- 已进入 transport 的 in-flight send 不等待完成，也不重试；其迟到 resolve/reject 只能被安全吸收，不得产生 unhandled rejection 或重新激活 Host。
- 初始化失败不承诺向 ready 前 pending command 发送 failure；统一 reject `host.ready`、报告净化错误并清理资源。

### Ready Promise

- `host.ready` 只允许结算一次。
- mount/初始化失败以及 ready 前 destroy 都以净化后的 Host error reject。
- `editorReady` 的所有 continuation 首先检查 lifecycle state/token；迟到 resolve 不得绑定 listener、发送 ready 或执行 command。
- ready 后 destroy 不改变已经 resolved 的 Promise。

### Destroy 与失败回滚

清理使用 best-effort cleanup stack，每一步独立捕获异常：

1. 标记 Host `destroyed` 或 `failed`。
2. 取消 transport 入站订阅。
3. 清空 ready command FIFO，并关闭 outbound queue、丢弃 pending item。
4. 移除 Core event listeners。
5. dispose Solid root；由 `RichTextEditor` cleanup 销毁 controller/editor。
6. destroy transport。
7. 在最外层 `finally` 从 active-root registry 移除 root。

`onError` 自身也必须通过 safe-call 调用，不能阻断清理。`destroy()` 必须幂等；unsubscribe、dispose、transport.destroy 或 onError 任一抛错时，其余清理仍必须执行。

### Root 所有权

- 使用模块级 `WeakMap<HTMLElement, RichTextHost>` 记录活动 Host。
- 同一 root 已存在活动 Host 时，第二次创建必须同步失败。
- 初始化失败与正常 destroy 都必须释放 registry。
- 不在 root DOM attribute 上存储内部实例。

## 目标 API

```ts
export interface CreateRichTextHostOptions {
  root: HTMLElement;
  transport: HostTransport;
  maxPendingCommands?: number;
  onError?: (error: RichTextHostError) => void;
}

export interface RichTextHost {
  readonly ready: Promise<void>;
  destroy(): void;
}

export interface RichTextHostError {
  phase: "decode" | "dispatch" | "event" | "send" | "mount" | "destroy";
  code: string;
  message: string;
}

export function createRichTextHost(options: CreateRichTextHostOptions): RichTextHost;
```

约束：

- `onError` 只接收净化后的稳定错误，不接收裸 `unknown` 或 stack。
- 第一版不公开 controller/editor，避免 Host API 变成绕过 Protocol 的业务入口。
- 测试依赖注入放在内部 `mountHostApp` 边界，不扩张公共 API。

## 目标目录

```text
packages/host-web/src/
├── bridge/
│   ├── transport.ts
│   ├── window-message-transport.ts
│   ├── memory-transport.ts
│   └── inbound-message.ts
├── dispatcher/
│   └── command-dispatcher.ts
├── events/
│   └── editor-event-bridge.ts
├── lifecycle/
│   ├── create-host.ts
│   ├── outbound-queue.ts
│   └── root-registry.ts
├── ui/
│   ├── HostApp.tsx
│   └── mount-host-app.tsx
├── errors.ts
├── types.ts
└── index.ts

packages/host-web/tests/
├── transport.test.ts
├── dispatcher.test.ts
├── inbound-message.test.ts
├── event-bridge.test.ts
├── host-lifecycle.test.tsx
└── package.test.ts
```

## 实施步骤

### 1. 完成 Package/Solid 构建配置

修改：

```text
packages/host-web/package.json
packages/host-web/tsconfig.json
packages/host-web/vite.config.ts
```

工作内容：

- 增加 `@teamgaga/richtext-solid` runtime dependency。
- 增加 `solid-js` peer + dev dependency。
- 增加 `vite-plugin-solid` 和 `happy-dom` dev dependency。
- Vite+ pack/test 配置启用 Solid TSX 与 happy-dom。
- 保持 Core、Protocol 为直接依赖。
- 禁止增加 Quill 和 Solid Toolbar 直接依赖。

验收：

- Host TSX 可构建 declaration。
- package dependency test 明确锁定依赖边界。
- 不安装 Toolbar 包时 Host 能构建和测试。

### 2. 实现 HostApp 与 Mount Boundary

新增：

```text
src/ui/HostApp.tsx
src/ui/mount-host-app.tsx
```

职责：

- 创建一个 `SolidRichTextController`。
- 使用 `RichTextProvider` + `RichTextEditor`。
- 通过一次性 callback 返回已 mount 的 Core editor。
- 不读取/解析 Bridge 消息。
- 不渲染 Toolbar、Picker、菜单或调试 UI。

`mountHostApp()` 返回：

```ts
interface MountedHostApp {
  readonly editorReady: Promise<RichTextEditor>;
  dispose(): void;
}
```

验收：

- callback/promise 只 resolve 一次。
- dispose 多次安全。
- mount 失败会清理 Host 已成功取得所有权的资源，并清空 root DOM。
- adapter/Quill 构造中途抛错时无法保证清理其内部未返回资源；若实现发现真实泄漏，先修复 adapter factory 的异常安全再继续 lifecycle。
- Editor DOM root 可通过 class/aria-label 定位，但不泄漏内部实例。

### 3. 实现入站消息处理

新增：

```text
src/bridge/inbound-message.ts
```

工作内容：

- 仅接受包含 JSON 的 JS string；字节编码已在 transport 边界之外，不在 Host 中判断 UTF-8。
- 使用 `decodeProtocolMessage()`。
- 只允许 `kind: "command"` 进入 dispatcher。
- event/response 作为非法入站方向处理。
- 实现安全 request id 提取。
- 将 decode/validation 问题转换为净化 Host error 或可关联 failure response。

验收：

- 任意 unknown 输入不抛出未捕获异常。
- 非字符串、非法 JSON、未知 kind 后下一条合法 command 仍可执行。
- 不通过 `as EditorCommandMessage` 绕过 Protocol guard。

### 4. 实现 Core Event Bridge

新增：

```text
src/events/editor-event-bridge.ts
```

映射：

| Core event         | Protocol event payload               |
| ------------------ | ------------------------------------ |
| `change`           | `{ snapshot: editor.getSnapshot() }` |
| `selection-change` | `{ selection }`                      |
| `focus`            | `{}`                                 |
| `blur`             | `{}`                                 |
| `state-change`     | `{ state }`，包含 `canUndo/canRedo`  |

规则：

- `ready` 由 Host lifecycle 单独发送，不在 bridge 中订阅。
- 每个 Core event 创建新的 Protocol object，不复用可变对象。
- `change` 只读取一次 snapshot。
- event 使用 Protocol encoder 后才交给 transport。
- editor 读取或 encode 失败时进入 `onError`，不能中断编辑器。

验收：

- 所有 event 均可被 `decodeProtocolMessage()` round-trip。
- `state_change` 严格携带 `canUndo/canRedo`。
- unsubscribe 后不再产生出站消息。

### 5. 实现 Outbound Queue

新增：

```text
src/lifecycle/outbound-queue.ts
```

工作内容：

- 串行化同步/异步 `transport.send()`。
- 显式跟踪 pending 与 in-flight item。
- 捕获 sync throw 与 rejected Promise。
- 某次失败不阻塞后续消息。
- close 后拒绝新增消息并丢弃尚未开始的 pending item。
- in-flight send 的迟到结果只能被吸收，不触发新工作。

验收：

- 慢 Promise transport 下仍保持顺序。
- 第一条失败后第二条仍发送。
- close 会丢弃 pending、保留 in-flight 的安全收尾。
- 不产生 unhandled rejection。

### 6. 实现 `createRichTextHost()`

新增：

```text
src/lifecycle/create-host.ts
src/lifecycle/root-registry.ts
src/types.ts
src/errors.ts
```

初始化顺序：

1. 校验 options 和 root registry，写入 `mounting` 状态。
2. 创建 outbound queue、command FIFO、入站 handler 和 cleanup stack。
3. 订阅 transport；同步投递的 command 已可安全排队或响应 overflow。
4. mount HostApp。
5. 等待 editorReady；continuation 先检查 lifecycle token/state。
6. 绑定 Core event bridge。
7. 将一次 Protocol ready 放入 outbound queue。
8. 切换为 `draining`，持续执行 FIFO 直到为空。
9. 原子切换为 `ready` 并 resolve `host.ready`。

验收：

- subscribe 同步投递不会访问未初始化对象。
- mounting/draining 阶段 command FIFO 且不会滞留或插队。
- 队列上限可测。
- Host 活动期间每个已接受执行的 command 恰好一个 response。
- 同一 root 重复创建失败。
- mount reject、ready 前 destroy、editorReady 迟到 resolve 均有确定结果。
- 任意初始化步骤失败都会 best-effort 完整回滚并最终释放 registry。
- destroy 前后没有 listener、DOM 或 registry 泄漏。

### 7. 整理公共导出

修改：

```text
src/index.ts
README.md
```

公共导出仅包括：

- `createRichTextHost`
- `RichTextHost`
- `CreateRichTextHostOptions`
- `RichTextHostError`
- `HostTransport`
- `createWindowMessageTransport`
- `WindowMessageTransportOptions`

不导出：

- Dispatcher
- HostApp
- MemoryTransport
- queue/registry/internal error helpers

### 8. 接入 `apps/webview-runtime`

修改：

```text
apps/webview-runtime/package.json
apps/webview-runtime/src/main.tsx
apps/webview-runtime/src/style.css
apps/webview-runtime/index.html
apps/webview-runtime/vite.config.ts
```

本阶段实现：

- 移除 Vite starter UI。
- 创建全高 editor root。
- 引入 `@teamgaga/richtext-solid/style.css`。
- 配置移动端 viewport、安全区和输入区域布局。
- 开发模式提供明确的 Window transport bootstrap。
- 生产模式只提供可构建壳；Flutter transport 未注入时必须 fail-fast，不创建一个无法通信的 Host。
- 生产 bundle 不包含 MemoryTransport、Toolbar 或 fake command panel。

阻塞说明：

- 未确认 Flutter 插件前，不伪造 production Flutter channel。
- Runtime production bootstrap 留出一个小而明确的 transport factory 边界；不能在业务代码中探测多个 Flutter 全局对象。
- 真正可通信的 production bootstrap 与设备联调属于 Flutter adapter 后续阶段，不计入本阶段 DoD。

验收：

- `vp run webview-runtime#build` 通过。
- bundle 不包含 `richtext-solid-toolbar`。
- 开发 iframe/window 场景可以收到 ready、发送 command、收到 response/event。
- production transport 缺失时错误明确且不遗留半初始化 DOM/Host。

## 测试矩阵

### HostApp

- mount 后得到一个 Core editor。
- DOM 中只有 editor，不含 toolbar。
- dispose 销毁 editor/controller。
- mount 失败回滚。

### Inbound

- 合法 JSON command。
- 非字符串。
- 非法 JSON。
- event/response 反向输入只报告错误、不发送 response。
- 非法 payload 且有 id。
- 缺失/空 id。
- 连续非法消息后合法消息。

### Ready Queue

- render 前 command 不丢失。
- FIFO drain。
- 默认/自定义上限。
- overflow `editor_not_ready`。
- subscribe 内同步投递 command。
- draining 期间持续追加 command，不滞留、不插队。
- 初始化失败清空 pending，不承诺 response。
- destroy 前后行为。

### Dispatcher Integration

- Protocol fixture 中每类 command 恰好一个 response。
- focus/blur。
- undo/redo 与 `canUndo/canRedo` state event。
- Core throw → `command_failed`，不泄漏内部错误。

### Event Bridge

- change snapshot。
- selection nullable。
- focus/blur。
- state formats + history availability。
- unsubscribe/destroy 后静默。

### Outbound

- sync transport。
- async transport 顺序。
- send throw/reject 后恢复。
- close 时 pending 丢弃、in-flight 安全收尾。
- 无 unhandled rejection。

### Lifecycle

- ready 只发送一次。
- ready 前 destroy 会 reject；editorReady 迟到 resolve 无副作用。
- 同 root 重复创建。
- destroy 幂等。
- transport subscribe/render/event bind 各阶段失败回滚。
- unsubscribe、dispose、transport.destroy、onError 分别抛错时仍完成其余清理。
- active root 可在 destroy 后重新创建。

### Package/Bundle

- Host 无 Quill/Solid Toolbar 直接依赖。
- Runtime 无 Toolbar/MemoryTransport 生产代码。
- 全仓 check/test/build。

## Todo List

### Package/UI

- [x] `LIFE-01` 完成 Solid package、peer 和构建配置。
- [x] `LIFE-02` 实现 `HostApp`。
- [x] `LIFE-03` 实现 `mountHostApp()` 与 editorReady。
- [x] `LIFE-04` 增加 HostApp mount/dispose/rollback 测试。

### Inbound/Outbound

- [x] `LIFE-05` 实现入站 decode 与方向校验。
- [x] `LIFE-06` 实现安全 request id 提取和 validation failure 策略。
- [x] `LIFE-07` 实现串行 outbound queue。
- [x] `LIFE-08` 覆盖非法输入、反向消息无响应回路与 async send 测试。

### Event Bridge

- [x] `LIFE-09` 实现 Core → Protocol event bridge。
- [x] `LIFE-10` 覆盖所有 event 与 `canUndo/canRedo`。
- [x] `LIFE-11` 确认 ready 仅由 lifecycle 发送一次。

### Lifecycle

- [x] `LIFE-12` 实现 active-root registry。
- [x] `LIFE-13` 实现 `mounting → draining → ready → destroyed/failed` 状态机与 `createRichTextHost()`。
- [x] `LIFE-14` 实现默认 64 条 ready FIFO、持续 drain 及 overflow response。
- [x] `LIFE-15` 实现幂等 destroy 与 outbound pending/in-flight 关闭语义。
- [x] `LIFE-16` 实现 cleanup stack、safe onError 和逐阶段失败回滚。
- [x] `LIFE-17` 覆盖同步 subscribe、late editorReady、异常清理的完整 lifecycle 测试。

### Public API/Runtime

- [x] `LIFE-18` 整理公共导出和 Host README。
- [x] `LIFE-19` 替换 `apps/webview-runtime` starter。
- [x] `LIFE-20` 配置移动端布局和生产构建。
- [x] `LIFE-21` 增加 Window transport 开发联调入口。
- [x] `LIFE-22` 验证生产 bundle 不包含 Toolbar/MemoryTransport。

### Validation

- [x] `VERIFY-01` 运行 `vp install`。
- [x] `VERIFY-02` 运行 `vp check`。
- [x] `VERIFY-03` 运行全仓测试。
- [x] `VERIFY-04` 运行全仓构建。
- [x] `VERIFY-05` 独立审查生命周期、消息顺序和清理行为。
- [x] `VERIFY-06` 浏览器开发模式完成 ready/command/response/event 闭环。

## 推荐实施顺序

```text
Package config
  → HostApp/mount boundary
  → inbound parser
  → event bridge
  → outbound queue
  → createRichTextHost lifecycle
  → public API
  → webview-runtime
  → browser integration verification
```

每一步先完成对应单元测试，再进入下一步；不要在 Host lifecycle 尚未稳定时实现具体 Flutter channel。

## 完成定义

满足以下条件后，本阶段完成：

- Host 在不知道 Flutter 插件的情况下完成完整生命周期闭环。
- mounting/draining 期间 command 不丢失、不乱序、不插队，队列有界。
- Host 活动期间每个已接受执行的 command 恰好一个关联 response；初始化失败或普通 destroy 丢弃的 pending command 明确豁免。
- 除 Core ready 外，其余 Core events 全部映射为可被 Protocol decoder 接受的 event；Protocol ready 仅由 lifecycle 生成一次。
- `state_change` 包含 `canUndo/canRedo`。
- 同 root 不能重复创建活动 Host。
- 初始化失败和 destroy 后不存在 transport、Core、Solid 或 DOM listener 泄漏。
- Host 不直接依赖 Quill 或 Solid Toolbar。
- Runtime 默认不包含 Toolbar、MemoryTransport 或 fake UI。
- 本阶段 Runtime 只要求可构建壳和开发 Window transport 闭环；production transport 缺失时 fail-fast。
- 全仓 check/test/build 与浏览器开发闭环验证通过。

## 后续阶段

本阶段之后再执行：

1. 确认 Flutter WebView 插件及 JS Bridge API。
2. 实现单一 Flutter channel transport adapter。
3. Flutter/Dart golden fixtures。
4. iOS/Android IME、中文输入、Emoji、返回键和销毁联调。
