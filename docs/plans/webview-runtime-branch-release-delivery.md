# WebView runtime 分支 Release 交付计划

## 状态

- 决策：[ADR 0003](../adr/0003-client-follows-branch-runtime-release.md)
- 当前阶段：代码实施完成，等待 GitLab 权限和 Jenkins 凭据配置后联调
- 当前生产方式：分支 Release + client 显式 pre-build；上线顺序必须先 richtext 发布、后 client 消费

## 目标流程

```text
flutter_quill_editor 目标分支
  commit → 检查/测试/构建 → commit Release
                                  │
                                  ▼
teamgaga-client
  branch channel → 显式 pre-build 查询最新成功 Release
                 → 下载/校验/物化 Flutter assets
                 → App 内离线加载
```

关键行为：

1. client 只配置要跟随的 richtext 分支，不固定 runtime 版本。
2. 每次正式构建在线查询该分支最新一次成功发布的制品。
3. 同一次构建解析结果固定，Android、iOS 等产物不得各自重新解析到不同 Release。
4. App 运行时不访问 GitLab 或 CDN。
5. 无法确认“最新”时失败，不自动使用上次构建的旧制品。

## 职责边界

### `flutter_quill_editor`

- 对允许发布的分支运行 runtime 检查、测试和构建。
- 每次成功发布都保留准确的 branch、commit、pipeline 和内容摘要。
- 创建一个不可变的 commit Release，并挂载完整预制包。

### `teamgaga-client`

- 提交目标分支配置。
- 在 Flutter 构建前解析一次最新成功 Release。
- 下载、校验、缓存和物化对应 assets。
- 把本次实际解析结果写入构建诊断信息和 runtime manifest。

### 明确禁止

- client 构建读取 sibling richtext checkout 或现场运行 Node 构建。
- 通过 `latest` 文件名覆盖旧 Release 内容。
- GitLab 查询失败时把本地旧缓存当作最新制品继续构建。
- App 安装后再联网更新 runtime。

## 发布端设计

### 发布范围

GitLab CI 只为明确允许的分支创建 runtime Release。第一阶段至少支持 `dev`；新增其他发布通道时必须在流水线 allowlist 中显式加入，不能让任意 feature branch 自动产生长期 Release。

### Release 身份

GitLab Release 基于 tag，不能直接绑定一个会移动的分支头。因此每次成功构建创建一个不可变 tag，格式为：

```text
webview-runtime-channel-<branch-slug>-<branch-hash>-<pipeline-iid>
```

- `branch-hash` 来自完整分支名，避免不同分支产生相同 slug；
- `pipeline-iid` 用于确定同一通道内的先后顺序；
- Release metadata 保存完整 branch、source commit、pipeline ID 和发布时间；
- tag 指向实际构建的 `CI_COMMIT_SHA`，不得指向查询时的新分支头。

“某分支最新制品”定义为：该 branch identity 下 pipeline IID 最大、且完整发布步骤成功的 Release。

### Release 内容

每个 Release 至少包含：

- `webview-runtime.tar.gz`：平台无关的完整 runtime；
- `runtime-release.json`：Release 的机器可读元数据；
- `webview-runtime.tar.gz.sha256`：归档摘要。

`runtime-release.json` 至少包含：

```json
{
  "branch": "dev",
  "sourceCommit": "<full commit sha>",
  "pipelineId": 1234,
  "releaseTag": "<generated tag>",
  "archiveSha256": "<64 lowercase hex characters>"
}
```

预制包继续包含 `runtime-version.json`、`index.html`、内容寻址 iframe 入口以及所有 HTML 引用的 JS、CSS、SVG 等资源。`runtime-version.json.sourceCommit` 必须与 Release metadata 一致。

### 发布顺序

1. 确认当前分支在发布 allowlist 中。
2. 使用固定依赖执行 `vp check`、runtime 测试和完整依赖闭包构建。
3. 校验 `runtime-version.json`、入口 SHA-256 和全部相对资源。
4. 生成归档、摘要和 `runtime-release.json`。
5. 将二进制存入 GitLab Generic Package Registry。
6. 回读并校验上传内容。
7. 最后创建 tag 与 GitLab Release，并挂载 package links。

只有第 7 步完成的记录才参与 client 的“最新成功 Release”解析。普通 CI Job Artifact 会过期，不作为长期下载源。

## Client 通道配置

新增并提交 `app/richtext-runtime-channel.json`：

```json
{
  "branch": "dev"
}
```

配置只表达 client 要跟随的发布通道，不保存 Release tag、source commit 或 archive SHA-256。切换分支需要 client 代码评审；同一分支内的 Release 更新不需要 client commit。

## 显式 pre-build

client 提供一个跨平台 Dart 准备工具，由仓库的正式 build/run/test wrapper 和 Jenkins 调用。它是查询、下载、校验、缓存和 Dart manifest 生成的唯一实现。

### 解析 latest

1. 读取通道配置并计算 branch identity。
2. 通过 GitLab API 查询该通道的 Release，按 pipeline IID 选择最新一条。
3. 下载并校验 `runtime-release.json`，确认完整分支名、tag、commit 和 pipeline 一致。
4. 将解析结果写入本次构建目录；该次构建后续步骤只使用此结果，不再次查询 latest。

解析必须在线完成。API 超时、鉴权失败、没有成功 Release 或 metadata 不一致时立即失败。

### 下载与校验

