# WebView Runtime 构建产物同步机制改造实施方案

> 项目：`TeamGaga2/flutter_quill_editor`
> 目标分支：`dev`
> 文档状态：Accepted / PR-0 至 PR-4 已完成
> 基线提交：`0ecde5d`（2026-08-21 本地核对）
> 实施方式：分阶段 PR
> 核心原则：**Build → Immutable Artifact → Explicit Lock → Vendor**

## 1. 文档目的

本文定义 `apps/webview-runtime` 构建产物进入 `clients/flutter_quill_editor` 的目标机制、文件契约、维护流程、CI 门禁、迁移顺序和验收标准。

本文是后续实施 PR 的总设计文档。每个 PR 可以补充自己的任务清单、测试记录和差异说明，但不得在未更新本文或配套 ADR 的情况下改变以下核心决策：

1. Flutter package 继续提交并发布 vendored runtime assets。
2. Flutter package 使用显式 lock 固定一个不可变 runtime artifact。
3. 普通分支或 `dev` push 不再自动创建 GitHub Release。
4. 任何同步流程都不得按 branch、时间或 `latest` 隐式选择 artifact。
5. 本地开发、Flutter 联调、正式更新/发布使用不同入口，不共享模糊的默认行为。

## 2. 决策摘要

### 2.1 保留的能力

以下能力已经具备明确价值，本次改造必须保留：

- Flutter package 内提交 `assets/richtext_webview_runtime/**`，消费方无需 Node.js，App 运行时无需联网。
- `runtime-version.json` 记录 runtime identity、协议版本、入口文件和入口 SHA-256。
- `webview-runtime.tar.gz` 的整体 SHA-256 校验。
- `protocolVersion` 与 `hostEnvelopeVersion` compatibility validation。
- 解压路径、symlink、重复条目、文件数量和压缩/解压大小限制。
- 临时目录验证完成后再 atomic materialize runtime 目录。
- `lib/host/runtime_manifest.dart` codegen。
- 内容寻址的 iframe 文件名及 `webEntrySha256` 校验。

### 2.2 替换的能力

| 当前机制                                               | 目标机制                                                               |
| ------------------------------------------------------ | ---------------------------------------------------------------------- |
| `richtext-runtime-channel.json` 只记录 `branch: dev`   | `richtext-runtime.lock.json` 固定 exact artifact identity              |
| 默认 prepare 枚举 Releases 并执行 `resolveLatest()`    | update/vendor 只接受 exact release tag 或已下载 artifact               |
| 每次 `dev` push 创建长期 GitHub Release                | 普通 CI 只生成短期验证 artifact；仅显式 promotion 创建长期 artifact    |
| Release tag 包含 branch identity 与 pipeline IID       | artifact tag 由 exact source commit 决定                               |
| 同一 Flutter commit 可随时间取得不同 runtime           | 同一 Flutter commit 始终包含同一组 runtime bytes                       |
| vendored `runtime-release.json` 同时承担来源与构建记录 | 根目录 lock 是唯一选择来源；`runtime-version.json` 是 runtime 内部身份 |
| 回滚依赖在目标 branch 发布一个更新的 Release           | 回滚 lock + vendored assets，或 pin 到另一个已提升 artifact            |

### 2.3 首期存储选择

第一阶段继续使用 GitHub Release 作为“已提升的长期不可变 artifact”存储，以复用现有 draft、上传、回读和幂等校验代码；但 Release 的语义从“branch channel 的每次构建”改为“显式提升的 exact commit”。

这不是保留 floating Release 模型：

- promotion 必须显式触发，并传入完整 `sourceCommit`；
- tag 必须是 `webview-runtime-artifact-<40位 sourceCommit>`；
- 已存在的同名 tag 只能在所有 bytes 完全一致时判定幂等成功；
- lock 保存 exact tag 和 archive SHA-256；
- vendor 工具禁止枚举 Release，也禁止调用 latest API。

如果未来改用 GitHub Packages、对象存储或其他 artifact registry，应新增 lock schema 版本和 ADR，不在 v1 中提前实现通用 provider 抽象。

## 3. 背景与现状

### 3.1 当前文件与职责

| 文件                                                         | 当前职责                                                              | 改造结论                                           |
| ------------------------------------------------------------ | --------------------------------------------------------------------- | -------------------------------------------------- |
| `.github/workflows/runtime-release.yml`                      | 普通 PR/branch 验证并上传短期 artifact                                | 不创建 Release；长期发布只走显式 promotion         |
| `scripts/runtime-release.mjs`                                | dist 校验、确定性归档和 artifact metadata                             | artifact contract；无 branch/pipeline identity     |
| `scripts/promote-runtime-artifact.mjs`                       | exact tag、幂等上传、Release 回读                                     | 受保护的 exact source commit promotion             |
| `clients/flutter_quill_editor/richtext-runtime-channel.json` | 历史 floating selector                                                | 已删除，由 lock 取代                               |
| `tool/richtext_runtime_prepare.dart`                         | locked verify、local materialize、exact update/vendor                 | 默认离线 verify；无 implicit update                |
| `tool/runtime_delivery.dart`                                 | exact artifact fetch、archive 安全、校验、cache、materialize、codegen | 无 branch/latest 逻辑；保留安全与 materialize 能力 |
| `assets/richtext_webview_runtime/**`                         | 被提交并随 pub package 发布的 runtime                                 | 继续提交                                           |
| `assets/.../runtime-release.json`                            | 历史 release provenance 副本                                          | 已删除，不再作为第二个 lock                        |
| `lib/host/runtime_manifest.dart`                             | 供 Flutter loader 使用的生成代码                                      | 继续提交，由 lock + runtime version 生成           |
| `docs/adr/0003-*`                                            | 历史 branch/latest 决策                                               | 已标记 superseded                                  |

### 3.2 当前关键问题

#### 同一源码不能确定同一 runtime

