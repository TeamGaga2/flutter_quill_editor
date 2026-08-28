# WebView runtime artifact promotion, pin, verification, and rollback

> **Migration status:** PR-2, PR-3 and PR-4 are complete. The remote Release was
> byte-verified, the lock/vendor/manifest are committed together, ordinary
> runtime CI no longer publishes Releases, and Flutter consumes only the
> committed exact lock.

日常 Flutter package 发布现在由
`.github/workflows/release-flutter-package.yml` 编排。下面的 exact promotion、
远端证据、pin/vendor 和 rollback 规则仍是底层强制边界；手工 promotion 命令
保留用于 runtime 单独晋升、恢复和故障排查。

## 一键发布入口

一次性配置 GitHub App、`RELEASE_APP_CLIENT_ID` variable、
`RELEASE_APP_PRIVATE_KEY` repository/Environment secret、`main` 与
`dart-v*` 保护、GitHub Environment `pub.dev`（无 reviewer、仅允许
`dart-v*` tag）以及 pub.dev Admin 的同名 OIDC 绑定后，发布人只需在 `main` 上运行：

```text
Release Flutter package → bump: patch | minor | major → Run workflow
```

工作流会锁定 dispatch 时的 `main` SHA。它从当前 package version 和上一个
`dart-v*` tag 计算下一版本，依据提交生成 Changelog，并检测 lock source
commit 之后是否命中 runtime input 路径。命中时通过本文件第 2 节描述的同一
promotion workflow（`workflow_call`）创建/复用 immutable exact Release；未命中
时复用当前 lock 的 exact tag，不产生重复 runtime Release。

随后 exact-tag update、offline verify、Vite+ 和 Flutter 检查在临时 release
分支上完成，工作流生成包含 source/tag/hash/asset/命令证据的 PR。受限 App
token 创建 PR，工作流等待 PR checks，重新确认 `main` 和 PR head 未变化后
自动 squash merge；若 `main` 变化，则关闭旧自动 PR、删除 release branch，并
通过带有 `bump` 与 `attempt` 的内部 `repository_dispatch` 以相同 bump 自动
重新 dispatch，attempt 从 0 开始且最多三次；手动 workflow_dispatch UI 只显示
bump。合并后的 finalizer 只接受工具生成的允许文件集合和稳定的
单步版本升级，创建 annotated `dart-vX.Y.Z` 与 GitHub Release；该 tag 再触发
官方 pub.dev OIDC publisher。

首个 `flutter_quill_editor` 版本必须先手动登录并发布现有 `0.1.1`，因为
pub.dev 不允许 OIDC 自动创建新 package。启用 OIDC 后不要配置或恢复
`PUB_ACCESS_TOKEN`。

This runbook covers the three explicit maintenance actions in the target
model:

```text
exact source commit
  -> protected promotion
  -> exact lock update/vendor
  -> offline verification
  -> package release
```

[ADR 0007](../adr/0007-flutter-package-locks-immutable-runtime-artifact.md) is
accepted and [ADR 0003](../adr/0003-client-follows-branch-runtime-release.md)
is superseded. See the [implementation plan](../plans/webview-runtime-artifact-sync-implementation-plan.md)
and [runtime release contract](../runtime-release.md) for the boundaries.

## 1. Preconditions and authority

Only a maintainer who is authorized to approve runtime promotion should run
the formal flow. Before the first promotion, a repository administrator must
configure the GitHub Environment named exactly:

```text
runtime-artifact-promotion
```

The Environment must have all of the following:

- deployment branch/tag restrictions that allow only the trusted protected
  branch carrying the promotion workflow (for example, the repository's
  protected `dev`/`main` policy), and do not allow arbitrary pull-request refs;
- the repository's normal protected-branch and required-check rules in force.

For the one-click package flow, do not configure required reviewers on this
Environment: the workflow dispatch is the explicit human authorization and
the machine gates replace a second interactive approval. A repository may
still keep an independently reviewed standalone `workflow_dispatch` path if
its policy requires it, but that manual path must not add an approval that the
one-click workflow cannot complete.

