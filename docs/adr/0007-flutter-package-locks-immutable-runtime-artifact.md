---
status: accepted
---

# 0007：Flutter package 显式锁定并 vendor immutable runtime artifact

日期：2026-08-21

## 状态

Accepted。本 ADR 已完成 PR-2 的 exact lock/vendor 迁移以及 PR-3/PR-4
的生产路径和文档收口；它 supersede 了 [ADR 0003](./0003-client-follows-branch-runtime-release.md)。

## 背景

历史上 Flutter package 通过 `richtext-runtime-channel.json` 指定 `dev` 分支，并在 prepare 阶段解析该通道的最新 runtime Release。该模型把分支上下文、Release 发布、依赖选择和 vendoring 混在一起：同一 Flutter package commit 在不同时间可能解析到不同 runtime bytes，缓存也不能成为可审查的版本锁定；PR-3/PR-4 已删除这条生产路径。

Flutter package 继续随 package 发布完整的 WebView runtime assets，使消费方无需 Node.js、运行时无需联网并支持离线加载。因此本次决策重构 artifact 的身份、选择和同步边界，不改变 vendored runtime 的交付方向。

## 决策

### 1. Runtime artifact 使用 immutable exact identity

- 构建必须针对完整 `sourceCommit` 生成确定性的 archive 和 metadata；branch、pipeline number、发布时间及 latest 顺序不是 artifact identity。
- 首期仍使用 GitHub Release 保存已提升的长期 artifact，但只接受显式 promotion。
- promotion tag 固定为 `webview-runtime-artifact-<40位 sourceCommit>`。同名 tag 已存在时必须逐字节回读校验；任何不一致都失败，禁止覆盖或重建。
- 普通 `dev` push 只生成短期验证 artifact，不创建长期 GitHub Release。
- promotion workflow 的 build job 只拥有 `contents: read`；publish job 必须经过受保护的 GitHub Environment `runtime-artifact-promotion` 审批后才获得 `contents: write`。source commit 还必须可达 `origin/dev` 或 `origin/main` 的历史。

### 2. Flutter package 使用显式 lock，并由 lock 唯一选择 artifact

- 新增并提交 `clients/flutter_quill_editor/richtext-runtime.lock.json`，schema v1 固定 exact release tag、source commit、archive SHA-256、content SHA-256、runtime build identity、入口信息和协议版本。
- schema v1 的 `artifact.repository` 固定为 `TeamGaga2/flutter_quill_editor`；环境变量只能配置 API base/token，不能把 lock 请求改指向其他仓库。
- lock 是 Flutter package 选择 runtime artifact 的唯一事实来源。工具不得枚举 Releases、调用 latest resolver、按 branch 选择或在网络失败时 fallback 到其他 artifact。
- lock 不包含 branch、latest selector、签名下载 URL 或凭据；URL 和 cache 仅是传输/性能细节，不是版本身份。
- 迁移完成后删除 vendored `runtime-release.json`，避免形成第二个可独立编辑的选择记录。

### 3. Vendor、manifest 与 lock 一起评审和提交

一次正式 runtime 更新必须同时产生以下三组变更：

```text
clients/flutter_quill_editor/richtext-runtime.lock.json
clients/flutter_quill_editor/assets/richtext_webview_runtime/**
clients/flutter_quill_editor/lib/host/runtime_manifest.dart
```

`runtime-version.json` 继续作为 archive 内的 runtime identity；`runtime_manifest.dart` 继续由已验证的 lock 和 runtime version codegen，不参与 artifact 选择。lock、artifact metadata、vendored runtime version、content digest、entry digest 和生成 manifest 必须逐项一致。

### 4. 保留现有完整性、安全和兼容性防线

目标实现必须继续保留：