当前默认 prepare 的选择函数是：

```text
branch=dev
  → 枚举 GitHub Releases
  → 过滤 branch identity
  → 选择最大 pipeline IID
```

因此同一 Flutter commit 在不同时间执行 prepare，可能得到不同的 runtime bytes。`richtext-runtime-channel.json` 是 floating selector，不是 lock。

#### 发布、选择、缓存与 vendoring 混为一体

GitHub Release 的创建频率由 `dev` push 决定，Flutter 的选择由 latest 决定，而 archive cache 只是在选择之后优化下载。这导致以下概念边界不清：

- Release 是否是产品发布记录，还是内部 CI artifact；
- branch 是否是开发上下文，还是依赖版本；
- cache 是否可以被当成 lock；
- vendored assets 是否是唯一运行输入。

目标模型要求四者分离：

```text
CI artifact       = 短期验证结果
promoted artifact = 长期、不可变、可被精确定位的候选
lock              = Flutter package 对候选的唯一显式选择
vendor            = Flutter package 实际编译和发布的 runtime bytes
```

#### 本地模式伪造 Release provenance

当前 `--local` / `--from-dist` 仍读取 channel，并合成 pipeline ID/IID 为 `1` 的 Release metadata。该记录既不是实际 Release，也不能可靠表达 dirty worktree。

目标模型中，本地联调必须明确标记为 ephemeral local materialization，不写正式 lock，不伪造 Release tag 或 pipeline provenance。

## 4. 目标、非目标与成功定义

### 4.1 目标

- Flutter package commit 与其包含的 runtime bytes 一一对应。
- 依赖升级必须形成可评审的 lock、assets 和 codegen diff。
- 普通 runtime 开发不产生 vendored 文件噪音，也不创建长期 Release。
- Flutter 联调可以快速使用本地 runtime dist，但不会被误认为正式 pin。
- 正式发布只使用已提交、已验证的 lock 和 vendored assets。
- 所有选择均基于 exact identity；网络失败不得触发 fallback 到其他 artifact。
- 保留现有 archive 安全、协议兼容和 atomic materialize 防线。

### 4.2 非目标

- App 安装后在线更新 runtime。
- Flutter 消费方现场构建 TypeScript runtime。
- 运行时从 GitHub/CDN 下载 assets。
- 为每个 feature branch 自动创建长期 artifact。
- v1 同时支持多个 artifact provider。
- 在本次改造中引入 runtime 独立 SemVer。
- 借此次改造调整富文本协议语义或放宽兼容策略。

### 4.3 可验证成功条件

当且仅当以下条件全部成立，本次改造才视为完成：

1. 仓库中不存在 branch channel 配置和默认 latest resolver。
2. `dev` push 不创建 GitHub Release。
3. `richtext-runtime.lock.json`、vendored runtime 与 `runtime_manifest.dart` 能被离线一致性校验。
4. 正式 lock 更新只能指向 exact tag + exact SHA-256。
5. fresh checkout 在 runtime 交付方面不运行 Node、不查询 GitHub，也能分析、测试和打包 Flutter package 中已 vendored 的 runtime。
6. 发布前门禁可以阻止 lock、runtime-version、vendored bytes、codegen 或协议版本不一致。
7. 已知良好 lock 可通过一次显式变更恢复，且无需向 branch 发布“更新的 latest”。

## 5. 术语与系统不变量

### 5.1 术语

- **Runtime dist**：`apps/webview-runtime/dist` 下的构建目录。
- **Runtime artifact**：经过校验和确定性打包的 `webview-runtime.tar.gz` 及其外部 metadata/checksum。
- **Promotion**：将 exact source commit 的 artifact 写入长期不可变存储的显式动作。
- **Lock**：`clients/flutter_quill_editor/richtext-runtime.lock.json`，Flutter package 选择 artifact 的唯一事实来源。
- **Vendor**：把 lock 指向的 artifact 解压并提交到 Flutter package assets。
- **Local materialization**：为 Flutter 联调临时把本地 dist 写入 assets；不代表正式 pin。
- **Formal publish**：发布 `flutter_quill_editor` package/tag 的流程，不等同于普通 CI 或 local materialization。

### 5.2 必须长期成立的不变量

```text
lock.artifact.archiveSha256
  == downloaded archive SHA-256

lock.runtime identity
  == runtime-artifact.json identity
  == vendored runtime-version.json identity
  == generated runtime_manifest.dart identity

lock.artifact.contentSha256
  == canonical digest(vendored runtime directory)

Flutter build input
  == committed vendored runtime directory
```

另外：

- branch、pipeline number、发布时间和 latest 顺序都不是 artifact identity。
- URL 不是 identity；lock 不保存带时效签名的下载 URL。
- cache 不是 identity；cache miss 只能下载 lock 指向的 exact artifact。
- `runtime_manifest.dart` 是派生产物，不参与 artifact 选择。
- 正式发布不得调用 resolveLatest，也不得自动更新 lock。

## 6. 目标架构

### 6.1 总体数据流

```text
Runtime source at exact commit
          │
          │ deterministic build + validate
          ▼
webview-runtime.tar.gz
runtime-artifact.json
webview-runtime.tar.gz.sha256
          │
          │ explicit promotion
          ▼
Immutable GitHub Release
webview-runtime-artifact-<sourceCommit>
          │
          │ explicit lock update; never latest
          ▼
richtext-runtime.lock.json
          │
          │ download/verify/extract/atomic materialize
          ▼
assets/richtext_webview_runtime/**
lib/host/runtime_manifest.dart
          │
          │ commit and review together
          ▼
Flutter package / pub.dev / offline App
```

### 6.2 状态边界