The workflow intentionally gives the build job `contents: read` only. The
publish job receives `contents: write` only inside the promotion job. Do not
work around a missing Environment, branch restriction, or required-check
failure by running the publisher locally with a personal token. Stop and ask a
repository administrator to complete the configuration.

The source commit for a formal promotion must be:

- a full, lower-case 40-character commit SHA;
- the exact commit to be built, not a branch name or the current branch after
  the run starts;
- reachable from the protected `origin/dev` or `origin/main` history as
  required by the workflow;
- already reviewed/merged as the runtime source intended for promotion.

The promotion tag is deterministic:

```text
webview-runtime-artifact-<40-character sourceCommit>
```

An existing tag or Release is immutable. A rerun is allowed to succeed only
when the tag, target commit, and all three asset bytes match exactly. Never
delete/recreate a tag, replace a Release asset, or choose another tag to make a
failed promotion pass.

## 2. Promote the exact runtime commit

### 2.1 Start the protected workflow

From the GitHub Actions UI, select **Promote WebView runtime artifact**, use a
trusted protected workflow ref, and enter the full `sourceCommit` value. The
equivalent CLI invocation is:

```sh
REPO=TeamGaga2/flutter_quill_editor
SOURCE_COMMIT=<40-lowercase-hex-commit>

gh workflow run runtime-artifact-promotion.yml \
  --repo "$REPO" \
  --ref dev \
  -f sourceCommit="$SOURCE_COMMIT"
```

The `--ref` above is an example of the repository's protected workflow ref;
use the protected ref approved by repository policy. It does not select the
runtime. Only `sourceCommit` selects the runtime source.

Before approving the publish job, inspect the build job log and record:

1. the checkout result (`HEAD == sourceCommit`);
2. the successful protected-branch ancestry check;
3. the build and dist validation result;
4. the generated `runtime-artifact.json` fields;
5. the generated archive SHA-256, content SHA-256, and archive size;
6. the short-lived three-file promotion input name and workflow run ID.

The promotion input must contain exactly these files, with these names:

```text
webview-runtime.tar.gz
runtime-artifact.json
webview-runtime.tar.gz.sha256
```

The metadata must identify the same `sourceCommit` and expected protocol and
host envelope versions. The builder/publisher does not treat a branch name,
run number, timestamp, or latest Release ordering as identity.

### 2.2 Approve and inspect the publish job

Approve the publish job only after the build evidence is recorded. The
publisher creates or reuses the exact tag, uploads the three assets, reads them
back, and publishes only after every byte matches. A successful log is useful
but is not a substitute for recording the exact remote evidence below.

If the job fails because an existing tag or asset differs, stop. Preserve the
run URL and mismatch details for investigation. Do not retry with a different
source commit under the same intended change and do not mutate the existing
Release.

## 3. Required remote byte evidence

For every promoted artifact, attach evidence to the promotion record and to
the subsequent lock-update PR. Evidence must be obtained from the real GitHub
tag/Release and downloaded assets; a Release title, URL, or local cache alone
is not proof.

Set the values used by the examples below after the workflow succeeds:

```sh
REPO=TeamGaga2/flutter_quill_editor
SOURCE_COMMIT=<40-lowercase-hex-commit>
TAG=webview-runtime-artifact-$SOURCE_COMMIT
```

### 3.1 Tag/ref identity

Query the real tag ref and resolve both lightweight and annotated tag forms if
necessary:

```sh
gh api "repos/$REPO/git/ref/tags/$TAG"
gh api "repos/$REPO/releases/tags/$TAG"
```

Record the following values:

| Evidence                                                     | Required value           |
| ------------------------------------------------------------ | ------------------------ |
| Release `tag_name`                                           | exactly `$TAG`           |
| tag ref target, resolved through an annotated tag if present | exactly `$SOURCE_COMMIT` |
| Release target commit, when present                          | exactly `$SOURCE_COMMIT` |
| Release state                                                | published, not draft     |
| Release ID and URL                                           | recorded for audit       |
| promotion workflow run ID                                    | recorded for audit       |