1. 以 `archiveSha256` 查找 `.dart_tool/richtext-runtime/<archiveSha256>/` 内容缓存。
2. 缓存命中时重新计算摘要；未命中时下载到临时文件。
3. 校验整包 SHA-256。
4. 拒绝绝对路径、`..`、越界链接和异常归档条目。
5. 解包到临时目录，校验 runtime manifest、入口摘要和所有相对资源。
6. 原子替换被 Git 忽略的 `app/assets/richtext_webview_runtime`。
7. 根据已解析 Release 生成被 Git 忽略的 `runtime_manifest.dart`，供现有 Flutter loader 编译使用。

缓存只避免重复下载。由于每次构建仍必须先查询 latest，默认模式不支持完全离线构建。

### 构建记录

每次构建记录以下信息，并确保可以从 App 诊断信息中读取：

- channel branch；
- Release tag；
- source commit；
- pipeline ID；
- archive SHA-256；
- runtime protocol 与 host envelope 版本。

这组记录用于解释“相同 client commit 为什么包含不同 runtime”，不作为下一次构建的 latest 来源。

## 构建接入

新增统一的 `just` 任务，例如：

- `richtext-runtime-prepare`；
- `richtext-runtime-verify`；
- `richtext-runtime-clean`。

接入要求：

- Jenkins 在 `fvm dart pub get` 之后、Android/iOS 构建之前只执行一次 prepare，两种产物复用同一解析结果；
- 仓库维护的 macOS、Windows 等构建脚本在调用 Flutter build 前执行 prepare；
- 本地正式 build/run/test wrapper 先执行 prepare；
- `app/assets/richtext_webview_runtime` 与生成的 Dart manifest 加入 `.gitignore`；
- 缺少 prepare 输出时，Flutter 构建必须明确失败，不能生成缺失 runtime 的安装包。

## 凭据

因为 pre-build 需要查询私有 GitLab Release API，Jenkins 使用只读 Project Access Token，本地开发使用个人访问令牌。token 由凭据库或环境注入，只放 HTTP header，不写入通道配置、URL query、日志、缓存或构建产物。

发布任务使用 GitLab CI Job Token。所有 API 和资源下载只接受预期的 `git.teamgaga.com` host。

## 失败与回滚

### 失败

- 目标分支没有成功 Release：构建失败。
- Release API 不可用：构建失败，即使本地存在旧缓存。
- 最新 Release 的归档下载失败：构建失败。
- 摘要、branch、commit、pipeline、manifest 或资源引用不一致：构建失败。
- 发布流水线失败：不创建 Release，因此 client 继续解析到此前最新成功 Release。

### 回滚

client 不保存固定 runtime 版本。回滚方式是在目标 richtext 分支 revert 问题变更并发布一个新的成功 Release；此后的 client 构建自动使用该回退内容。紧急隔离也可以让 client 通道配置切换到另一个受控分支，但这需要 client commit。

## 迁移顺序

### 阶段一：建立分支发布

1. 增加允许发布分支的 GitLab CI job。
2. 补齐 manifest 与资源完整性测试。
3. 为 `dev` 发布两个连续的候选 Release，验证 latest 顺序。

### 阶段二：接入 client

1. 增加通道配置和 Dart pre-build 工具。
2. 接入 Jenkins，并验证 APK 与 IPA 使用同一 Release。
3. 接入仓库维护的本地与桌面构建 wrapper。
4. 验证 Release 更新后无需 client commit 即可被下一次构建消费。

### 阶段三：移除旧路径

1. 从 client Git 删除 runtime HTML、JS、CSS 和 SVG 构建产物。
2. 将物化目录和生成的 Dart manifest 加入 `.gitignore`。
3. 删除 `tools/sync-richtext-runtime.sh`；将其中的校验迁移到 Dart 工具测试。
4. 更新 client 技术方案、runtime README 和构建文档。
5. 验证 fresh checkout、缓存命中、最新 Release 更新和失败阻断场景。

阶段一或阶段二未通过时，不执行阶段三。

## 验收标准

### 发布端

- 目标分支的成功 pipeline 创建带 commit 身份的 Release。
- 失败 pipeline 不创建 Release。
- 两次成功 pipeline 的 Release 顺序可以无歧义判断。
- Release metadata、tag、source commit、pipeline 和归档摘要一致。

### Client

- client 只配置 branch，不提交具体 Release 或 runtime 二进制。
- 每次正式构建查询并使用该 branch 最新成功 Release。
- 单次 Jenkins 构建中的 APK 与 IPA 使用相同 Release。
- 新 Release 出现后，下次构建无需 client commit 即可消费。
- API 不可用时不会用旧缓存冒充 latest。
- App 运行时不访问 GitLab 或 CDN。
- 构建产物可以追溯到准确的 branch、Release、commit、pipeline 和 SHA-256。

## 实施前置条件

- 确认自建 GitLab 版本支持 Generic Package Registry、Release API 和 Release asset link。
- 配置允许 CI 创建 `webview-runtime-channel-*` tag。
- 为 Jenkins 建立只读 Release API 与 package 下载凭据。
- 确认 `dev` 是第一阶段需要跟随的发布分支；其他分支必须显式加入 allowlist。

## 不在本次范围

- client 固定某个 runtime 版本；
- 完全离线的 latest 解析；
- App 运行时热更新 runtime；
- 自动发布任意 feature branch；
- Flutter master 的实验性 DataAsset；
- 发布后自动提交 client 仓库。
