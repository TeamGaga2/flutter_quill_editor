# 0001: WebView 主题契约（theme 注入 → html class → token 子集）

Webview 富文本编辑器未适配系统主题切换：dark 模式下 shell 背景色（由 Flutter 同步）已变暗，但**内容层文字/占位符/引用/链接/列表仍是硬编码浅色**（`#1f2937`、`#9ca3af` 等），且 style.css 无主题变量。决定：

1. **Flutter 注入生效亮度**：`Theme.of(context).brightness`（含 AdaptiveTheme 跟随系统/手动三档的解析结果）通过 `__TG_RICHTEXT_CONFIG__.theme`（"light"|"dark"）注入；runtime 启动时映射为 `<html>` 上的 `tg-theme-light` / `tg-theme-dark` class，`:root` 为亮色默认、`html.tg-theme-dark` 覆盖暗色。
2. **token 子集变量化**：`style.css` 只 copy Flutter 端富文本编辑器实际用到的 design tokens（22 个 + 2 个派生：`--tgg-primary03-active`、`--tgg-quote-text`），不引入全量色板；所有内容色引用 `var(--tgg-*)`。
3. **背景保持 shell 同步架构**：页面背景继续由 Flutter 传 `shellBackgroundColor`（token 化背景色）注入 `HOST_EDITOR_STYLE`（`!important`），主题切换时 Flutter 重新注入新 shell 色——webview 不自己管页面背景。
4. **bootstrap 注入的 host style 内容色一律用 `var(--tgg-*)`**：这些规则 `!important` 且最后加载，若写死颜色会覆盖 style.css 的主题变量、导致 dark 失效。
5. **实时切换走轻量注入**：`didChangeDependencies` 监听亮度/shell 色变化 → `runJavaScript` 切 class + 重跑 bootstrap（幂等），不进编辑器内容协议。

## Considered Options

- **class vs 既有 `data-theme` attribute**：runtime 已有 `#app.dataset.theme` 占位，但样式表同时覆盖 `html/body`，attribute 只能挂在 `#app` 上；选 class 挂在 `<html>` 上，`dataset.theme` 保留为调试标记。
- **实时切换走协议 vs 轻量注入**：主题是 UI 壳层状态、不属于编辑器内容协议域，选 `runJavaScript` 直切；不给 host 加 `set_theme` 命令、不动协议版本。
- **token 子集 vs 全量**：`tokens.g.dart` 有数百个 token，webview 只复制编辑器用到的（含错误/调试面），避免两端调色时全量同步漂移；新颜色需求先确认是否属编辑器域再补。
- **host style 直接注入两套色值 vs 引用 CSS 变量**：变量引用让主题 class 切换时全部自动重算，无需 Flutter 维护双份色板。

## Consequences

- `style.css` 的 token 列表需与 Flutter 侧编辑器 token 使用保持同步（注释已标注来源）。
- Flutter 侧 bootstrap 模板（`webview_flutter_transport.dart`）与 `scripts/flutter-inject-template.js` 锁步，改一处必须改两处；`dist/index.html` 的内联 race-safety 脚本由 `scripts/inject-bootstrap.mjs` 在 build 后自动注入（幂等）。
- `HOST_EDITOR_STYLE` 依赖 `:root` 变量存在：若未来 style.css 重构删变量，注入样式会失效（选择器降级为无颜色），需同步检查。
- 视频播放遮罩（`rgba(0,0,0,0.6)`）等非 token 语义色保持硬编码。
