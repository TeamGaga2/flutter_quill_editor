---
status: accepted
---

# 0009：Flutter package 一键发布与 OIDC

日期：2026-08-27

## 决策

`flutter_quill_editor` 使用 `.github/workflows/release-flutter-package.yml`
作为唯一的一键发布入口。发布人只选择 `patch`、`minor` 或 `major` 并从
`main` 点击一次；工作流自动计算稳定 SemVer、从上一个 `dart-v*` tag 之后
的提交生成 Changelog、按需提升 exact runtime artifact、生成证据 PR、等待
检查并 squash merge。

现有 `.github/workflows/runtime-artifact-promotion.yml` 同时保留
`workflow_dispatch` 手动入口，并增加 `workflow_call`，因此一键流程复用同一
套 deterministic build、Artifact Contract、immutable Release 和 byte
verification 逻辑，而不是复制 publisher。

合并后的 `release-finalizer.yml` 只接受工具生成的 release commit、允许的
package/runtime 文件集合和单步版本升级。它使用只安装到本仓库的 GitHub App
查询该 merge commit 关联的唯一 PR，并验证 PR 由该 App bot 创建、base 为
`main`、head 为生成的 release branch、状态为 merged 且标题精确匹配版本，
之后才创建 annotated `dart-vX.Y.Z` tag 和 GitHub Release；tag 事件再触发官方
pub.dev OIDC reusable workflow。发布不使用 `PUB_ACCESS_TOKEN`。

## 安全边界

- workflow dispatch 是唯一的人为发布授权；机器门禁替代第二次人工审批。
- `RELEASE_APP_ID` 使用 Actions variable；`RELEASE_APP_PRIVATE_KEY` 使用
  repository 或 `release-automation` Environment secret，真实值不进仓库。
- App 仅授予 Contents/PR/Issues read/write、Checks/Actions read-only 与
  Metadata read-only，且只安装到本仓库；Checks/Actions 只用于观察检查和
  workflow 结论。敏感 workflow、finalizer 和 release tooling 由
  `.github/CODEOWNERS` 保护。
- `main`、发布 tag、promotion Environment 和必需检查必须由管理员在 GitHub
  设置中启用；本 ADR 不授权工作流自行修改这些远端设置。

## 运行时与幂等性

一键流程把当前 `main` 精确 SHA 作为 runtime source。只有自上一个 lock
source commit 以来命中 runtime input 路径时才调用 promotion；否则复用当前
lock 的 exact tag，不创建重复 runtime Release。promotion、lock update、
offline verify、证据采集和 finalizer 都 fail closed，重复运行只能观察到相同
字节并成功，不能覆盖已有 tag、Release 或 package 版本。
如果等待期间 `main` 变化，工作流会关闭旧自动 PR、删除对应 release branch，
通过带有 `client_payload.bump` 与 `client_payload.attempt` 的内部
`repository_dispatch` 以相同 bump 从 `main` 重新 dispatch；attempt 从 0 开始、
每次递增且最多自动重启三次，超过后 fail closed。手动 workflow_dispatch UI
只暴露 bump；automation/flutter-release-* 分支只允许本仓库 Release App 创建、
更新和删除。

## pub.dev 首次发布

pub.dev 官方 OIDC 自动发布只支持已有 package。仓库首次启用时必须手动登录
并发布当前 `0.1.1`；完成后在 pub.dev Admin 中启用 GitHub Actions，仓库填写
`TeamGaga2/flutter_quill_editor`，GitHub Environment 填写 `pub.dev`，tag
pattern 填写 `dart-v{{version}}`。GitHub 中必须创建同名 `pub.dev`
Environment，不设置 reviewer，并且只允许 `dart-v*` tag 部署。

## 后果

日常发布从多个手工动作收敛为一次 workflow dispatch；审计信息仍通过 PR、
immutable runtime Release、GitHub Release 和 workflow run 保留。代价是首次
需要管理员完成 App、分支/标签保护和 pub.dev OIDC 配置，并且长期 release
workflow 仍属于受 Code Owners 保护的安全边界。