- archive 和 content SHA-256 校验；
- `runtime-version.json`、`protocolVersion`、`hostEnvelopeVersion`、`buildId`、`sourceCommit`、`webEntry` 和 `webEntrySha256` 校验；
- HTML 相对资源引用校验；
- runtime content、入口和 HTML 相对引用使用跨语言一致的可移植可打印 ASCII 路径规则，拒绝非 ASCII、控制字符、反斜杠、绝对路径和 traversal；canonical digest 的 framing 仍使用 UTF-8 bytes；
- tar path traversal、绝对路径、重复条目、symlink、文件数和压缩/解压大小限制；
- protocol/host envelope compatibility validation，任何不兼容均 fail closed；
- 在目标 assets 同一父目录验证临时目录，并完成 atomic materialize；
- manifest 使用临时文件加 rename 更新，并在流程末尾执行只读 verify。

跨 assets、manifest 和 lock 的更新不宣称具有单一文件系统事务；中途失败必须可被后续 verify 检测，正式发布不得绕过校验继续进行。

### 5. 明确区分三类工作场景

| 场景             | 入口语义                                                                           | 是否写正式 lock     | 是否创建长期 Release |
| ---------------- | ---------------------------------------------------------------------------------- | ------------------- | -------------------- |
| Runtime 本地开发 | runtime 自身 dev/build/test，消费本地源码或 dist                                   | 否                  | 否                   |
| Flutter 联调     | `--local <distPath>`，只做本地 materialization                                     | 否                  | 否                   |
| 正式更新/发布    | exact commit promotion → exact tag update/vendor → locked verify → package publish | 是（仅显式 update） | 仅显式 promotion     |

本地 materialization 必须明确提示不可发布；正式 publish 只消费已提交的 lock、vendor 和 manifest，不现场构建 runtime、不联网解析 latest，也不自动更新 lock。

## 基线记录

PR-0 以提交 `0ecde5d` 为文档基线。迁移完成后的实现和验证入口包括：

- `.github/workflows/runtime-release.yml`：普通 PR/branch 验证并上传短期 Actions artifact，不创建 Release；
- `.github/workflows/runtime-artifact-promotion.yml`：受保护的 exact source commit promotion；
- `scripts/runtime-release.mjs`、`scripts/promote-runtime-artifact.mjs`：artifact contract 和 immutable promotion；
- `clients/flutter_quill_editor/tool/richtext_runtime_prepare.dart`、`tool/runtime_delivery.dart`：locked verify、local materialize、exact update 和 manifest codegen；
- `clients/flutter_quill_editor/test/runtime_lock_test.dart` 与 `scripts/runtime-artifact.test.mjs`：exact lock、token redirect、checksum、协议、content digest 和 archive 安全测试。

旧 channel/latest/publisher 入口已在 PR-3/PR-4 删除；历史 branch Release
仍保留在 GitHub 供审计，但不再参与选择。

## 迁移边界

本 ADR 的实施由[构建产物同步机制改造实施方案](../plans/webview-runtime-artifact-sync-implementation-plan.md)按 PR-0 至 PR-4 完成：先建立 artifact contract，再引入 lock/exact vendor，随后停止 floating 发布与解析，最后收口历史文档和兼容代码。

PR-4 已完成收口。当前生产路径是 exact promotion → explicit lock update/vendor → offline locked verify；旧 branch/latest 路径仅作为历史文档保留。

PR-1 提供跨语言共享的 `scripts/fixtures/runtime-content-sha256.json`，用于冻结 canonical content digest 算法。Dart verifier 对该 fixture 的消费和真实 vendored tree 校验是 PR-2 的强制门槛；PR-1 不提前改 Flutter consumer。

## 后果与取舍

正向后果：同一 Flutter package commit 的运行时 bytes 可复现，lock/vendor/manifest diff 可审查，offline package 构建和回滚不依赖 branch 的移动状态；GitHub Release 仍可复用现有上传和回读校验能力。

代价是 runtime promotion 与 Flutter lock update 成为两个显式维护动作，且 assets、manifest、lock 需要在同一 PR 中保持一致。首期不引入多 artifact provider 抽象、不引入 runtime 独立 SemVer，也不借此 ADR 放宽协议兼容策略。

## 相关文档

- 目标实施计划：[WebView Runtime 构建产物同步机制改造实施方案](../plans/webview-runtime-artifact-sync-implementation-plan.md)
- 被本 ADR supersede 的历史决策：[ADR 0003](./0003-client-follows-branch-runtime-release.md)
