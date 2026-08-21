---
status: accepted
---

# WebView 富文本稳定视觉样式由 runtime CSS 单点拥有

日期：2026-08-13

## 背景

WebView 富文本编辑器的稳定视觉规则曾同时存在于两个位置：

- `flutter_quill_editor/apps/webview-runtime/src/style.css`；
- `teamgaga-client/app/lib/richtext_webview/bridge/transport_bootstrap.dart` 运行时注入的高优先级 CSS。

Flutter 注入样式后加载，并广泛使用高优先级声明，因此会覆盖 runtime 中的正文、标题、链接、Mention、Channel、段落间距、标题输入框和工具栏样式。这会造成以下问题：

1. 浏览器中对齐正确的样式进入 App 后可能被旧注入规则覆盖；
2. 每次 Figma 调整都要同步修改两个仓库中的两份 CSS；
3. 两份规则无法通过普通的源码审查直观看出最终层叠结果；
4. Flutter 宿主的运行时职责与富文本内容的稳定视觉职责混在一起；
5. `teamgaga-client` 内嵌的是 runtime 构建产物，若忘记重建和同步，源码与 App 实际运行版本仍会漂移。

本次对齐所用的 Figma design token 已与 `teamgaga-client` 最新远程 `develop` 中的 Flutter token 核对。富文本涉及的字体、字号、行高、字重、字距及重点颜色一致，可以作为 WebView 样式依据。全量色板中存在的透明白色 token、inverse-opacity 命名碰撞和 Dark Dialog Container 差异不属于本次富文本使用范围。

## 决策

`apps/webview-runtime/src/style.css` 是 WebView 富文本稳定视觉规则的唯一实现来源。Flutter 宿主只提供运行时状态和宿主结构，不再注入正文、标题、链接、Mention、Channel、Divider、内容间距、标题输入框或工具栏等稳定视觉规则。

该决定部分取代 [ADR 0001](./0001-webview-theme-contract.md) 中“bootstrap 可以覆盖内容样式”的契约：

- 保留主题 class、token 子集、shell 背景同步和实时主题切换；
- 废止 bootstrap 对稳定内容样式的重复声明；
- 动态背景色或运行时 CSS 变量仍可由宿主提供，但不得顺带覆盖稳定排版和间距。

## 权威来源与优先级

稳定视觉规则按以下顺序追溯：

1. `apps/webview-runtime/src/figma.md`：本轮经过确认的 Figma 节点样式和平台差异；
2. `apps/webview-runtime/src/theme.css`：完整的 Figma design token 参考，不直接整体引入 runtime；
3. `apps/webview-runtime/src/style.css`：只复制实际使用的 token，并实现最终 WebView 样式；
4. `teamgaga-client` 的 Flutter bootstrap：只传递运行时值，不再作为稳定视觉来源；
5. `teamgaga-client/app/assets/richtext_webview_runtime`：由 runtime 构建并同步得到的发布产物，不得手工维护。

当 Figma 节点样式与旧 Flutter/WebView 样式冲突时，以最新 Figma 节点样式为准。Figma 没有提供的数据保持现状，不根据个人判断补造设计值。

## 职责边界

| 责任方               | 负责                                                                                                      | 不负责                                            |
| -------------------- | --------------------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| WebView runtime CSS  | design token 子集、字体、排版、颜色、块间距、内容 padding、最终内容对齐、标题和工具栏的稳定外观           | Flutter 页面结构、PlatformView 裁切、宿主背景状态 |
| WebView runtime 代码 | 根据 runtime config 设置 Light/Dark 与 Mobile/Desktop class，使 CSS 可以选择平台规则                      | 写入具体排版数值或复制稳定 CSS 字符串             |
| Flutter 宿主         | 主题、平台模式、shell 背景色、媒体尺寸、文案等运行时状态；PlatformView 的裁切、圆角、边框和必要结构 inset | 注入正文、标题、链接、嵌入节点或工具栏的稳定样式  |
| Client runtime 资产  | 承载经过构建、带版本指纹的 WebView runtime                                                                | 成为可直接手改的第三份样式源码                    |

Flutter 桌面卡片保留 10px padding。该值用于保护 PlatformView 的圆角、边框和裁切，不被定义为富文本内容 padding。runtime CSS 根据平台 class 补偿宿主结构差异，使移动端和桌面端获得相同的最终内容对齐。

## Token 子集

只将本次实际使用的语义 token 从 `theme.css` 拷贝到 `style.css`，同时提供 Light 和 Dark 值。不得为了方便而引入完整的 1200 行 token 文件。