| 状态               | 长期保存位置                   | 是否进入 Flutter package | 是否可作为选择来源 |
| ------------------ | ------------------------------ | ------------------------ | ------------------ |
| 本地 dist          | 开发者工作区                   | 否，除非临时联调         | 否                 |
| 普通 CI artifact   | GitHub Actions，短期 retention | 否                       | 否                 |
| promoted artifact  | exact GitHub Release           | 间接                     | 只能通过 exact tag |
| lock               | Git                            | 是                       | 是，唯一来源       |
| vendored assets    | Git + pub package              | 是                       | 是，唯一运行输入   |
| generated manifest | Git + Dart code                | 是                       | 否，派生记录       |

## 7. Artifact 契约

### 7.1 文件集合

promotion 产物固定包含：

```text
webview-runtime.tar.gz
runtime-artifact.json
webview-runtime.tar.gz.sha256
```

归档内部继续包含：

```text
index.html
iframe.<content-prefix>.html
assets/**
runtime-version.json
favicon.svg / icons.svg / 其他被 HTML 引用的静态文件
```

`runtime-artifact.json` 位于归档外，因为 archive SHA-256 不能无循环地写入归档自身。

### 7.2 `runtime-version.json`

继续保留现有字段：

```json
{
  "protocolVersion": 2,
  "hostEnvelopeVersion": 1,
  "buildId": "<stable build identity>",
  "builtAt": "<deterministic ISO-8601 timestamp>",
  "package": "webview-runtime",
  "sourceCommit": "<40 lowercase hex>",
  "webEntry": "iframe.<hash-prefix>.html",
  "webEntrySha256": "<64 lowercase hex>"
}
```

约束：

- `sourceCommit` 必须是构建时显式 checkout 的完整 commit，不接受 branch 名。
- 正式 artifact 的 `buildId` 必须稳定；建议直接使用完整 `sourceCommit`。
- `builtAt` 使用 source commit timestamp 或显式 `SOURCE_DATE_EPOCH`，不得使用 promotion 执行时的当前时间。
- `webEntry` 必须是安全相对路径并存在。
- `webEntrySha256` 必须与最终重命名后的 iframe bytes 一致。

### 7.3 `runtime-artifact.json`

建议 v1 契约：

```json
{
  "schemaVersion": 1,
  "package": "webview-runtime",
  "archiveName": "webview-runtime.tar.gz",
  "archiveSha256": "<64 lowercase hex>",
  "contentSha256": "<64 lowercase hex>",
  "sourceCommit": "<40 lowercase hex>",
  "buildId": "<stable build identity>",
  "protocolVersion": 2,
  "hostEnvelopeVersion": 1,
  "webEntry": "iframe.<hash-prefix>.html",
  "webEntrySha256": "<64 lowercase hex>"
}
```

该文件不再记录：

- branch；
- branch identity；
- pipeline IID 或 latest 顺序；
- Release tag；
- 临时下载 URL。

GitHub run ID 可以写在 Actions 日志、attestation 或 Release description 中，用于诊断，但不参与 artifact identity。

### 7.4 确定性与 content digest

归档继续使用：

- 路径字典序；
- 固定文件 mode；
- tar mtime 归零；
- gzip `mtime=0`；
- 固定依赖与固定工具链。

为支持不下载远端 archive 的 vendored 目录完整性校验，v1 增加 `contentSha256`。建议使用以下跨语言可实现的 canonical digest：

1. 拒绝 symlink 与非普通文件/目录。
2. runtime content、`webEntry` 和 HTML 相对引用只允许可移植的可打印
   ASCII 路径（拒绝非 ASCII、控制字符、反斜杠、绝对路径和 traversal）；
   这使 Node 与 Dart 不依赖 Unicode NFC 实现仍能严格一致。
3. 将所有相对文件路径转换为 `/` 分隔并按 UTF-8 字典序排序。
4. 对每个文件计算 SHA-256。
5. 对每一项按 `path + NUL + fileSha256 + LF` 的 UTF-8 bytes 依次输入总哈希。
6. 总哈希的小写十六进制即 `contentSha256`。

Node builder 与 Dart verifier 必须共享 golden fixtures，避免算法漂移。

### 7.5 Promotion tag

正式 artifact tag 固定为：

```text
webview-runtime-artifact-<40位 sourceCommit>
```

规则：

- promotion workflow 必须 checkout 该 exact commit，而不是先读 branch 再使用移动后的 HEAD。
- tag 必须指向同一个 `sourceCommit`。
- 若 tag 已存在，publisher 必须回读全部三个 assets 并逐字节验证。
- 已存在 tag 的任何 byte 不一致都必须失败；禁止覆盖、删除后重建或“修复”旧 artifact。
- 同一 commit 无法重现同一 archive 时，按构建非确定性缺陷处理，不创建第二个 tag 规避。

## 8. Lock 契约

### 8.1 文件位置

```text
clients/flutter_quill_editor/richtext-runtime.lock.json
```

该文件必须提交 Git，并替代 `richtext-runtime-channel.json`。

### 8.2 v1 schema

```json
{
  "schemaVersion": 1,
  "artifact": {
    "repository": "TeamGaga2/flutter_quill_editor",
    "releaseTag": "webview-runtime-artifact-<40位 sourceCommit>",
    "archiveName": "webview-runtime.tar.gz",
    "archiveSha256": "<64 lowercase hex>",
    "contentSha256": "<64 lowercase hex>"
  },
  "runtime": {
    "sourceCommit": "<40 lowercase hex>",
    "buildId": "<stable build identity>",
    "protocolVersion": 2,
    "hostEnvelopeVersion": 1,
    "webEntry": "iframe.<hash-prefix>.html",
    "webEntrySha256": "<64 lowercase hex>"
  }
}
```

### 8.3 lock 校验规则

