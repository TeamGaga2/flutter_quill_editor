---
status: accepted
---

# Client 构建跟随指定分支的最新 runtime Release

`teamgaga-client` 不再提交从 sibling `teamgaga-richtext` 仓库手工同步的 WebView runtime。client 改为配置一个运行时发布通道，并在显式 pre-build 阶段解析该 richtext 分支最新一次成功发布的 GitLab Release，下载和校验其预制包，再作为 Flutter assets 打进 App。

这里的“最新”指目标分支最新一次通过发布检查的制品，不是该分支尚未构建或构建失败的最新 commit。一次 client 构建只解析一次 Release，并在该次构建的所有平台产物中使用同一 commit 和同一内容摘要；App 安装后仍完全离线加载自身 assets。

该选择有意放弃 client commit 与 runtime 字节内容的一一对应关系：同一个 client commit 在不同时间构建，可能得到不同 runtime。为了能够定位问题，每个 App 构建必须记录实际解析到的分支、Release、source commit、pipeline 和内容摘要。无法查询最新成功 Release、下载失败或校验不一致时必须终止构建，不得静默使用旧缓存冒充“最新”。

当前 Flutter stable 的 Build Hooks 不能通过正式 DataAsset 协议产出 HTML、JavaScript 和 CSS，因此使用显式 pre-build，不依赖 hook 写入源码目录的副作用。本决定取代 [ADR 0002](./0002-runtime-css-owns-stable-richtext-styles.md) 中的手工同步契约，但不改变 runtime CSS 对稳定视觉样式的所有权。具体设计见 [分支 Release 交付计划](../plans/webview-runtime-branch-release-delivery.md)。

## Considered Options

- client 固定具体 runtime 版本：构建更容易复现，但不符合 client 自动跟随分支最新制品的目标。
- 继续提交 runtime 构建产物：无需构建时访问 GitLab，但保留了容易遗漏的跨仓手工同步。
- 使用 Build Hook 下载普通 Web assets：当前 Flutter stable 没有受支持的 DataAsset 交付能力，因此暂不采用。

## Consequences

- 每次正式 client 构建都需要先在线解析目标分支的最新成功 Release；归档缓存只能减少重复下载，不能替代 latest 查询。
- richtext 发布检查成为保护 client 构建的关键门槛；错误 Release 会影响此后所有跟随该分支的 client 构建。
- runtime 回滚通过在目标分支发布一个新的修复或回退制品完成，而不是修改 client 中的固定版本号。