| Figma token                                 | Light     | Dark      | 用途                                  |
| ------------------------------------------- | --------- | --------- | ------------------------------------- |
| `Schemes/On Surface`                        | `#171d19` | `#e4e8e3` | H1–H3、正文基础排版 T 与 Quote 派生色 |
| `Schemes/Surface Container Low`             | `#f5f5f4` | `#2c302d` | WebView 文档与 Flutter 容器的编辑表面 |
| `Extended Colors/Common Colors/Common Blue` | `#009dff` | `#009dff` | Link                                  |
| `Blue/Secondary`                            | `#0091ed` | `#0091ed` | Mention                               |
| `Primary/01`                                | `#009c64` | `#009c64` | Channel                               |
| `Schemes/Divider Low`                       | `#e3e8e5` | `#313532` | Divider                               |

runtime 中的局部 CSS 变量应保持语义可追溯，不能因为两个 token 当前色值相同就复用语义不同的变量。例如 Common Blue 与 Blue/Primary 即使当前同为 `#009dff`，仍应按 Figma 语义命名和引用。

## 编辑表面背景

WebView 文档与承载 PlatformView 的 Flutter 直接父容器共同构成编辑表面，Light/Dark 均使用 `Schemes/Surface Container Low`。runtime CSS 直接使用该 token 绘制 `html`、`body` 与根容器；Flutter 同时把自身 design token 传给容器、原生 WebView background API、首帧遮罩和 `shellBackgroundColor`。这种双层绘制用于覆盖 PlatformView 初始化和主题切换时序，不代表存在两个可独立选择的颜色来源。

不得让移动端回退到旧 `background03`，也不得让 runtime 依赖透明背景透出宿主颜色。主题变化时，Web CSS 与原生 WebView 背景必须同步更新。

## 字体与排版

正文基础排版 T 是段落、列表项和引用文字共享的文字语义。列表和引用只叠加自己的结构样式，不重新定义正文基础字体。

| 节点/平台 | 字体                          | 字号 | 行高 | 字重 | 字距 | 颜色               |
| --------- | ----------------------------- | ---: | ---: | ---: | ---: | ------------------ |
| H1        | PingFang SC + system fallback | 28px | 40px |  600 |    0 | Schemes/On Surface |
| H2        | PingFang SC + system fallback | 24px | 32px |  600 |    0 | Schemes/On Surface |
| H3        | PingFang SC + system fallback | 20px | 28px |  600 |    0 | Schemes/On Surface |
| Mobile T  | PingFang SC + system fallback | 16px | 24px |  400 |    0 | Schemes/On Surface |
| Desktop T | PingFang SC + system fallback | 14px | 20px |  400 |    0 | Schemes/On Surface |

`PingFang SC` 是首选字体。macOS/iOS 使用系统提供的 PingFang；Windows 等不具备该字体的平台使用系统中文字体 fallback。除非公司另行提供可用于 Web 分发的授权字体文件，否则不将 PingFang 打包进 runtime。

Figma 导出值需要转换为有效 CSS 语义：

- `font-style: Semibold` 和 `Regular` 通过 `font-weight` 表达，CSS `font-style` 保持 `normal`；
- `Letter Spacing/None` 及误写为 `Line Height/None` 的 H1 字距均解释为 `letter-spacing: 0`；
- `leading-trim: NONE` 不生成无效或非必要 CSS；
- 块级 T 的 `vertical-align: middle` 不作为布局规则；
- Link 的 `text-decoration-thickness: 0%` 不解释为隐藏下划线，保留可见的默认实线下划线。

## 最终内容对齐

“最终左距”从宿主中可见内容表面的左边缘量到文字、标题、列表 marker 区域或其他顶层内容块的共同起点。移动端和桌面端均为 16px。

| 平台与区域    | 宿主结构 inset | runtime 平台补偿 | runtime 内容 inset | 最终左距 |
| ------------- | -------------: | ---------------: | -----------------: | -------: |
| Desktop title |           10px |                0 |                6px |     16px |
| Desktop body  |           10px |                0 |                6px |     16px |
| Mobile title  |              0 |                0 |               16px |     16px |
| Mobile body   |              0 |             10px |                6px |     16px |

编辑内容区自身使用 `padding: 0 0 16px 6px`：

- top 为 0，避免平台 padding 与首个内容块间距叠加；
- right 为 0，由外层可用宽度决定内容右边界；
- bottom 为 16px，为末行光标和滚动留出空间；
- left 为 6px，作为正文内容 inset。

移动端旧有的 10px 顶部 padding 必须移除。标题结束到首个正文内容块的间隔只由首个内容块的 12px `margin-top` 表达，不能形成 `10 + 12 = 22px` 的重复间距。