- 只接受 `schemaVersion == 1`。
- `releaseTag` 必须严格等于 `webview-runtime-artifact-${runtime.sourceCommit}`。
- repository 首期只接受预期仓库，禁止通过 lock 把凭据发送到任意 host/repository。
- `archiveName` 首期固定为 `webview-runtime.tar.gz`。
- 所有 SHA 必须是 64 位小写十六进制；source commit 必须是 40 位小写十六进制。
- lock 与 `runtime-artifact.json` 的相关字段必须逐字段一致。
- lock 与 vendored `runtime-version.json` 的 runtime 字段必须逐字段一致。
- lock 文件不得包含 token、签名 URL、branch 或 latest selector。
- lock 只能由显式 update 命令写入；verify、build、test、publish 均不得修改它。

### 8.4 唯一事实来源

迁移完成后删除 vendored `assets/.../runtime-release.json`。如果迁移 PR 为兼容旧代码而短暂保留，它只能由 lock 生成，并且 CI 必须验证完全一致；不得长期存在两个可独立编辑的依赖记录。

## 9. Vendoring 与 codegen 契约

一次正式 runtime 更新必须同时产生三组 Git diff：

```text
clients/flutter_quill_editor/richtext-runtime.lock.json
clients/flutter_quill_editor/assets/richtext_webview_runtime/**
clients/flutter_quill_editor/lib/host/runtime_manifest.dart
```

缺少任一组都必须被 CI 阻止。

### 9.1 正式 materialize 顺序

1. 读取并校验 exact lock 或 promotion metadata。
2. 下载 exact tag 的三个 assets；禁止枚举 Releases。
3. 校验 checksum sidecar、metadata 和 archive SHA-256 三方一致。
4. 在目标 assets 同一父目录创建临时目录。
5. 在写目标目录前完成 archive 大小、条目数量、路径、重复项和 symlink 检查。
6. 解压到临时目录。
7. 校验 `runtime-version.json`、协议版本、host envelope、iframe SHA、HTML 相对引用和 `contentSha256`。
8. 在临时位置生成 `runtime_manifest.dart` 内容。
9. 原子替换 assets 目录。
10. 以临时文件 + rename 替换 manifest；正式 update 模式最后写 lock。
11. 重新执行一次只读 verify，成功后退出。

注意：assets 目录、manifest 文件和 lock 文件无法组成一个跨路径文件系统事务。实现必须保证每个目标单独使用原子替换，并让中途失败留下“可检测的不一致”，而不是静默成功。CI 与正式发布前必须重新 verify。

### 9.2 `runtime_manifest.dart`

codegen 输入只允许：

- 已验证的 lock；
- 已验证的 vendored `runtime-version.json`。

首期为避免不必要的 public API 破坏，可以保留 `RichTextRuntimeManifest` 现有 nullable branch/pipeline 字段，但生成结果不得再把它们当成依赖身份。建议：

- 继续生成 protocol、host envelope、build ID、web entry、web entry SHA、source commit、archive SHA；
- `releaseTag` 写 exact artifact tag；
- branch、branch identity、pipeline ID/IID 生成为 `null`，并在独立 API 变更中决定是否移除；
- codegen 输出必须稳定，重复运行不产生 diff。

## 10. 三类工作场景

### 10.1 场景 A：WebView runtime 本地开发

目的：开发 HTML/JS/CSS、协议实现或编辑器行为，优先获得热更新反馈。

```text
runtime source
  → vp dev / playground
  → browser feedback
```

规则：

- 不构建长期 artifact。
- 不修改 lock。
- 不修改 Flutter vendored assets。
- 不创建 GitHub Release。
- PR CI 可以构建短期 artifact 供诊断，但该 artifact 不可被 lock 按 latest 自动消费。

完成条件：runtime 自身 check、test、build 与 dist validation 通过。

### 10.2 场景 B：Flutter 联调本地 runtime

目的：在真实 Flutter WebView/iframe host 中验证尚未 promotion 的 runtime 变更。

建议接口：

```sh
vp run --filter webview-runtime... build
cd clients/flutter_quill_editor
dart run tool/richtext_runtime_prepare.dart --local ../../apps/webview-runtime/dist
```

规则：

- `--local` 明确消费给定 dist，不读取 channel、Release 或 lock 来选择版本。
- 仍执行 runtime-version、协议、entry SHA、资源引用和安全检查。
- 仍 atomic materialize assets 并生成可供本地运行的 manifest。
- 不写正式 lock，不生成伪 release tag/pipeline metadata。
- 命令输出必须明确提示“local materialization，不可发布”。
- 只读 locked verify 必须能识别该目录与 committed lock 不一致并失败。
- 本地联调产生的 assets/manifest diff 不应直接提交；正式提交必须改用场景 C 的 exact artifact update。

首期不引入额外 Flutter runtime overlay 机制，以减少 loader 和 pubspec 改动。若 tracked assets 被本地联调覆盖带来持续误提交问题，再单独设计 ignored overlay，不在本次范围内预实现。

### 10.3 场景 C：正式 runtime 更新与 Flutter 发布

该场景分为两个显式动作，不能在一次普通 build 中隐式发生。

#### C1. 提升并 pin runtime

```text
runtime source merged/reachable at exact commit
  → workflow_dispatch(sourceCommit)
  → deterministic build + validation
  → promoted immutable artifact
  → explicit update command by exact tag
  → lock + vendor + manifest PR
  → review + CI + merge
```

要求：

- 推荐在 runtime 源码 PR 合并后 promotion，保证 `sourceCommit` 是稳定可追溯提交。
- promotion 和 lock update 可以由自动化开 PR，但不得直接无评审写 `dev`。
- lock update PR 只包含 artifact pin、vendored bytes、codegen 和必要文档/测试变化。
- 审查者可以从 lock 看到 source commit、exact tag、archive/content SHA 和协议版本变化。

#### C2. 发布 Flutter package

```text
committed lock + committed vendor + committed manifest
  → locked verify
  → flutter analyze/test
  → package content/dry-run verification
  → dart-v* tag
  → publish
```

要求：