If the tag object is annotated, do not compare the annotated tag-object SHA
directly with the source commit. Resolve its `object.sha` through
`/git/tags/<tag-object-sha>` and record the final commit SHA.

### 3.2 Three asset bytes

Download the assets from the exact Release into a new temporary directory. Do
not use an Actions artifact, cache entry, or a URL copied from another Release
as a substitute:

```sh
TMP_DIR=$(mktemp -d)
gh release download "$TAG" \
  --repo "$REPO" \
  --pattern 'webview-runtime.tar.gz' \
  --pattern 'runtime-artifact.json' \
  --pattern 'webview-runtime.tar.gz.sha256' \
  --dir "$TMP_DIR"

shasum -a 256 \
  "$TMP_DIR/webview-runtime.tar.gz" \
  "$TMP_DIR/runtime-artifact.json" \
  "$TMP_DIR/webview-runtime.tar.gz.sha256"
```

Record a row for every asset containing its Release asset ID/download URL,
byte length, expected SHA-256 from the promotion build, and observed SHA-256
of the downloaded bytes. The following relationships must all be proven:

| Asset                           | Byte-level requirement                                                                                                                  |
| ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `runtime-artifact.json`         | downloaded bytes are byte-for-byte identical to the metadata produced by the promotion build; parsed `sourceCommit` is `$SOURCE_COMMIT` |
| `webview-runtime.tar.gz`        | downloaded SHA equals `runtime-artifact.json.archiveSha256` and the recorded build SHA                                                  |
| `webview-runtime.tar.gz.sha256` | file bytes are exactly `archiveSha256 + two spaces + webview-runtime.tar.gz + newline`                                                  |

For the sidecar, the expected text can be checked without exposing any
credentials:

```sh
ARCHIVE_SHA=$(jq -r '.archiveSha256' "$TMP_DIR/runtime-artifact.json")
printf '%s  webview-runtime.tar.gz\n' "$ARCHIVE_SHA" \
  | cmp -s - "$TMP_DIR/webview-runtime.tar.gz.sha256"
```

Also record the metadata values for `contentSha256`, `buildId`, `webEntry`,
`webEntrySha256`, `protocolVersion`, and `hostEnvelopeVersion`. The publisher
proves the metadata/archive/sidecar and remote asset bytes. The Flutter PR-2
verifier must additionally unpack the archive safely and independently
recompute `contentSha256` against the real vendored tree; do not claim that
promotion alone proves the content digest.

Do not include GitHub tokens, signed URLs, or authorization headers in the PR
description, log excerpt, or evidence file.

## 4. Pin and vendor after promotion

This is the step that completes the missing PR-2 remote proof. It must not be
run until the exact published tag/ref and all three remote assets have passed
the evidence checks above.

From the Flutter package root, run the exact-tag update on the branch containing
the PR-2 consumer implementation:

```sh
cd clients/flutter_quill_editor
dart run tool/richtext_runtime_prepare.dart \
  --update \
  --release-tag "$TAG"
```

`--update` must fetch only the named Release tag. It performs the following
before changing tracked output:

1. validates the repository, tag/source-commit relationship, and exact Release
   response;
2. downloads exactly the three expected assets and verifies their bytes;
3. validates the checksum sidecar and artifact metadata;
4. verifies archive limits, paths, duplicate entries, symlinks, HTML
   references, `runtime-version.json`, entry SHA, content SHA, and protocol/
   host-envelope compatibility;
5. extracts and validates in a temporary directory beside the destination;
6. atomically materializes `assets/richtext_webview_runtime/`;
7. regenerates `lib/host/runtime_manifest.dart`;
8. writes `richtext-runtime.lock.json` only as part of the formal update;
9. runs the final locked consistency check.

Review these three groups together; a formal update is incomplete if any group
is missing:

