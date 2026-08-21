# `@teamgaga/richtext-protocol` 实施计划

## 状态

- 当前阶段：Protocol v2 跨端实现完成（v1 fixture 保留、无兼容层）
- 状态：TypeScript / Dart schema、guards、codec、同源 golden fixtures 与 Host 映射已完成；含 Link/Divider、`open_link_form`、插入操作 `request_*`
- 目标：建立 Flutter 与 WebView Runtime 之间稳定、可版本化、可运行时校验的通信协议

## 定位

`packages/protocol` 只负责定义“跨边界双方如何说话”，不负责发送消息，也不执行编辑器操作。

这里采用双层命令契约：

- `richtext-core` 是进程内的编辑器领域 Command/State 契约，供 Solid Toolbar 和 Host 使用。
- `richtext-protocol` 是 Flutter 与 WebView 间版本化、可运行时校验的 wire Command/Event 契约。
- `richtext-host-web` 负责两者之间显式、穷尽的映射。

本地 Solid Toolbar 不经过 JSON Protocol；共享的是命令语义，不是同一个 TypeScript union。

```text
Flutter SDK
    │
    │ JSON message
    ▼
@teamgaga/richtext-protocol
    ▲
    │ JSON message
    │
host-web
```

## 设计原则

1. Wire format 使用 JSON 可序列化数据，不传递函数、DOM、Class 实例或 `undefined`。
2. Wire type 使用稳定的 `snake_case` 字符串，避免 Dart 与 TypeScript 命名差异造成协议漂移。
3. 所有请求必须带 `id`，响应使用相同 `id` 关联。
4. 所有消息必须带协议版本；版本不兼容时返回明确错误。
5. TypeScript 类型不能替代运行时校验，来自 WebView 边界的数据一律视为 `unknown`。
6. Protocol 不依赖 Solid、Solid Toolbar、Quill、DOM 或具体 Flutter WebView 插件。
7. Snapshot 复用 `@teamgaga/richtext-delta` 的 canonical schema 与校验器，不重复定义数据格式。
8. Wire command 与 Core 内部 `EditorCommand` 分离，避免 Core 重构直接破坏 Flutter API；通过 Host 映射矩阵和契约测试保持语义对齐。

## 跨端 UI 边界

移动端 Toolbar、EmojiPicker、Mention Selector、Image Picker 和上传流程由 Flutter 原生实现。Protocol 只传递操作所需的 JSON 数据；不传递按钮、布局或弹窗状态。Desktop/PC Web 的可选 `@teamgaga/richtext-solid-toolbar` 直接消费 Core API，不是 Protocol 的依赖方。

## MVP 范围

### Flutter → Web 命令

- `set_snapshot`
- `get_snapshot`
- `set_selection`
- `get_selection`
- `toggle_inline_format`
- `toggle_block_format`
- `insert_emoji`
- `insert_mention`
- `insert_channel`
- `insert_image`
- `insert_video`
- `insert_link`
- `insert_divider`
- `undo`
- `redo`
- `focus`
- `blur`
- `open_link_form`
- `indent`
- `outdent`
- `get_caret_rect`

### Web → Flutter 事件

- `ready`
- `change`
- `selection_change`
- `focus`
- `blur`
- `title_focus`
- `title_blur`
- `state_change`
- `request_close`
- `request_emoji`
- `request_mention`
- `request_channel`
- `request_image`

### Web → Flutter 响应

- 成功响应
- 失败响应
- 错误码与可选错误详情

## 暂不实现

- AI Command
- 二进制文件传输
- 上传进度协议
- 多编辑器实例路由
- 增量协同编辑或 OT/CRDT
- v1 运行时兼容层（升 v2 时已否决，无双版本解码）
- 剪贴板 / 拖放（运行时内文档写入，见 ADR 0006；不经 Protocol）

后续命令仍须先在 Core/Quill 明确可执行语义，不能只在协议层提前声明空 API。

## 目标消息结构