- publish job 不更新 lock、不下载 latest、不现场构建 runtime。
- 正式 package 使用源码树中已提交的 vendor。
- 可以额外按 exact tag 回读 artifact 做供应链复核，但失败时只能阻止发布，不能改选其他 artifact。
- tag 对应的 package commit 必须已经通过 lock/vendor/manifest 一致性门禁。

## 11. 工具接口设计

在不扩大工具数量的前提下，首期可以继续使用 `richtext_runtime_prepare.dart`，但将模式改为显式动作。建议接口：

```text
--verify
  只读、离线；验证 committed lock、vendor、manifest 和 compatibility。

--local <distPath>
  临时 Flutter 联调；不写 lock，不访问 GitHub。

--update --release-tag <exactTag>
  从 exact promoted artifact 更新 lock、vendor 和 manifest。
  禁止 latest、branch 或缺省 tag。

--from-artifact <artifactDirectory> --release-tag <exactTag>
  供 promotion workflow/受控维护流程从已下载的三个文件更新。
  正式模式要求 exact tag 与 metadata 中 source commit 的命名契约成立；
  未经远端 promotion 证明的本地迁移还必须显式加
  `--allow-unpublished`，且该 flag 在 CI/GitHub Actions 中拒绝。

--clean
  清理工具生成的临时文件；不得默认删除 committed vendor。
```

默认无参数行为建议改为 `--verify` 或直接显示用法并失败，不能继续隐式联网解析 latest。最终选择在 PR-2 中确定，但必须满足“无隐式更新”。

exact Release 获取应直接使用 GitHub 的 `GET /repos/{owner}/{repo}/releases/tags/{tag}`，不再列出、分页、过滤或排序 Releases。

### 11.1 删除的工具行为

- `RuntimeChannelConfig`。
- `runtimeBranchIdentity()`。
- Release 枚举与最大 pipeline IID 选择。
- branch/pipeline tag parser。
- “API 失败时如何判断 latest”的全部逻辑。
- local 模式合成 release/pipeline metadata。

### 11.2 保留或迁移的工具行为

- HTTPS 与预期 origin 限制。
- token 只发送到预期 GitHub origin，跨 origin redirect 不转发凭据。
- content-addressed archive cache；key 改为 lock 中 exact archive SHA。
- checksum 解析与 archive digest 复核。
- archive 安全限制与解压。
- runtime directory validation。
- atomic materialize 与失败恢复。
- manifest codegen。

## 12. CI/CD 设计

### 12.1 Runtime 普通验证 workflow

触发范围：相关 PR、`dev`/`main` push。

执行：

1. checkout 当前 commit；
2. 固定工具链与 frozen lockfile 安装；
3. check/test/build；
4. dist validation；
5. 生成确定性 archive、metadata、checksum；
6. 重复打包并比较 SHA，或通过 golden test 验证确定性；
7. 上传短期 Actions artifact 供诊断。

禁止：创建 tag、GitHub Release、更新 Flutter lock/vendor。

### 12.2 Runtime promotion workflow

触发：`workflow_dispatch`，必填完整 `sourceCommit`；如后续有明确版本策略，可增加受保护 tag 触发。

promotion workflow 使用受保护的 GitHub Environment `runtime-artifact-promotion`。仓库管理员必须为该 Environment 配置 required reviewers/审批规则；未通过审批的 publish job 不会获得 `contents: write` 权限。build job 仅使用 `contents: read`，以 `persist-credentials: false` checkout exact commit，并校验该 commit 可达 `origin/dev` 或 `origin/main` 的历史。build job 上传 7 天短期 Actions artifact，publish job 只下载这三个文件并运行受控 publisher。

执行：

1. 校验调用者权限和 source commit 格式；
2. checkout exact commit；
3. 使用与普通验证相同的 builder；
4. 生成 `webview-runtime-artifact-<sourceCommit>`；
5. 创建 draft Release；
6. 上传 archive、metadata、checksum；
7. 回读逐 byte 校验；
8. 发布 Release；
9. 输出 exact tag、archive SHA、content SHA。

并发键应基于 source commit。重复运行必须幂等；内容不一致必须失败。

### 12.3 Flutter client CI

普通 analyze/test job 在 `flutter pub get` 后执行离线 `--verify`，至少检查：

- lock schema 与 tag/source commit 关系；
- lock 与 runtime-version 逐字段一致；
- vendored content SHA；
- web entry SHA 与 HTML 引用；
- protocol/host envelope 与 Flutter host constants；
- manifest codegen 无 diff；
- assets 路径已被 `pubspec.yaml` 声明。

当 lock 或 vendor 变化时，增加 exact artifact 远端复核 job：按 lock tag 下载并比对 archive SHA 和 metadata。该 job 不选择 latest。

### 12.4 Flutter publish job

在现有 analyze/test 之外增加：

- locked verify；
- `dart pub publish --dry-run` 或等价 package content 检查；
- 检查 vendored runtime 必需文件确实包含在 package 中；
- 检查 tag commit 与已验证 commit 一致。

publish job 不运行 `--update`、`--local` 或 runtime Node build。

## 13. Compatibility validation

首期保持当前严格相等策略：

```text
runtime protocolVersion == Flutter kRichTextProtocolVersion
runtime hostEnvelopeVersion == Flutter kHostEnvelopeVersion
```

验证发生在三个时点：

1. promotion 前：artifact metadata 与 runtime-version 一致；
2. vendor/update 时：artifact 与当前 Flutter host 常量兼容；
3. App runtime handshake 时：实际 iframe 报告值与生成 manifest 一致。

任何不一致都 fail closed。未来若要引入兼容范围或协议迁移窗口，应单独制定协议兼容 ADR；不得在本次同步改造中顺便放宽。

## 14. 安全与完整性要求

必须保留当前限制，并补充 lock 边界：

