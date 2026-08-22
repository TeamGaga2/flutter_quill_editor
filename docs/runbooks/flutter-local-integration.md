# Flutter 客户端本地联调

本文说明如何将本仓库的 TypeScript WebView runtime 与
/Users/cy/Downloads/projects/teamgaga-client 本地联调，重点覆盖 iOS
标题输入框和正文编辑器的键盘焦点滚动问题。

这是一条本地开发流程，不是发布流程。联调使用的 runtime 不具备正式
Release provenance，也不能直接用于发布 package。

## 1. 仓库和工具约定

本文假设两个仓库位于以下位置：

```sh
export RUNTIME_REPO=/Users/cy/Downloads/github/flutter_quill_editor
export CLIENT_REPO=/Users/cy/Downloads/projects/teamgaga-client
export FLUTTER_DART="$CLIENT_REPO/.fvm/flutter_sdk/bin/dart"
```

如果目录不同，只需要调整这三个变量。客户端当前使用 FVM 管理的
Flutter 版本；优先使用客户端仓库的 fvm 和 .fvm/flutter_sdk，避免混用
系统 Dart。

确认工具可用：

```sh
cd "$RUNTIME_REPO"
vp --version

cd "$CLIENT_REPO"
fvm flutter --version
fvm flutter devices
```

首次配置客户端时，按项目 README 完成一次初始化：

```sh
cd "$CLIENT_REPO"
just setup
just ci-initialize
```

## 2. 构建本地 WebView runtime

Flutter package 加载的是 vendored runtime assets，不会直接读取
apps/webview-runtime/src，也不会自动连接 runtime 的开发服务器。因此
每次修改 TypeScript、Quill adapter 或 runtime CSS 后，都必须重新构建：

```sh
cd "$RUNTIME_REPO"
vp run --filter webview-runtime... build
node scripts/verify-runtime-dist.mjs
```

成功后，构建产物位于：

```text
$RUNTIME_REPO/apps/webview-runtime/dist
```

verify-runtime-dist.mjs 应报告 protocol、host envelope、source commit
和 web entry。若这里失败，不要继续写入 Flutter package，应先修复
runtime 构建问题。

## 3. 将本地 runtime 写入 Flutter package

从 Flutter package 目录执行 --local：

```sh
cd "$RUNTIME_REPO/clients/flutter_quill_editor"
"$FLUTTER_DART" run tool/richtext_runtime_prepare.dart --local "$RUNTIME_REPO/apps/webview-runtime/dist"
```

该命令会更新以下本地联调输入：

```text
clients/flutter_quill_editor/assets/richtext_webview_runtime/**
clients/flutter_quill_editor/lib/host/runtime_manifest.dart
```

--local 的特点：

- 会校验 dist 内容和 runtime 入口；
- 不读取或写入 richtext-runtime.lock.json；
- 不写入正式 Release provenance；
- 输出明确的 ephemeral/non-publish 警告；
- 只适用于本地联调、迁移和测试。

不要在本地 runtime 尚未恢复时运行正式的 --verify。--verify 校验的是
正式 lock、vendored tree 和 manifest 三者的一致性；本地 --local 产物
通常不会匹配正式 lock。

## 4. 将客户端依赖切换到本地 package

编辑：

```text
$CLIENT_REPO/pubspec.yaml
```

保留其他 dependency overrides，只将 flutter_quill_editor 临时改为：

```yaml
dependency_overrides:
  flutter_quill_editor:
    path: ../../github/flutter_quill_editor/clients/flutter_quill_editor
```

这个 path 是相对于 $CLIENT_REPO 的。app/pubspec.yaml 中原有的
flutter_quill_editor: ^0.1.0 不需要修改。

重新解析 workspace 依赖：

```sh
cd "$CLIENT_REPO"
fvm flutter pub get
```

确认 lock 已经解析到本地 path：

```sh
rg -n -A8 '^  flutter_quill_editor:' "$CLIENT_REPO/pubspec.lock"
```

预期结果应包含：

```text
source: path
path: "../../github/flutter_quill_editor/clients/flutter_quill_editor"
```

不要手动编辑 pubspec.lock，让 flutter pub get 生成它。

## 5. 启动 iOS 客户端

这是一个 Dart workspace，workspace 根目录没有 lib/main.dart。启动实际
Flutter app 时必须进入 app 子目录：

```sh
cd "$CLIENT_REPO/app"
fvm flutter devices
fvm flutter run -d <ios-device-or-simulator-id>
```

首次启动可能需要较长时间进行 Xcode 编译。

不要只依赖 hot reload 来验证 runtime 版本。完成 --local 后应完整停止
并重新启动 App；native loader 会根据 runtime-version.json 的 stamp
检测并刷新 app-support cache。

## 6. 确认 App 确实加载了本地 runtime

Flutter 日志中应出现类似：

```text
RichTextWebView loading http://127.0.0.1:<port>/index.html
```

