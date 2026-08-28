# TeamGaga Rich Text

Cross-platform rich-text editor packages for Flutter mobile, desktop, and Web.

## Architecture

```text
Flutter native toolbar
  -> richtext-protocol (versioned wire contract)
  -> richtext-host-web
  -> richtext-core (domain commands and state)
  -> richtext-quill
  -> richtext-delta

Optional desktop/Web toolbar
  -> richtext-solid-toolbar
  -> richtext-solid
  -> richtext-core -> richtext-quill -> richtext-delta
```

Package responsibilities:

- `@teamgaga/richtext-delta`: canonical document data and validation.
- `@teamgaga/richtext-core`: platform-independent editor commands, state, and events.
- `@teamgaga/richtext-quill`: Quill adapter.
- `@teamgaga/richtext-solid`: Solid editor runtime, context, lifecycle, and hooks; no toolbar UI.
- `@teamgaga/richtext-solid-toolbar`: optional desktop/PC Web toolbar UI.
- `@teamgaga/richtext-protocol`: versioned Flutter/WebView wire contract.
- `@teamgaga/richtext-host-web` (planned package name): WebView lifecycle and Protocol-to-Core mapping.

The shared cross-platform surface is command semantics, state, protocol, and document data—not buttons, popovers, pickers, or layout.

## Development and release guide

本仓库包含四类不同的交付物，发布方式不同：

| 目录                           | 交付物                         | 正式发布位置                      | 对应 workflow                                          |
| ------------------------------ | ------------------------------ | --------------------------------- | ------------------------------------------------------ |
| `packages/*`                   | TypeScript workspace library   | npm                               | 当前没有自动 npm 发布 workflow                         |
| `apps/playground`              | Playground 网站                | GitHub Pages                      | `Deploy Playground to GitHub Pages`                    |
| `apps/webview-runtime`         | Flutter 使用的 WebView runtime | GitHub Release immutable artifact | `WebView runtime` / `Promote WebView runtime artifact` |
| `clients/flutter_quill_editor` | Flutter package                | pub.dev                           | `Release Flutter package` + tag OIDC                   |

### 1. 公共准备

仓库使用 Vite+，不要在根目录直接用 `npm install` 替代 workspace 安装。
Node 版本需要满足 `package.json` 中的要求；CI 使用 Node 24。Flutter package
使用 `clients/flutter_quill_editor/.fvmrc` 指定的 Flutter 版本。

首次准备或拉取远端变更后执行：

```bash
vp install
```

全仓库快速验证：

```bash
vp run -r build
vp check
vp run -r test
```

启动 `apps/webview-runtime` 的开发服务器：

```bash
vp run dev
```

所有正式变更都先创建分支并提交 PR，合并到 `dev` 或 `main` 后再进行正式
发布。不要把本地 `dist`、Flutter `build` 或临时 runtime 直接当成发布产物。

### 2. 只修改 `packages/*`

#### 2.1 本地构建和测试

如果只改了 TypeScript package，先构建所有 workspace package，保证依赖包的
`dist` 是最新的：

```bash
vp install
vp run --filter './packages/*' build
vp check
vp run --filter './packages/*' test
```

也可以只验证一个包：

```bash
cd packages/<package-directory>
vp pack
vp check
vp test
```

例如，目录名和 npm 包名的关系是：

```text
packages/delta       -> @teamgaga/richtext-delta
packages/core        -> @teamgaga/richtext-core
packages/quill       -> @teamgaga/richtext-quill
packages/solid       -> @teamgaga/richtext-solid
packages/solid-toolbar -> @teamgaga/richtext-solid-toolbar
packages/protocol    -> @teamgaga/richtext-protocol
packages/host-web    -> @teamgaga/richtext-host-web
packages/testing     -> @teamgaga/richtext-testing
```

#### 2.2 提交 PR 后会发生什么

`packages/*` 是 WebView runtime 的输入。PR 和合并到 `dev`/`main` 后会触发
`WebView runtime` workflow，它会：

