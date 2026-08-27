# WebView runtime and Flutter package release

## One-click package release

日常 `flutter_quill_editor` 发布入口是
`.github/workflows/release-flutter-package.yml`。在 `main` 上点击 **Run
workflow**，只选择 `patch`、`minor` 或 `major`。工作流会自动：

1. 锁定当前 `main` 的完整 SHA，计算下一稳定版本并从上一个 `dart-v*`
   tag 后的提交生成 Changelog；
2. 仅当 runtime input 发生变化时调用现有 exact promotion workflow，保留
   Artifact Contract、immutable Release、远端三资产回读和 byte verification；
3. 用 exact tag 更新 lock、vendored runtime 和生成 manifest，执行 offline
   verify、Vite+、Flutter、example Web 和 `flutter pub publish --dry-run`；
4. 创建包含完整机器证据的 release PR，等待全部检查后自动 squash merge；
5. 由 `release-finalizer.yml` 校验合并提交，创建 annotated `dart-vX.Y.Z`
   和 GitHub Release；
6. 由 tag 触发的官方 pub.dev OIDC workflow 完成发布。

如果 `main` 在等待期间变化，流程会关闭旧自动 PR、删除对应 release branch，
并从新的 `main` 通过携带 `bump` 与 `attempt` 的内部 `repository_dispatch` 自动
重新 dispatch 相同 bump（attempt 从 0 开始、每次递增，最多三次）；手动 UI 只
显示 bump。超过限制、检查失败、
目标版本/tag 已存在、PR 出现额外文件或任何 artifact/Release 字节不一致时
fail closed，不会发布。并发运行使用固定 package release 锁；已有相同 PR、tag
或 Release 只在身份和字节完全一致时幂等成功。

一次性外部配置和首次授权见[发布自动化安全策略](security/release-automation.md)
以及 [ADR 0009](adr/0009-one-click-flutter-package-release.md)。首次 pub.dev
版本仍必须人工发布当前 `0.1.1`；GitHub Environment `pub.dev` 必须无 reviewer、
仅允许 `dart-v*` tag，并在 pub.dev Admin 中绑定同名 environment。之后不再需要
`PUB_ACCESS_TOKEN`。

The repository has two separate runtime workflows:

1. Ordinary pull-request and `dev`/`main` pushes run the runtime checks and
   upload short-lived GitHub Actions artifacts for diagnostics. They never
   create or update a GitHub Release.
2. The protected `runtime-artifact-promotion.yml` workflow is manually
   dispatched with one full `sourceCommit`. After the
   `runtime-artifact-promotion` Environment approval, it builds that exact
   commit and publishes the immutable Release tag
   `webview-runtime-artifact-<sourceCommit>`.

   The same workflow is also callable by the package release orchestrator.
   Its manual `workflow_dispatch` entry remains available for runtime-only
   promotion and recovery; the one-click package path authorizes the complete
   sequence at its initial dispatch and does not wait for a second interactive
   approval.

The promoted Release contains exactly:

- `webview-runtime.tar.gz`;
- `runtime-artifact.json`;
- `webview-runtime.tar.gz.sha256`.

The metadata contains only distribution-neutral runtime identity: source
commit, build ID, protocol versions, entry information, archive SHA-256 and
canonical content SHA-256. Branch names, pipeline numbers and latest ordering
are not artifact identity.

## Flutter package updates

`clients/flutter_quill_editor/richtext-runtime.lock.json` is the only runtime
selector. A formal update names an exact promoted tag:

```sh
cd clients/flutter_quill_editor
dart run tool/richtext_runtime_prepare.dart \
  --update \
  --release-tag webview-runtime-artifact-<sourceCommit>
```

The update verifies the remote Release, safely extracts the archive, checks
the runtime identity and content digest, and atomically updates the lock,
vendored assets and generated manifest. Normal verification is offline:

```sh
dart run tool/richtext_runtime_prepare.dart --verify
flutter analyze
flutter test
```

For local Flutter integration, use `--local <distPath>`. It is ephemeral,
does not write the formal lock and must not be published. There is no branch,
latest or legacy fallback path.

See the [promotion, pin, verification and rollback runbook](runbooks/runtime-artifact-promotion.md)
and [ADR 0007](adr/0007-flutter-package-locks-immutable-runtime-artifact.md).