```text
clients/flutter_quill_editor/richtext-runtime.lock.json
clients/flutter_quill_editor/assets/richtext_webview_runtime/**
clients/flutter_quill_editor/lib/host/runtime_manifest.dart
```

The controlled local path remains test-only:

```sh
dart run tool/richtext_runtime_prepare.dart \
  --from-artifact <artifact-directory> \
  --release-tag "$TAG" \
  --allow-unpublished
```

`--from-artifact` is forbidden in CI, does not prove that a Release exists,
and does not write the formal lock. `--local <distPath>` is likewise an
ephemeral Flutter integration path. Neither is acceptable evidence for a
lock-update PR.

## 5. Verify and review the lock-update PR

Run the offline verifier after the exact update and before committing the
change:

```sh
cd clients/flutter_quill_editor
dart run tool/richtext_runtime_prepare.dart --verify
flutter analyze
flutter test
```

The default/no-argument path is intentionally read-only locked verification.
If the lock is absent, verification fails; there is no legacy fallback or
implicit network selection path.

The PR description must include old/new values for source commit, exact tag,
archive SHA, content SHA, protocol version, and host envelope version. It must
also include:

- the promotion run URL and Environment approval record;
- the resolved tag/ref commit evidence;
- all three remote asset byte hashes and sizes;
- the `--update` and `--verify` output summary;
- analyzer, package tests, and any relevant runtime integration evidence;
- a statement that no `--allow-unpublished`, branch/latest resolver, or
  fallback artifact was used.

Use the [runtime lock update PR template](../../.github/PULL_REQUEST_TEMPLATE/runtime-lock-update.md)
so reviewers can check the identity table and the three tracked output groups.

## 6. Rollback

### 6.1 Promotion failure or suspected artifact mismatch

- Stop the workflow and preserve the run URL, source commit, expected tag, and
  mismatch details.
- Do not delete or overwrite a tag or Release asset.
- Do not publish a lock update from a local cache or a different tag.
- If a draft Release was created but cannot be proved complete, leave it for
  administrator investigation according to repository policy; the immutable
  artifact contract does not require destructive cleanup.
- If the source build is non-deterministic, fix the builder and promote a new
  exact source commit only after review. Never mint a second tag for the same
  source commit to hide differing bytes.

### 6.2 Lock/vendor PR not merged

Close or revert the unmerged working-tree change. Keep the known-good
committed vendor intact. A local materialization is not a rollback and must not
be committed as a formal pin.

### 6.3 Lock/vendor change merged but package not released

Use a reviewed Git revert of the lock/vendor/manifest change, or open a new
lock-update PR that pins the previously known-good promoted tag. Re-run offline
`--verify` and the normal Flutter checks. Do not edit only the SHA fields or
hand-edit the generated manifest.

### 6.4 Package already released

An already-published package version cannot be changed in place. Restore the
known-good lock/vendor/manifest in source and publish a new patch version after
locked verification. Never replace the promoted artifact behind the old tag.

### 6.5 Partial materialization or interrupted update

Run `dart run tool/richtext_runtime_prepare.dart --verify`. If verification
fails, stop package publishing. Restore the last reviewed lock/vendor/manifest
set through a reviewed Git change, then verify again. The tool stages all
targets together and attempts to roll them back if a rename fails, but the
filesystem operations are not one OS-level cross-file transaction; the final
verify is therefore still the required detector for an interrupted
multi-file update.

## 7. Current migration boundary

The migration is complete:

- ordinary `dev`/`main` runtime workflows upload only short-lived Actions
  artifacts and never create Releases;
- only the explicit protected promotion workflow creates immutable exact-tag
  Releases;
- `richtext-runtime.lock.json` is the only runtime selector and all normal
  Flutter commands use committed vendor assets offline;
- the old channel file, latest resolver and legacy publisher are removed;
- historical branch Releases remain available for audit but are not selectable;
- a successful local `--from-artifact` or `--local` run is not a promotion or
  lock-update proof.