1. 构建 `apps/webview-runtime`；
2. 运行 package check、runtime contract test 和 dist 校验；
3. 上传短期 Actions artifact 供检查使用。

这个 workflow 只做验证，不会自动创建 GitHub Release，也不会自动发布 npm。
另外，`packages/*` 的变更会触发 Playground Pages 构建，因为 Playground 使用
这些 workspace package。

#### 2.3 发布到 npm

当前仓库没有 npm 自动版本管理或 npm 发布 workflow。确认 package 的
`package.json` 已更新版本号、依赖版本和发布元数据后，使用 npm 账号手动发布：

```bash
npm login
npm whoami

cd packages/<package-directory>
pnpm pack --dry-run
pnpm publish --access public
```

`pnpm publish` 会执行 package 的 `prepublishOnly`，再次构建 `dist`。如果一次
修改了多个包，先发布被依赖的包，再发布依赖它们的包，并逐个确认每个包的版本
已经递增。`workspace:*` 依赖会由 pnpm 在打包时转换，但依赖包必须先有可用的
公开版本。

如果修改的 package 被 `apps/webview-runtime` 使用，只发布 npm 包还不够：
Flutter package 中的 vendored runtime 仍然是旧版本。此时还要完成下面第 3.3
节的 runtime promotion，并运行第 5 节的 Flutter package 发布流程。

### 3. 修改 `apps/*` 的两个项目

#### 3.1 `apps/playground`

本地开发和生产构建：

```bash
vp run --filter playground dev
vp run --filter playground... build

# 使用 GitHub Pages 的 /flutter_quill_editor/ base path 构建
GITHUB_PAGES=true vp run --filter playground... build
```

构建结果在 `apps/playground/dist`。预览已构建的产物：

```bash
vp run --filter playground preview
```

将改动合并到 `dev` 或 `main` 后，`.github/workflows/playground-pages.yml` 会
自动构建并部署到 GitHub Pages。这个项目是 `private: true`，不执行 npm publish。
也可以在 GitHub Actions 中手动运行 `Deploy Playground to GitHub Pages`。

#### 3.2 `apps/webview-runtime`

这个项目是 Flutter WebView 使用的内部 runtime，不是直接发布到 npm 的应用。
本地构建并验证：

```bash
vp install
vp run --no-cache --filter webview-runtime... build
vp check
vp test scripts/runtime-artifact.test.mjs --run
node scripts/verify-runtime-dist.mjs
```

产物位于：

```text
apps/webview-runtime/dist
```

`runtime-release.yml` 会在相关 PR 以及 `dev`/`main` push 上自动执行同类构建和
Artifact Contract 验证，但普通 runtime CI 不会创建正式 Release。

#### 3.3 正式发布 WebView runtime

如果只需要把 runtime 晋升为可审计、不可覆盖的 GitHub Release，先把改动合并到
`main`，再从 `main` 的精确提交触发：

```bash
git fetch origin main
SOURCE_COMMIT=$(git rev-parse origin/main)

gh workflow run runtime-artifact-promotion.yml \
  --repo TeamGaga2/flutter_quill_editor \
  --ref main \
  -f sourceCommit="$SOURCE_COMMIT"
```

它会生成以下 immutable tag 和三个 Release asset：

```text
webview-runtime-artifact-<40-character-source-commit>
webview-runtime.tar.gz
runtime-artifact.json
webview-runtime.tar.gz.sha256
```

这个动作只发布 runtime artifact，不会更新 `clients/flutter_quill_editor` 的
lock、vendored assets 或 pub.dev 版本。若 runtime 要随 Flutter package 交付，
直接按第 5 节运行 `Release Flutter package` 更合适；该流程会按需自动执行 exact
runtime promotion，并把 runtime 写入 Flutter package。

### 4. 修改 `clients/flutter_quill_editor`