空编辑器 placeholder 与首个正文块使用相同的横纵起点，即左侧跟随 6px 内容 inset、顶部跟随 12px 首块间距，避免 placeholder 与实际输入光标跳位。

## 顶层内容块与块间距

块间距统一为 12px，并只使用后一个顶层内容块的 `margin-top` 表达。所有顶层内容块没有底部 margin。

| 内容结构           | 是否是顶层内容块 | `margin-top` |
| ------------------ | ---------------- | -----------: |
| 普通段落           | 是               |         12px |
| 空段落             | 是               |         12px |
| H1–H3              | 是               |         12px |
| 整个有序或无序列表 | 是               |         12px |
| 单个列表项         | 否               |            0 |
| 整个连续引用组     | 是               |         12px |
| 同组中的连续引用行 | 否               |            0 |
| Divider            | 是               |         12px |
| 图片               | 是               |         12px |
| 视频               | 是               |         12px |

首个内容块也保留 12px `margin-top`。这使容器 top padding 可以保持 0，并让标题到正文、空白编辑器到首行以及各种块组合遵循同一规则。

Quill 会将连续引用行渲染为相邻的多个 `blockquote`。这些相邻节点在领域上属于一个引用组，内部不能增加 12px，左侧引用竖线必须连续。从引用切回其他内容时，由后一个顶层内容块重新提供 12px 顶部间距。

## 节点样式

### Link

- 使用 Common Blue；
- 使用可见的实线下划线；
- underline offset 保持默认/0 语义；
- 本次不新增 hover、active、visited 等 Figma 未提供的状态样式。

### Mention 与 Channel

- Mention 使用 Blue/Secondary；
- Channel 使用 Primary/01；
- 本次只调整文字颜色，不增加背景、圆角、padding 或 chip 外观。

### Divider

- 颜色使用 Schemes/Divider Low；
- Mobile 为 0.5px；
- Desktop 为 1px；
- 宽度占满正文内容区的可用宽度；
- 只有 `margin-top: 12px`，没有底部 margin。

### Quote

- 内容颜色取 Schemes/On Surface，并使用 80% opacity；这里的“80% 透明度”按设计工具的 opacity 语义解释为 alpha 0.8；
- 左侧色块颜色取 Schemes/On Surface，并使用 30% opacity；
- 色块宽度为 3px、圆角为 2px；圆角属于整个引用组，只在首行顶部和末行底部可见；
- 色块与引用内容之间的净间距为 8px，因此引用内容相对引用块左边缘的起点为 `3 + 8 = 11px`；
- 连续 Quill `blockquote` 节点仍属于同一个引用组：runtime 只在直属子节点增删时同步组首/组尾状态 class，CSS 据此只绘制首行顶部与末行底部圆角；相邻行保持零间距且绝不重叠，避免 30% 透明色在连接处叠加变深；
- 色块使用原生边框实现，不在可编辑 Quote 内创建伪元素，避免中文 IME 提交时光标或内容脱离引用组；
- Quote 继续继承所在平台的正文基础排版 T，不单独修改字号、行高或字重。

### 列表、引用和媒体

除顶层 12px 间距、正文基础排版 T 与上述 Quote 样式外，列表 marker、缩进算法、媒体尺寸、圆角、object-fit 和播放遮罩保持现状。这些值未在本轮 Figma 资料中重新定义。

## 标题与工具栏

本轮不重新设计标题输入框和桌面工具栏，其现有视觉效果保持不变。但现有稳定规则也必须迁移到 runtime CSS，并从 Flutter bootstrap 的注入 CSS 中删除。这里的“保持不变”指 computed style 和最终视觉不变，不代表继续保留双份实现。

## 发布与同步契约

> 本节的手工同步方式已由 [ADR 0003](./0003-client-follows-branch-runtime-release.md) 取代；[ADR 0007](./0007-flutter-package-locks-immutable-runtime-artifact.md) 是该 branch/latest Release 方案的 proposed replacement，但 PR-0 尚未切换实现。在后续迁移完成前，现有代码仍暂时按 ADR-0003 方案运行。

runtime 源码和 App 内实际运行资产位于两个仓库：

1. 在 `flutter_quill_editor` 修改并验证 runtime 源码；
2. 通过 `vp run webview-runtime#build` 构建 `apps/webview-runtime/dist`；
3. 在 `teamgaga-client` 使用 `tools/sync-richtext-runtime.sh` 文档化流程同步构建产物；
4. 提交生成的 `app/assets/richtext_webview_runtime`、runtime version/manifest 以及必要的 Flutter bootstrap 清理；
5. 不直接编辑 client 中 hash 命名的 JS/CSS 资产。