- archive 压缩大小上限：100 MB；
- 条目数上限：10,000；
- 单文件上限：50 MB；
- 总解压大小上限：200 MB；
- 拒绝绝对路径、盘符路径、`..`、空路径段、重复条目和 symlink；
- 临时目录必须创建在目标 assets 同一父目录，保证目录 rename 不跨卷；
- token 只通过 HTTP Authorization header 传递，不进入 lock、URL query、日志、cache 或 artifact；
- redirect 到不同 origin 时不得转发 token；
- lock repository/tag 必须先验证，再构造 API 请求；
- checksum、metadata、archive、runtime-version 和 content digest 必须全部一致；
- 正式更新失败时不得使用另一个 tag、旧 cache 或当前 branch HEAD 兜底。

## 15. 文件级改造清单

| 文件                                                           | 计划变更                                                                            |
| -------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `.github/workflows/runtime-release.yml`                        | 普通验证上传短期 artifact，不发布 Release                                           |
| `scripts/runtime-release.mjs`                                  | artifact contract；删除 branch/pipeline identity；提供 content digest               |
| `scripts/promote-runtime-artifact.mjs`                         | exact commit tag、幂等发布、受保护 promotion                                        |
| `scripts/runtime-artifact.test.mjs`                            | exact tag、content digest、重复构建和 promotion 测试                                |
| `clients/flutter_quill_editor/richtext-runtime.lock.json`      | 新增并提交                                                                          |
| `clients/flutter_quill_editor/richtext-runtime-channel.json`   | 已删除；不得重新引入                                                                |
| `tool/richtext_runtime_prepare.dart`                           | 显式 verify/local/update/from-artifact；默认不联网更新                              |
| `tool/richtext_runtime_prepare.dart` 的 package root detection | 从查找 channel 文件改为查找 lock，避免迁移后从错误目录运行                          |
| `tool/runtime_delivery.dart`                                   | 新增 lock/artifact model；删除 latest resolver；保留安全/materialize/codegen        |
| `test/runtime_delivery_test.dart`                              | 删除 latest 选择测试；增加 lock、exact fetch、content digest、local/locked 模式测试 |
| `assets/richtext_webview_runtime/**`                           | 由首个 lock 指向的 artifact 重新 vendor                                             |
| `assets/.../runtime-release.json`                              | 已删除；不得重新引入                                                                |
| `lib/host/runtime_manifest.dart`                               | 改由 lock + runtime-version codegen                                                 |
| `.github/workflows/flutter-client.yml`                         | 使用完整 locked verify 取代只比较 protocol 的 shell 片段                            |
| `clients/flutter_quill_editor/README.md`                       | 改为 explicit pin/vendor 维护说明                                                   |
| `docs/runtime-release.md`                                      | 描述普通 CI artifact 与 promotion artifact 的区别                                   |
| `docs/adr/0002-runtime-css-owns-stable-richtext-styles.md`     | 修正仍指向 ADR-0003 floating 同步契约的交叉引用                                     |
| `docs/adr/0003-*`                                              | 标记 superseded，保留历史内容                                                       |
| `docs/adr/00xx-*`                                              | 新增“Flutter package 显式锁定并 vendor runtime artifact”ADR                         |
| `docs/plans/webview-runtime-branch-release-delivery.md`        | 标记 superseded 并链接本文/新 ADR                                                   |
| `docs/plans/richtext-link-popover.md`                          | 收口旧 runtime 同步/发布模型引用，改为 explicit lock/vendor 流程说明                |
| `docs/plans/richtext-inline-embed-clipboard.md`                | 收口旧 ADR-0003 channel 引用，改为 explicit lock/vendor 流程说明                    |
| `docs/plans/todos.md`                                          | 收口旧 runtime buildId、手工同步和 channel 引用，改为 explicit lock/vendor 维护说明 |

## 16. 分阶段 PR 计划

每个 PR 必须可独立合并、可独立验证，并避免在新路径可用前删除旧路径。

### PR-0：设计冻结与基线记录

目标：评审并确认本文以及 superseding ADR 的核心决策。

范围：

- 提交本文到仓库 `docs/plans/`；
- 新增 ADR，状态先设为 proposed；
- 记录现有命令、CI 和安全测试基线；
- 确认首期长期 artifact 仍使用 exact GitHub Release；
- 确认 promotion 权限和触发方式。

验收：

- lock schema、tag 格式、三种场景和 PR 顺序无未决冲突；
- 未改动生产流程。

回滚：仅文档 revert。

### PR-1：建立 distribution-neutral artifact contract

目标：在不改变 Flutter 消费路径的前提下，先产出可确定验证的新 artifact。

范围：

- 生成 `runtime-artifact.json`；
- tag helper 改为 exact source commit 语义；
- 增加 `contentSha256` 及 Node/Dart 共用 golden fixture；
- 固定 build ID、builtAt、tar/gzip 参数；
- 增加相同 commit 重复构建 SHA 一致测试；
- 增加显式 promotion workflow，但暂不关闭旧 dev Release。

PR-1 的 Node/Dart 共享 golden fixture 只冻结 canonical `contentSha256` 的输入和结果；Dart 端消费该 fixture 的 verifier/test 明确留给 PR-2。PR-2 在 lock/vendor 迁移完成前不得将该门槛视为通过。

验收：

- exact commit 可重复 promotion；
- 已存在 tag 内容不一致时失败；
- 普通验证 artifact 与 promoted artifact 共享同一 builder；
- 现有 Flutter 路径仍可工作。

回滚：移除新 promotion 入口，不影响旧路径。

### PR-2：引入 lock 与 exact vendor 工具

目标：建立新消费路径并迁移一个真实 artifact。

#### 当前执行状态（本工作树）

锁模型、exact artifact 消费、离线 verifier、canonical digest、HTML/兼容性
校验、atomic materialize 和本地未发布 artifact 测试框架已经实现。首个
exact source commit 已完成 protected promotion、远端 metadata/archive/sidecar
逐字节复核，并已提交 `richtext-runtime.lock.json`、vendor 和 manifest。
后续更新仍必须重复同一 exact promotion 与远端证据流程。