这里的目录名是复数 `clients`，实际 Flutter package 路径为
`clients/flutter_quill_editor`。

#### 4.1 只做本地验证

```bash
cd clients/flutter_quill_editor
flutter pub get
dart run tool/richtext_runtime_prepare.dart --verify
flutter analyze
flutter test

cd example
flutter pub get
flutter build web

cd ..
flutter pub publish --dry-run
```

运行 bundled example：

```bash
cd clients/flutter_quill_editor/example
flutter run
```

PR、以及合并到 `dev`/`main` 后，`Flutter client` workflow 会自动执行依赖解析、
exact lock/runtime 校验、analyze、test、example Web 构建和 pub dry-run。仅通过
这些检查不会发布新版本。

本地联调如果需要使用刚构建的 WebView runtime，应使用明确的临时输入：

```bash
cd clients/flutter_quill_editor
dart run tool/richtext_runtime_prepare.dart \
  --local ../../apps/webview-runtime/dist
```

`--local` 只用于联调，不更新正式 lock，也不能用来发布。正式 package 必须使用
已晋升的 exact Release；不要手工编辑 hash 命名的 runtime asset、
`richtext-runtime.lock.json` 或生成的 runtime manifest。完整联调说明见
[Flutter client local integration runbook](docs/runbooks/flutter-local-integration.md)。

#### 4.2 正式发布 Flutter package

`flutter_quill_editor` 的正式发布入口是 GitHub Actions：

```text
Actions → Release Flutter package → Run workflow
选择 bump: patch / minor / major → Run workflow
```

也可以使用 CLI：

```bash
gh workflow run release-flutter-package.yml \
  --repo TeamGaga2/flutter_quill_editor \
  --ref main \
  -f bump=patch
```

工作流会自动完成：

1. 锁定触发时的 `main` SHA，计算下一个版本并生成 CHANGELOG；
2. 如果 `packages/*` 或 `apps/webview-runtime/*` 改变了 runtime，构建并复用/创建
   对应的 exact immutable runtime Release；否则复用当前 lock 指向的 runtime；
3. 更新 Flutter package 的 exact lock、vendored runtime 和 manifest；
4. 运行 offline verify、Flutter analyze/test、example Web 构建和 package dry-run；
5. 创建只包含允许文件的自动 release PR，等待 checks 后自动 squash merge；
6. 校验合并提交，创建 annotated `dart-vX.Y.Z` tag 和 GitHub Release；
7. 由 tag 触发 pub.dev 官方 OIDC workflow 发布 package。

整个流程结束后可检查：

```bash
gh run list --repo TeamGaga2/flutter_quill_editor --limit 10
curl -fsSL https://pub.dev/api/packages/flutter_quill_editor \
  | jq '{latest: .latest.version}'
```

首次创建 pub.dev package 时需要先手动发布 bootstrap 版本；本仓库的 bootstrap
版本已经完成。后续发布不需要 `PUB_ACCESS_TOKEN`，不要把 token 写入仓库或
GitHub Actions。

### 5. 按修改目录选择流程

```text
只改 packages/*
  ├─ 需要 npm package -> 本地 build/check/test -> pnpm publish
  └─ 会影响 WebView runtime -> 合并后运行 Release Flutter package
                         （同时 exact promotion + pub.dev 发布）

只改 apps/playground
  └─ 本地 build -> 合并到 dev/main -> 自动 GitHub Pages 部署

只改 apps/webview-runtime
  ├─ 只要 runtime Release -> runtime-artifact-promotion.yml
  └─ 要让 Flutter 用户拿到新 runtime -> Release Flutter package

只改 clients/flutter_quill_editor
  ├─ 只验证 -> flutter client CI
  └─ 发布新版本 -> Release Flutter package
```

更底层的 runtime identity、Artifact Contract、回滚和异常恢复规则见
[WebView runtime release](docs/runtime-release.md) 和
[runtime artifact promotion runbook](docs/runbooks/runtime-artifact-promotion.md)。