```ts
export const PROTOCOL_VERSION = 2 as const;

export interface ProtocolCommand<Type extends string, Payload> {
  version: typeof PROTOCOL_VERSION;
  kind: "command";
  id: string;
  type: Type;
  payload: Payload;
}

export interface ProtocolSuccess<Type extends string, Value> {
  version: typeof PROTOCOL_VERSION;
  kind: "response";
  id: string;
  type: Type;
  ok: true;
  value: Value;
}

export interface ProtocolFailure {
  version: typeof PROTOCOL_VERSION;
  kind: "response";
  id: string;
  ok: false;
  error: {
    code: ProtocolErrorCode;
    message: string;
    details?: JsonValue;
  };
}

export interface ProtocolEvent<Type extends string, Payload> {
  version: typeof PROTOCOL_VERSION;
  kind: "event";
  type: Type;
  payload: Payload;
}
```

示例：

```json
{
  "version": 1,
  "kind": "command",
  "id": "request-42",
  "type": "set_snapshot",
  "payload": {
    "snapshot": {
      "content": [{ "insert": "hello\n" }]
    }
  }
}
```

## 建议目录

```text
packages/protocol/
├── src/
│   ├── version.ts
│   ├── errors.ts
│   ├── envelope.ts
│   ├── commands.ts
│   ├── events.ts
│   ├── responses.ts
│   ├── guards.ts
│   ├── codec.ts
│   └── index.ts
├── tests/
│   ├── commands.test.ts
│   ├── events.test.ts
│   └── codec.test.ts
├── package.json
└── README.md
```

## 实施步骤

### 1. 整理 package 元数据

修改：

```text
packages/protocol/package.json
packages/protocol/README.md
```

工作内容：

- 包名改为 `@teamgaga/richtext-protocol`。
- 描述改为 Flutter/WebView RichText 通信协议。
- 添加 `@teamgaga/richtext-delta` workspace dependency。
- 删除 starter API 和文档。

验收：

- Protocol 的生产依赖中不存在 Solid、Quill、DOM 或 Flutter 插件。

### 2. 定义版本与 Envelope

新增：

```text
src/version.ts
src/envelope.ts
src/errors.ts
```

工作内容：

- 定义 `PROTOCOL_VERSION = 1`。
- 定义 command、response、event 三种 envelope。
- 定义错误码：
  - `invalid_json`
  - `invalid_message`
  - `unsupported_version`
  - `unsupported_command`
  - `invalid_payload`
  - `editor_not_ready`
  - `command_failed`

验收：

- 所有消息都能通过 `kind` 判别。
- Command/response 可以通过 `id` 一一关联。

### 3. 定义 Command Union

新增：

```text
src/commands.ts
```

工作内容：

- 为每个 MVP 命令定义独立 payload。
- 无参数命令使用空对象 `{}`，不使用缺失 payload。
- Selection 使用 `{ start: number, end: number }`。
- Snapshot 使用 `RichTextSnapshotV1`。
- 格式值与当前 Core 能力保持一致，但不直接导入 Core command 类型。

验收：

- `EditorCommandMessage` 是可判别联合类型。
- 增加新命令时，Host dispatcher 的 `switch` 能触发穷尽检查。

### 4. 定义 Event 与 Response Union

新增：

```text
src/events.ts
src/responses.ts
```

v1 固定 payload：

- `ready`：`{ protocol_version: 1 }`。
- `change`：`{ snapshot: RichTextSnapshotV1 }`。
- `selection_change`：`{ selection: ProtocolSelection | null }`。
- `focus` / `blur`：`{}`。
- `state_change`：`{ state: ProtocolEditorState }`，其中 state 必须包含 `focused`、`selection`、`formats`、`canUndo` 和 `canRedo`。
- `get_snapshot` response：`{ snapshot: RichTextSnapshotV1 }`。
- `get_selection` response：`{ selection: ProtocolSelection | null }`。
- 其他成功 response：`{}`。

验收：

- Flutter 不需要通过字符串解析推断响应类型。
- 所有 payload 都可通过 `JSON.stringify()` 序列化。

### 5. 实现运行时 Guards

新增：

```text
src/guards.ts
```

提供：

```ts
isProtocolMessage(input: unknown): input is ProtocolMessage;
parseProtocolCommand(input: unknown): ProtocolParseResult<EditorCommandMessage>;
```

工作内容：

- 校验 envelope、版本、id、type 和 payload。
- `set_snapshot` 使用 Delta 包的 `validateSnapshot()`。
- `set_selection` 校验非负整数及 `end >= start`。
- v1 对 envelope、payload、value、error、selection 和 state 递归严格拒绝未知字段；空对象不得包含任何属性。
- Selection 使用非负安全整数，且 `end >= start`。
- 返回结构化 issue，不直接抛出裸 `TypeError`。