范围：

- 新增 `richtext-runtime.lock.json` model/parser；
- 实现 `--update --release-tag`、`--from-artifact` 和新的 `--verify`；
- 保留并清理 `--local`，不再合成 Release metadata；
- 复用 archive cache、安全解压、compatibility、atomic materialize；
- codegen 改为 lock + runtime-version；
- 用一个 promoted artifact 更新 lock、vendor、manifest；
- CI 同时运行新 locked verify；
- PR-3/PR-4 已删除旧 latest/channel/publisher 入口；历史 Releases 仅保留供审计。

PR-2 必须读取 `scripts/fixtures/runtime-content-sha256.json`（或由同一 fixture 生成的受控副本），以 Dart 实现复算并验证至少一个真实 vendored runtime tree；否则 canonical digest 契约未完成，不能进入 PR-3。

PR-1 publisher 只校验 artifact metadata、checksum sidecar、archive bytes 和
Release assets 的逐字节一致性，不在发布阶段解包 archive 或重算
`contentSha256`。PR-2 的 Dart verifier 必须在安全解包后独立重算
`contentSha256`，并将该结果与 metadata、lock 和真实 vendored tree 对比；这
是进入 PR-3 前的强制门槛。

本次 PR-2 工作树的首个 pin 已由 promotion workflow 对 exact source commit
完成，并通过远端 metadata、archive 和 sidecar 的逐字节复核；随后使用
`--update --release-tag ...` 生成并提交 lock、vendor 和 manifest。受控
`--from-artifact` 仍仅用于本地迁移/测试，不构成正式 pin 证据。

验收：

- fresh checkout 的 locked verify 离线通过；
- exact update 重复执行无 diff；
- 错误 tag/SHA/content/protocol/host envelope 均失败；
- local materialization 不写 lock；
- 首个 lock/vendor PR 可清楚审查来源和 bytes 变化。

回滚：revert lock/vendor 迁移或显式 pin 到已知良好的 promoted artifact；不得恢复
floating selector 或修改既有 promoted artifact。

### PR-3：切换 CI，停止 floating 发布与解析

目标：让新模型成为唯一生产路径。

范围：

- `dev` push 只上传短期 Actions artifact，不创建 Release；
- promotion 仅通过显式 exact commit 触发；
- 默认 prepare 不再联网更新；
- 删除 Release 枚举、latest selection、branch identity 和 pipeline IID 逻辑；
- 删除 `richtext-runtime-channel.json`；
- Flutter publish job 强制 locked verify；
- 删除 latest 专属代码；保留 exact-tag 下载所需的 HTTPS client。

验收：

- 连续两次 `dev` push 不新增 GitHub Release；
- 任意 build/test/publish 路径均不能隐式改变 runtime；
- exact lock update 仍可成功；
- latest API 不可用不影响使用已 vendor runtime 的普通 Flutter 构建。

回滚：优先 revert PR-3 的生产切换提交；不得修改已有 promoted artifact。

### PR-4：文档、ADR 与历史数据收口

目标：消除双重语义和维护入口。

范围：

- 新 ADR 改为 accepted，ADR-0003 标记 superseded；
- 旧 branch Release 计划标记 superseded；
- 更新 runtime release、Flutter README 和维护命令；
- 收口 `docs/plans/richtext-link-popover.md`、`docs/plans/richtext-inline-embed-clipboard.md` 和 `docs/plans/todos.md` 中的旧 runtime 同步/发布模型引用，改为 explicit lock/vendor 维护说明；PR-0 不直接修改这些历史文档；
- 删除 vendored `runtime-release.json` 及兼容代码；
- 确认旧 channel Releases 的保留/归档策略，但不批量删除历史数据；
- 增加 lock update PR 模板与维护 runbook。

当前状态：已完成。历史 branch Release 不批量删除，但不再被任何选择器或
workflow 使用。

验收：

- 文档只描述一套生产流程；
- 仓库搜索不到仍可执行的 `resolveLatest`/channel 入口；
- 新维护者仅凭 README/runbook 能完成 local、integration、promotion、pin 和 rollback。

回滚：文档和兼容清理可单独 revert，不修改 lock identity。

## 17. 测试矩阵

### 17.1 Node artifact tests

- exact tag 从 full source commit 稳定生成。
- 相同 dist 两次打包 archive SHA 相同。
- 相同文件树的 content SHA 在 Node/Dart fixture 中相同。
- source commit、entry SHA、archive SHA 格式错误被拒绝。
- 缺失 HTML 引用、symlink、非普通文件被拒绝。
- 已存在 promotion tag 的相同 bytes 幂等成功、不同 bytes 失败。

### 17.2 Dart lock/delivery tests

- lock schema、required fields 和 exact tag/source commit 关系。
- exact Release 请求不枚举 Releases。
- token 不跨 origin redirect。
- archive cache 命中时重新散列，损坏时重新下载 exact artifact。
- checksum sidecar、artifact metadata、lock 三方不一致失败。
- path traversal、绝对路径、symlink、重复条目和大小限制。
- materialized content SHA、entry SHA 和资源引用。
- protocol/host envelope 不兼容失败。
- codegen 稳定且保留 exact artifact provenance。
- `--local` 不写 lock；`--verify` 能检测 local 与 locked vendor 不一致。
- 临时目录位于目标目录同一父目录，失败时旧 assets 可恢复。

### 17.3 CI/集成测试

- PR runtime build 不创建 Release。
- `dev` push 不创建 Release。
- promotion exact commit 创建一个不可变 Release。
- 重复 promotion 不产生第二个 Release。
- lock update PR 的三组派生文件同时变化。
- fresh checkout 不构建 Node runtime即可完成 Flutter analyze/test/example build。
- publish dry-run 包含 runtime assets、lock 所需诊断信息和 generated manifest。
- App 在断网条件下加载 vendored runtime。