还可以从 iOS 模拟器的 App container 检查实际缓存的 runtime。先取得
当前 App 的 bundle ID 和 container；TeamGaga debug app 的 bundle ID
通常可从 Xcode 或 xcrun simctl listapps 查询：

```sh
DEVICE_ID=<ios-device-or-simulator-id>
BUNDLE_ID=com.teamgaga.tgg
APP_DATA=$(xcrun simctl get_app_container "$DEVICE_ID" "$BUNDLE_ID" data)
RUNTIME_CACHE="$APP_DATA/Library/Application Support/richtext_webview_runtime"
cat "$RUNTIME_CACHE/runtime-version.json"
```

将它与 package 内的版本文件比较：

```sh
cat "$RUNTIME_REPO/clients/flutter_quill_editor/assets/richtext_webview_runtime/runtime-version.json"
```

两者的以下字段应一致：

- sourceCommit；
- buildId；
- webEntry；
- webEntrySha256。

如果缓存仍是旧版本，先完整停止并重新启动 App。只有确认版本仍未
刷新时，才在测试模拟器上卸载 App 后重新运行；这会清除该模拟器上的
本地 App 数据。

## 7. iOS 焦点滚动验证清单

进入 TeamGaga 的富文本输入页面
（app/lib/pages/richtext/rich_text_input_page.dart），按以下顺序验证：

1. 点击标题输入框，键盘弹出后确认顶部标题栏和安全区域没有被整体
   推出屏幕；
2. 点击正文编辑器，确认正文可以获得焦点，页面顶层没有发生不必要
   的整体滚动；
3. 在正文中输入足够多的内容，使正文超出可视区域；
4. 在正文底部继续输入、回车，并反复切换标题和正文焦点；
5. 打开或关闭工具栏，执行插入操作，再次检查标题和顶部区域；
6. 收起键盘后重新聚焦标题和正文，确认页面没有保留错误的偏移。

预期的滚动所有权是：

```text
标题 textarea       -> 标题自身需要时滚动
正文编辑器          -> 正文 scroll container 滚动
html/body/window    -> 保持在根视口，不承担编辑器滚动
```

如果出现问题，优先记录以下信息：iOS 版本、设备类型、
runtime-version.json、Flutter 日志中的 runtime URL，以及复现时是标题
还是正文获得焦点。

## 8. 常见问题

### 在 runtime 根目录运行 Dart 工具找不到文件

richtext_runtime_prepare.dart 位于 Flutter package 目录，应从下面的
目录执行：

```sh
cd "$RUNTIME_REPO/clients/flutter_quill_editor"
"$FLUTTER_DART" run tool/richtext_runtime_prepare.dart --local <distPath>
```

### 在 workspace 根目录运行 flutter run 找不到 lib/main.dart

实际入口在 app：

```sh
cd "$CLIENT_REPO/app"
fvm flutter run -d <device-id>
```

### lock 仍显示 git source

确认根 pubspec.yaml 的 dependency_overrides 已切换为 path，然后从
$CLIENT_REPO 重新运行 fvm flutter pub get。不要手动改 lock。

### App 启动但编辑器仍是旧 runtime

检查 package 内和 App container 内的 runtime-version.json。如果版本
不同，完整重启 App；如果仍未刷新，在测试模拟器上卸载 App 后重新运行。

### --verify 失败

如果当前安装的是 --local 产物，这是预期现象，不代表本地 dist 构建
失败。--verify 只适用于正式 lock 对应的 vendored runtime。

## 9. 联调结束后的恢复

先检查两个仓库的改动：

```sh
cd "$RUNTIME_REPO"
git status --short

cd "$CLIENT_REPO"
git status --short
```

在 $CLIENT_REPO/pubspec.yaml 中将本地 path override 恢复为原来的 Git
override，然后重新获取依赖：

```sh
cd "$CLIENT_REPO"
fvm flutter pub get
```

--clean 只清理 runtime 准备过程遗留的临时目录，不会把本地 runtime
恢复成正式 vendored 版本：

```sh
cd "$RUNTIME_REPO/clients/flutter_quill_editor"
"$FLUTTER_DART" run tool/richtext_runtime_prepare.dart --clean
```

如果需要恢复本地 --local 改写的 runtime tree 和 manifest，先确认这些
文件没有其他未提交工作：

```sh
cd "$RUNTIME_REPO"
git diff -- clients/flutter_quill_editor/assets/richtext_webview_runtime clients/flutter_quill_editor/lib/host/runtime_manifest.dart
```

确认无其他改动后，再使用项目约定的 Git 恢复方式恢复对应生成文件，
最后运行正式校验：

```sh
cd "$RUNTIME_REPO/clients/flutter_quill_editor"
"$FLUTTER_DART" run tool/richtext_runtime_prepare.dart --verify
```

恢复前不要使用宽泛的 git restore，以免覆盖其他人的 runtime、package
或测试改动。