验收：

- 任意 JSON 值进入 parser 都不会造成未捕获异常。
- 错误包含稳定 code 和可定位 path。

### 6. 实现 JSON Codec

新增：

```text
src/codec.ts
```

提供：

```ts
encodeProtocolMessage(message: ProtocolMessage): string;
decodeProtocolMessage(raw: string): ProtocolParseResult<ProtocolMessage>;
```

工作内容：

- 捕获非法 JSON。
- 解码后执行运行时协议校验。
- 编码只接受已知消息联合类型。

验收：

- TypeScript 与 Dart 只交换 UTF-8 JSON 字符串。
- 编解码 round-trip 保持消息数据一致。

### 7. 公共导出与文档

修改：

```text
src/index.ts
README.md
```

公共导出包括：

- 版本常量
- Command/Event/Response 类型
- 错误类型
- guards
- codec
- 消息创建函数（如确有重复构造需求）

不导出内部校验辅助函数。

### 8. 测试

必须覆盖：

- 每种合法 command/event/response。
- 非法 JSON。
- 缺失或错误版本。
- 空 request id。
- 未知 kind/type。
- 非法 snapshot。
- 非法 selection。
- 非法格式值。
- 成功与失败响应关联同一 request id。
- encode/decode round-trip。
- 包中不出现 DOM、Solid、Solid Toolbar、Quill 依赖。
- Host 的 wire → Core 映射测试覆盖每个 Protocol command，防止双层契约语义漂移。

## Flutter 对齐任务

TypeScript 协议稳定后，在 Flutter 仓库同步：

- Dart sealed class / union。
- JSON encoder/decoder。
- `PROTOCOL_VERSION = 1`。
- golden fixtures：TS 编码结果必须能被 Dart 解码，反向亦然。
- 协议字段变更必须同时更新 TS 与 Dart golden fixture。

建议将无敏感信息的 wire fixtures 放入：

```text
packages/protocol/fixtures/
```

并由 Flutter 测试直接读取同一份 JSON。

## Todo List

### Package

- [x] `PROTOCOL-01` 更新 package 名称、描述和依赖。
- [x] `PROTOCOL-02` 重写 README。

### Schema

- [x] `PROTOCOL-03` 定义 v1 版本常量。
- [x] `PROTOCOL-04` 定义 command envelope。
- [x] `PROTOCOL-05` 定义 response envelope。
- [x] `PROTOCOL-06` 定义 event envelope。
- [x] `PROTOCOL-07` 定义稳定错误码。

### Messages

- [x] `PROTOCOL-08` 定义 MVP commands。
- [x] `PROTOCOL-09` 定义 editor events。
- [x] `PROTOCOL-10` 定义 command responses。

### Runtime Validation

- [x] `PROTOCOL-11` 实现 command parser。
- [x] `PROTOCOL-12` 接入 snapshot validator。
- [x] `PROTOCOL-13` 实现 JSON codec。
- [x] `PROTOCOL-14` 补齐非法输入测试。

### Cross-platform

- [x] `PROTOCOL-15` 添加共享 JSON wire fixtures。
- [ ] `PROTOCOL-16` 在 Flutter 侧实现对应模型。
- [ ] `PROTOCOL-17` 建立 TypeScript/Dart golden fixture 测试（TypeScript fixture/round-trip 已完成，Dart 侧待实现）。
- [x] `PROTOCOL-18` 建立 Protocol command → Core command 映射矩阵与 Host 契约测试。

### Validation

- [x] `VERIFY-01` 运行 `vp install`。
- [x] `VERIFY-02` 运行 `vp check`。
- [x] `VERIFY-03` 运行 `vp test`。
- [x] `VERIFY-04` 运行 `vp run -r build`。
- [x] `VERIFY-05` 确认 Protocol 不依赖 Host、Solid、Quill 或 DOM。

## 完成定义

满足以下条件后，Protocol v1 完成：

- Flutter 与 Web 共享同一套字段、命令、事件和版本语义。
- 所有边界输入都经过运行时校验。
- Snapshot 使用 canonical Delta schema，不产生第二套富文本数据模型。
- 请求都有可关联的成功或失败响应。
- TypeScript/Dart golden fixtures 双向兼容。
- 全仓 check、test 和 build 通过。