## 18. 失败策略与回滚

### 18.1 失败策略

| 失败                                     | 行为                                                |
| ---------------------------------------- | --------------------------------------------------- |
| promotion source commit 不存在或不可访问 | 失败，不回退 branch HEAD                            |
| exact tag 已存在但 bytes 不同            | 失败并调查非确定性/篡改                             |
| GitHub API/下载不可用                    | update 失败，不改 lock/vendor                       |
| cache 损坏                               | 丢弃该 cache entry，重新下载同一 exact artifact     |
| archive/metadata/checksum 不一致         | 失败，不 materialize                                |
| runtime 与 Flutter 协议不兼容            | 失败，不写 lock                                     |
| materialize 中断                         | 恢复旧 assets；后续 verify 必须检测任何跨文件不一致 |
| publish 前 locked verify 失败            | 阻止发布，不自动修复或重新 pin                      |

### 18.2 回滚方式

未发布的 lock/vendor 更新：

- revert 对应 lock update commit/PR；或
- 新开 PR，显式 pin 到已知良好的 promoted artifact。

已发布的 Flutter package：

- 不能修改已发布版本；
- 在源码中恢复已知良好 lock/vendor；
- 完成验证后发布 patch version。

不得通过覆盖旧 tag、替换 Release asset 或改变同一 lock 内容回滚。

## 19. 可观测性与审计

每次 promotion 日志至少输出：

- repository；
- source commit；
- artifact tag；
- archive SHA-256；
- content SHA-256；
- protocol/host envelope；
- GitHub workflow run ID。

每次 lock update PR 描述至少包含：

- 旧/新 source commit；
- 旧/新 artifact tag；
- 旧/新 archive/content SHA；
- protocol/host envelope 是否变化；
- runtime 相关 changelog 或 source diff 链接；
- 本地/CI 验证结果。

App/package 诊断信息继续暴露 source commit、build ID、web entry、archive SHA 和协议版本。branch 与 pipeline IID 不再作为运行时身份。

## 20. 风险与权衡

### 两步变更增加维护动作

runtime source 合并与 lock/vendor 更新通常是两个显式步骤。代价是多一个 PR 或 promotion 动作；收益是 source 与二进制依赖关系可审查、可回滚、可复现。

### GitHub Release 仍是首期长期存储

这会继续产生 Release，但频率由“每次 dev push”降为“每次显式 runtime pin 候选”。首期优先复用现有成熟的 draft/upload/read-back 代码；存储迁移不是本次阻塞项。

### 本地联调会覆盖 tracked assets

首期选择不修改 Flutter loader，因此 local materialization 会在工作区产生 assets/manifest diff。工具必须醒目标记 local 状态，CI 必须阻止误提交为正式 pin。若使用体验仍差，再独立引入 ignored overlay。

### 三个 tracked 目标不是单个文件系统事务

assets 目录、lock 和 Dart manifest 无法一次 rename。实现以“全部预验证、单目标原子替换、最终只读 verify、CI fail closed”控制风险，不宣称不存在中断窗口。

## 21. 实施前待确认项

以下项目需要在 PR-0 评审时确定；本文给出建议默认值：

1. **promotion 权限**：建议仅 maintainers 可手动触发 `workflow_dispatch`。
2. **长期 tag 格式**：建议 `webview-runtime-artifact-<full sourceCommit>`。
3. **普通 CI artifact retention**：建议 7 天，仅用于诊断，不供 lock 长期解析。
4. **默认无参数命令**：建议只显示帮助并失败；如果团队偏好兼容，则等价于只读 `--verify`，绝不能更新。
5. **runtime_manifest 旧字段**：建议首期保留 nullable public 字段，后续单独评估删除。
6. **历史 channel Releases**：建议保留只读历史，不在迁移 PR 中批量删除。

这些选择不得改变“exact promotion + explicit lock + committed vendor”的主模型。

## 22. PR 细化模板

后续每个实施 PR 使用以下结构补充计划：

```markdown
### PR-x：<标题>

#### 目标

- <这个 PR 单独完成什么>

#### 非目标

- <明确不在该 PR 中做什么>

#### 变更文件

- `<path>`：<原因>

#### 行为变化

- Before：<旧行为>
- After：<新行为>

#### 数据/文件迁移

- <是否更新 lock、vendor、manifest>

#### 测试

- [ ] 单元测试
- [ ] 集成测试
- [ ] 重复运行无 diff
- [ ] 失败/回滚演练

#### 验收证据

- <命令、CI run、SHA、截图或日志摘要>

#### 回滚

- <准确回滚边界>

#### 后续 PR 接口

- <本 PR 为下一阶段提供的稳定契约>
```

## 23. Definition of Done

- [x] 新 ADR accepted，ADR-0003 superseded。
- [x] `richtext-runtime-channel.json` 删除。
- [x] `resolveLatest` 与 branch/pipeline Release identity 删除。
- [x] `richtext-runtime.lock.json` 成为唯一 artifact selector。
- [x] `dev` push 不再创建 GitHub Release。
- [x] exact promotion workflow 幂等且不可覆盖。
- [x] lock、archive、content、runtime-version、manifest 完整校验通过。
- [x] local development、Flutter integration、formal publish 文档和命令互不混淆。
- [x] Flutter fresh checkout 使用 committed vendor，无 Node/runtime 下载步骤。
- [x] publish dry-run 与离线 App runtime 验证通过。
- [x] rollback runbook 已演练。

---

本方案的最终边界可以概括为：

```text
开发分支决定“正在开发什么”；
promoted artifact 决定“哪些 bytes 可被固定引用”；
lock 决定“Flutter package 选择哪一个 artifact”；
vendored assets 决定“最终 App 实际运行哪些 bytes”。
```