源码变更与 client 资产 pin 必须成套交付。只提交 `style.css` 而不更新 App 资产，或只手改 App 资产而没有源代码变更，都不满足该契约。

## 迁移要求

实施该决定时按以下边界迁移：

1. 在 runtime CSS 中加入本次使用的 Light/Dark token 子集；
2. 按 Mobile/Desktop class 实现正文 T、节点样式、内容对齐和统一块间距；
3. 保留标题和工具栏当前 computed style，但确保其稳定声明只存在于 runtime；
4. 从 Flutter bootstrap 删除稳定 CSS 字符串，只保留运行时配置、主题/平台 class 机制和动态 shell 背景职责；
5. 重建 runtime，并通过 client 同步脚本更新内嵌资产和 manifest；
6. 对源码 runtime 与 client 实际嵌入 runtime 执行相同的验收矩阵。

## 验收标准

本轮以 computed style 和组合场景为验收依据。至少覆盖以下四种组合：

- Mobile Light；
- Mobile Dark；
- Desktop Light；
- Desktop Dark。

每种组合检查：

- H1、H2、H3；
- 普通段落与空段落；
- 有序列表、无序列表和相邻列表项；
- 单行引用、连续引用行和退出引用后的段落；同时验证内容 80% opacity、色块 30% opacity、3px 宽度、2px 圆角及 8px 内容间距；
- Link、Mention、Channel；
- Divider；
- 图片与视频；
- 空编辑器 placeholder；
- 标题与正文左侧对齐；
- 首块、相邻块和末块的间距；
- 光标、滚动底部留白和 CJK IME 列表输入等既有行为。

还应验证：

- Flutter bootstrap 中不再出现稳定内容选择器的重复声明；
- runtime build 通过；
- client 同步后的版本/manifest 与构建产物一致；
- client 相关静态检查和测试通过。

目前没有固定 viewport 的完整 Figma 截图，因此本轮不能宣称完成像素差分验收。后续获得固定尺寸设计图后，可在上述 computed-style 契约之上增加截图 diff，而不改变样式所有权。

## 不在本次范围内

- 标题输入框或桌面工具栏的重新设计；
- H4–H6；
- Figma 未提供的代码块、表格、caption、链接交互状态；
- 列表缩进、引用结构和媒体形态的重新设计；
- 打包 PingFang SC 或引入新的 Web 字体；
- 把完整 `theme.css` 引入生产 runtime；
- 修复与当前富文本无关的全量 token 差异；
- 在没有固定设计截图时宣称像素级一致。

## 考虑过的方案

### 方案 A：继续同步维护两份 CSS

改动最少，但每个样式变化都要修改 runtime 和 Flutter bootstrap，且最终结果受加载顺序和 `!important` 影响。该方案正是当前漂移的来源，因此拒绝。

### 方案 B：由 Flutter 注入全部富文本样式

可以集中在 App 仓库，但浏览器 runtime、Flutter Web iframe 和原生 WebView 无法天然共享同一实现，也会让宿主承担不属于它的内容视觉职责，因此拒绝。

### 方案 C：把完整 Figma token CSS 直接引入 runtime

实现简单，但会把数百个未使用 token、生成器命名冲突和与富文本无关的全量差异带入生产包。采用按需复制的 token 子集。

### 方案 D：删除 Flutter 桌面卡片的结构 padding，让 runtime 独自提供 16px

职责看似更单一，但会破坏 PlatformView 为圆角、边框和裁切保留的保护空间。采用“宿主保留结构 inset、runtime 补偿最终对齐”的分层方案。

### 方案 E：移动端和桌面端使用相同正文规格

实现更简单，但与最新 Figma 中 Mobile MD/MD、Desktop SM/SM 的明确差异冲突，因此拒绝。

## 后果

### 正向后果

- 每项稳定视觉规则只有一个源码修改入口；
- 浏览器 runtime 与 App 内 WebView 的层叠结果更容易解释；
- token 名称与 Figma 语义保持可追溯；
- 平台差异通过明确 class 表达，而不是由 Flutter 拼接两套 CSS；
- computed-style 测试可以直接约束最终视觉契约。

### 代价与风险

- runtime CSS 变更必须重建并同步到 client，跨仓发布步骤不能省略；
- Flutter bootstrap 清理时必须保留动态背景和主题实时切换，避免回归 ADR 0001 已解决的问题；
- Windows 无 PingFang SC，字体字形无法与 macOS/iOS 完全一致；
- 统一块间距需要保护 Quill 列表和连续引用行的 DOM 特性，不能对所有直接子节点机械设置 margin；
- 现有标题和工具栏规则迁移后必须比较 computed style，避免“只搬位置”仍产生视觉变化。
