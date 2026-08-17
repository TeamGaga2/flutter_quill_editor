# `@teamgaga/richtext-solid-toolbar` Tooltip 与国际化实施计划

## 文档状态

- 日期：2026-08-11
- 状态：需求与交互决策已确认，待实施
- 目标仓库：`flutter_quill_editor`
- 目标包：`packages/solid-toolbar`
- 目标运行端：Desktop / PC Web 的 Solid Toolbar
- 当前阶段：仅完成计划，尚未修改功能代码

## 背景

`@teamgaga/richtext-solid-toolbar` 的 11 个格式项目前只依赖 HTML `title` 显示浏览器原生提示，字号菜单触发器也使用写死的 `title="Header"`。这会带来三个问题：

1. 提示外观与产品 Tooltip 不一致，且无法统一控制 disabled、焦点和菜单交互。
2. 提示及 `aria-label` 全部写死为英文，未根据浏览器语言显示中文。
3. 当前列表按钮顺序为“有序列表 → 无序列表”，与产品确认的顺序相反。

Flutter 原生桌面 Toolbar 已经使用 `TggTooltip` 和 ARB 国际化，不属于本次修改范围。本计划只处理 Solid Toolbar，避免重复修改已经满足需求的原生实现。

## 已确认的产品决策

### 修改范围

- 只修改 `flutter_quill_editor` 中的 Solid Desktop Toolbar。
- 不修改 `teamgaga-client` 的 Flutter 原生 Toolbar。
- 不修改移动端 editor-only 路径；`toolbarMode: "none"` 的默认行为保持不变。
- Close 按钮不在本次 11 项范围内。
- 字号下拉菜单中的 `H1`、`H2`、`H3`、`Body` 选项不做国际化。

### 语言判定

- 读取页面加载时的 `navigator.language`。
- `zh`、`zh-CN`、`zh-TW`、`zh-HK` 等所有 `zh-*` 语言显示中文。
- 其他语言（包括英文、日文、韩文、法文等）一律显示英文。
- 浏览器未提供有效语言时回退为英文。
- 修改浏览器语言后，通过刷新页面使新语言生效；不实现运行时动态切换。
- 不读取 `navigator.languages`，避免首选语言以外的候选项改变判定结果。
- 不使用 `RuntimeConfig.locale`；该字段目前是 future host copy stub，而本需求明确以浏览器语言为准。

### Tooltip 行为

- 11 个格式项使用自定义 Tooltip 组件，不再使用原生 `title`。
- 鼠标 hover 时立即显示，移出后关闭。
- 元素实际获得键盘/程序化焦点时显示，失焦后关闭。
- pointer down / click 时关闭，避免字号下拉菜单打开后仍被 Tooltip 遮挡。
- disabled 项仍能通过外层非 disabled 容器响应 hover 并显示提示。
- Tooltip 默认显示在按钮下方，与 Flutter `withTooltip` 的默认 `TooltipDirection.down` 一致。
- Tooltip 不拦截鼠标事件，不影响按钮命令、active/disabled 状态或编辑器选区保留逻辑。

### 可访问性

- 11 个按钮的 `aria-label` 与当前 Tooltip 文案保持一致，并使用同一语言。
- Tooltip 内容使用 `role="tooltip"`。
- 移除 11 项的 `title`，防止自定义 Tooltip 与浏览器原生提示重复出现。
- 保留现有 Toolbar 的焦点策略和 `tabIndex={-1}`，不在本任务中引入 roving tabindex 或重做键盘导航。
- “focus 显示”指按钮通过现有程序化或辅助技术路径实际获得焦点时显示；让全部按钮进入 Tab 顺序是独立的可访问性改造，不在本次范围内。

## 文案与顺序契约

Toolbar 中的 11 个目标项必须按下表顺序渲染。内部 command 名称不因展示文案变化而改变。

| 顺序 | 内部动作/状态 | 中文 Tooltip / `aria-label` | 英文 Tooltip / `aria-label` | 现有 command            |
| ---- | ------------- | --------------------------- | --------------------------- | ----------------------- |
| 1    | header style  | 字号                        | Font size                   | `toggleHeader`          |
| 2    | bold          | 粗体                        | Bold                        | `toggleBold`            |
| 3    | italic        | 斜体                        | Italic                      | `toggleItalic`          |
| 4    | underline     | 下划线                      | Underline                   | `toggleUnderline`       |
| 5    | link          | 链接                        | Link                        | `onRequestLink`         |
| 6    | divider       | 分割线                      | Divider                     | `insertDivider`         |
| 7    | outdent       | 左缩进                      | Decrease indent             | `outdent`               |
| 8    | indent        | 右缩进                      | Increase indent             | `indent`                |
| 9    | bullet list   | 无序列表                    | Bulleted list               | `toggleList("bullet")`  |
| 10   | ordered list  | 有序列表                    | Numbered list               | `toggleList("ordered")` |
| 11   | blockquote    | 引用                        | Quote                       | `toggleBlockquote`      |

注意：中文“左缩进/右缩进”是已确认的产品展示文案；内部仍分别映射现有 `outdent` / `indent`，不得为了文案修改 command 语义。

## 当前实现基线

### 组件

- `packages/solid-toolbar/src/components/RichTextToolbar.tsx`
  - 组装全部格式项并派发 Core command。
  - 现有顺序为有序列表在前、无序列表在后。
  - 文案通过各按钮的 `label` 直接写死为英文。
- `packages/solid-toolbar/src/components/ToolbarButton.tsx`
  - 同时把 `label` 写入 `aria-label` 和 `title`。
  - 负责保留 pointer/mousedown selection，并维护 active/disabled 状态。
- `packages/solid-toolbar/src/components/HeaderStyleMenu.tsx`
  - 字号菜单触发器单独写死 `aria-label="Header"` 与 `title="Header"`。
  - 菜单选项及选区保留逻辑由该组件维护。

### 样式消费方

Solid Toolbar 包本身不拥有完整产品样式，样式由组合层提供：

- `apps/webview-runtime/src/style.css`：生产 WebView runtime 的 Desktop Toolbar 样式。
- `apps/playground/src/style.css`：本地 Playground 样式。

新增 Tooltip DOM class 后，两处样式必须同步覆盖。不得只让测试 DOM 存在而遗漏实际运行端外观。

### 测试

- `packages/solid-toolbar/tests/index.test.tsx` 已覆盖：
  - `ToolbarButton` 的可访问性与选区保留；
  - 字号菜单的展开、选择与 preventDefault；
  - Toolbar command 映射；
  - active/disabled 状态；
  - Link、Divider、Indent/Outdent 等业务行为。
- 测试环境为 happy-dom，配置位于 `packages/solid-toolbar/vite.config.ts`。
- 现有大量查询依赖英文 `aria-label`；引入中文场景时必须显式控制测试语言，避免测试结果依赖执行机器的 locale。

## 设计方案

### 1. 内部文案解析模块

新增一个 package 内部模块，建议路径：

`packages/solid-toolbar/src/i18n/toolbar-labels.ts`

职责：

- 定义 11 个稳定的文案 key 和只读 label 类型。
- 保存完整的中文、英文文案表。
- 提供纯函数，根据传入语言字符串返回一整套 labels。
- 提供读取 `navigator.language` 的小入口，并在浏览器 API 不存在或值无效时回退英文。

判定建议使用明确的语言标签边界：转为小写后，仅 `language === "zh"` 或 `language.startsWith("zh-")` 视为中文。不要用宽泛的 `startsWith("zh")`，以免未来非标准字符串被误判。

该模块保持内部使用，不从 package 公共 `src/index.ts` 导出，也不新增外部 locale prop。这样可以满足当前需求，同时避免建立未经产品确认的公共国际化 API。

### 2. 内部 Tooltip 组件

新增一个 package 内部组件，建议路径：

`packages/solid-toolbar/src/components/Tooltip.tsx`

建议 DOM 结构：

```text
span.tg-toolbar-tooltip（hover/focus 事件容器）
├── trigger（现有 button 或 HeaderStyleMenu）
└── span.tg-toolbar-tooltip__content[role=tooltip]（打开时渲染）
```

组件职责：

- 接收 `message` 与 trigger children。
- 分别跟踪 hover 和 focus-within，任一为真时显示 Tooltip。
- pointer leave 与 focus out 时关闭。
- pointer down 时关闭当前提示，直到下次重新进入，避免与字号菜单重叠。
- 将事件绑定到外层 `span`，确保 disabled button 不需要自行发出 hover 事件。
- Tooltip 内容不捕获 pointer event。
- 不处理 command、不读取 editor 状态、不承担文案解析。

保持组件简单，不增加方向、延迟、富内容、Portal 或全局 Tooltip manager 等未提出的可配置能力。当前唯一方向是下方，当前唯一延迟是零。

### 3. `ToolbarButton` 接入

修改 `ToolbarButtonProps`，增加可选的 Tooltip 文案输入。接入规则：

- 11 个目标项传入 Tooltip 文案时，用新 Tooltip 组件包裹按钮。
- 按钮 `aria-label` 使用同一个本地化字符串。
- 有自定义 Tooltip 时不渲染 `title`。
- 未传 Tooltip 的调用方保留原行为，避免意外改变 Close 或潜在外部使用方。
- 现有 `aria-pressed`、`data-active`、`disabled`、`tabIndex` 和 pointer/mousedown handlers 原样保留。

这比让所有 `ToolbarButton` 强制拥有新 Tooltip 更符合本次 11 项范围，也能避免 Close 按钮被无意纳入国际化。

### 4. 字号菜单接入

`HeaderStyleMenu` 的触发按钮不经过 `ToolbarButton`，因此需要单独接入：

- 为 `HeaderStyleMenu` 增加由父级传入的 `label` / Tooltip 文案。
- 用 Tooltip 包裹字号菜单的 trigger 区域。
- trigger 的 `aria-label` 改为本地化后的“字号 / Font size”。
- 删除 trigger 的原生 `title`。
- 保持 `aria-haspopup`、`aria-expanded`、`data-value`、open/close、outside pointer down 和 Escape 行为不变。
- `Header styles`、`H1`、`H2`、`H3`、`Body` 保持现状，不扩展本次翻译范围。

### 5. Toolbar 组装与顺序

在 `RichTextToolbar` 每次挂载时解析一次浏览器语言并取得 labels：

- 把相应 label 同时传给 `ToolbarButton` 的 `label` 与 Tooltip 输入。
- 把字号 label 传给 `HeaderStyleMenu`。
- 将无序列表 JSX 移到有序列表之前。
- 只移动对应 JSX，不修改 `state().bulletList` / `state().orderedList` 与 command 的映射。
- Close、spacer、Toolbar 根节点及 host callbacks 保持不变。

Toolbar 根节点默认的 `aria-label="Text formatting"` 不在本次 11 项提示范围内，先保持现状。调用方显式传入的 `aria-label` 继续优先。

### 6. Tooltip 样式

在 runtime 与 Playground 两处增加对应样式，视觉目标参考 Flutter `TggTooltip`：

- 外层为 `inline-flex`、`position: relative`、`flex: 0 0 auto`，不得改变当前 2px Toolbar gap 或按钮尺寸。
- 内容绝对定位在 trigger 下方并水平居中。
- 零延迟显示，可使用短 opacity/transform 过渡，但不能增加等待时间。
- 内容最大宽度 256px，单行短文案不换行；保留最多两行的能力。
- 内边距约为水平 8px、垂直 6px，圆角 6px。
- 使用高对比度深色浮层和浅色文字，runtime 需兼容 light/dark token。
- 使用小箭头指向 trigger；箭头颜色与浮层一致。
- `z-index` 高于普通 Toolbar 内容，并验证不被 editor、标题输入框或 shell 裁剪。
- `pointer-events: none`，不影响 hover 生命周期或点击。
- Playground 使用等价的静态颜色；runtime 使用现有主题 token或与 token 同层定义的 Tooltip 色值。

样式不能依赖 `:hover` 直接选择 disabled button；显示状态由 Tooltip 组件的 DOM 状态/class 驱动，disabled 测试才与正常按钮一致。

## 文件级改动清单

| 文件                                                        | 操作 | 计划改动                                                                      |
| ----------------------------------------------------------- | ---- | ----------------------------------------------------------------------------- |
| `packages/solid-toolbar/src/i18n/toolbar-labels.ts`         | 新增 | 中英文案表、label 类型、浏览器语言判定与英文 fallback                         |
| `packages/solid-toolbar/src/components/Tooltip.tsx`         | 新增 | hover/focus/disabled-safe 的内部 Tooltip 组件                                 |
| `packages/solid-toolbar/src/components/ToolbarButton.tsx`   | 修改 | 可选接入 Tooltip；目标项移除原生 `title`；保留按钮现有行为                    |
| `packages/solid-toolbar/src/components/HeaderStyleMenu.tsx` | 修改 | 字号 trigger 使用本地化 label 与 Tooltip；菜单选项保持不变                    |
| `packages/solid-toolbar/src/components/RichTextToolbar.tsx` | 修改 | 读取 labels、传递 11 项文案、调整无序/有序列表顺序                            |
| `packages/solid-toolbar/tests/index.test.tsx`               | 修改 | 增加语言、Tooltip、顺序、disabled、无重复 title 测试；更新依赖旧 label 的查询 |
| `apps/webview-runtime/src/style.css`                        | 修改 | 生产 runtime Tooltip 布局、主题、层级与显隐样式                               |
| `apps/playground/src/style.css`                             | 修改 | Playground 对应 Tooltip 样式                                                  |

明确不计划修改：

- `packages/solid-toolbar/src/index.ts`：Tooltip 与 label resolver 不作为公共 API 导出。
- `apps/webview-runtime/src/runtime-config.ts`：不改变 `locale` stub。
- `apps/webview-runtime/src/mount-editor.tsx`：不新增 locale prop，也不改变动态挂载流程。
- `packages/core`、`packages/solid`、`packages/protocol`、Quill adapter：command/state 协议不变。
- `teamgaga-client`：Flutter 原生 Tooltip 与 ARB 不变。

## 实施步骤与逐步验证

### 阶段 0：确认干净基线

1. 检查 `flutter_quill_editor` 工作区状态，记录并避开用户已有改动。
2. 按仓库规范确认依赖已安装；需要时执行 frozen/offline 优先的 `vp install`。
3. 在 `packages/solid-toolbar` 运行现有 `vp test`，确认修改前测试通过。

验证标准：

- 基线失败必须先记录，不能把既有失败误判为本次回归。
- 不清理、不覆盖与本任务无关的用户改动。

### 阶段 1：先建立可验证契约

在实现前补充失败测试，锁定：

1. `zh`、`zh-CN`、`zh-TW`、`zh-HK` 返回完整中文 labels。
2. `en-US`、`ja-JP`、空值/不可用环境返回完整英文 labels。
3. 英文与中文 Toolbar 的 11 项 DOM 顺序完全匹配文案表。
4. 11 项存在 `role="tooltip"` 的自定义提示结构，且对应 trigger 没有 `title`。
5. Close 不被计入 11 项，原有行为不回归。
6. disabled 的 Link / Indent / Outdent 外层仍可触发 Tooltip。
7. hover、pointer leave、focus in、focus out、pointer down 分别打开或关闭 Tooltip。

验证标准：新增测试应先因功能缺失而失败，且失败原因与目标行为一致。

### 阶段 2：实现文案解析

1. 新增内部 label 类型与中英文案常量。
2. 实现纯语言判定函数。
3. 实现浏览器语言读取与英文 fallback。
4. 让测试显式注入/模拟语言，清理测试间的 navigator mock。

验证标准：文案解析单元测试通过，且不依赖执行机器语言。

### 阶段 3：实现 Tooltip 组件

1. 新增最小 Tooltip wrapper 与显隐状态。
2. 支持 hover、focus-within、pointer down 关闭。
3. 确保 disabled trigger 由外层容器捕获 hover。
4. 渲染 `role="tooltip"`，不复制 command 或 editor 逻辑。

验证标准：组件事件测试通过，普通与 disabled trigger 行为一致。

### 阶段 4：接入 Toolbar

1. `ToolbarButton` 增加可选 Tooltip 接入。
2. `HeaderStyleMenu` 接收本地化 label 并接入 Tooltip。
3. `RichTextToolbar` 读取一次 labels，并传给全部 11 项。
4. 调整无序列表/有序列表 JSX 顺序。
5. 移除 11 项的原生 `title`，保留 Close 的既有范围和行为。

验证标准：

- 11 项中英文案、DOM 顺序、`aria-label`、Tooltip 文案完全一致。
- command 测试仍证明 bullet/ordered、outdent/indent 没有映射反转。
- Header 菜单、Link handoff、Divider、选区保留测试全部通过。

### 阶段 5：接入两处样式

1. 在 runtime 样式中增加 Tooltip wrapper、content、arrow、显隐与主题样式。
2. 在 Playground 增加等价样式。
3. 检查新增 wrapper 是否改变 Toolbar flex 布局、header trigger 宽度、spacer 或 Close 对齐。
4. 检查 Tooltip 是否被 `.editor-shell`、editor root 或其他 overflow 规则裁剪。

验证标准：runtime 与 Playground 中 11 项均可见、对齐稳定，light/dark 下文字对比度足够。

### 阶段 6：完整自动化验证

按从小到大的顺序执行：

1. `packages/solid-toolbar`：`vp test`
2. 仓库根目录：`vp check`
3. 仓库根目录：`vp run -r test`
4. 仓库根目录：`vp run -r build`

若根级任务与本机 Vite+ task 解析方式不同，使用 package 自身的 `test` / `check` / `build` script 完成同等验证，并在交付结果中写明实际命令。

验证标准：格式化、lint、类型检查、全部测试与相关 build 均通过。

### 阶段 7：人工交互验收

在 Playground 与 `toolbarMode=desktop` 的 webview-runtime 各验证一次：

1. 英文浏览器环境逐项 hover 11 个按钮，核对英文文案和顺序。
2. `zh-CN` 与至少一个繁体 locale（建议 `zh-TW`）刷新后，核对统一显示已确认的中文文案。
3. 日文等非 `zh-*` locale 刷新后，确认统一回退英文。
4. 在 editor 无 selection、Link handler 缺失、无法缩进等 disabled 场景 hover，提示仍出现。
5. 让可聚焦 trigger 实际获得焦点，确认 Tooltip 出现；失焦后关闭。
6. 打开字号菜单，确认 pointer down 后 Tooltip 关闭，菜单不被遮挡。
7. 点击 11 项，确认格式命令、active 状态和编辑器选区行为未改变。
8. 检查 Toolbar 左端字号、右侧列表/引用以及窗口窄宽度下的裁剪和层级。
9. 检查 runtime light/dark 主题与 Playground 外观。
10. 确认 Close 按钮行为未改变。

## 自动化测试矩阵

| 类别          | 场景                                      | 预期结果                                                       |
| ------------- | ----------------------------------------- | -------------------------------------------------------------- |
| locale        | `zh` / `zh-CN` / `zh-TW` / `zh-HK`        | 11 项全部使用确认后的中文                                      |
| locale        | `en-US` / `ja-JP` / 无有效语言            | 11 项全部使用确认后的英文                                      |
| order         | 英文 Toolbar                              | `Font size` 至 `Quote` 顺序与文案表一致                        |
| order         | 中文 Toolbar                              | `字号` 至 `引用` 顺序与文案表一致                              |
| semantics     | 11 个 trigger                             | `aria-label` 等于当前语言 Tooltip 文案                         |
| native title  | 11 个 trigger                             | 不存在 `title`，不会出现重复原生提示                           |
| tooltip       | pointer enter / leave                     | 分别显示 / 关闭自定义 Tooltip                                  |
| tooltip       | focus in / out                            | 分别显示 / 关闭自定义 Tooltip                                  |
| tooltip       | pointer down                              | 立即关闭，字号菜单可无干扰打开                                 |
| disabled      | Link、Indent、Outdent disabled            | 命令不可执行，但 wrapper hover 仍显示 Tooltip                  |
| header menu   | 打开、选中 H1/H2/H3/Body、Escape/外部点击 | 现有菜单行为保持不变                                           |
| commands      | bullet / ordered                          | 调整视觉顺序后仍分别派发 `bullet` / `ordered`                  |
| commands      | outdent / indent                          | 展示新文案后仍分别派发原 command                               |
| selection     | pointerdown / mousedown                   | `preventDefault` 及编辑器 selection 保留行为不变               |
| excluded item | Close                                     | 不计入 11 项，不被国际化或重排，callback/disabled 行为保持不变 |

## 风险与控制措施

### Wrapper 改变 Flex 布局

风险：按钮外多一层 `span` 后，现有 flex item、gap、header menu 宽度或 spacer 对齐发生变化。

控制：Tooltip wrapper 明确设置 `inline-flex` 与 `flex: 0 0 auto`；自动化核对 DOM 顺序，人工对比 Toolbar 尺寸和 Close 对齐。

### disabled Button 不发出预期事件

风险：直接把 hover handler 绑在 disabled button 上，在不同浏览器表现不一致。

控制：事件只绑在非 disabled wrapper 上；单测覆盖 disabled Link/Indent/Outdent。

### 自定义与原生提示叠加

风险：遗漏 `title` 会在延迟后出现第二个浏览器提示。

控制：测试逐一断言 11 个 trigger 不存在 `title`；Tooltip 文案只由自定义组件展示。

### 本地化导致现有测试误报

风险：测试机器的 `navigator.language` 不同，基于英文 `aria-label` 的查询不稳定。

控制：每个整合测试显式固定语言；mock 在用例后恢复；对 command 测试使用已知 locale。

### 列表顺序调整时误换 command

风险：移动 JSX 时把 icon/state/command 组合错配。

控制：顺序测试与 command 断言分开；明确验证 `Bulleted list → bullet`、`Numbered list → ordered`。

### Tooltip 与字号菜单重叠

风险：两者都在 trigger 下方，点击菜单时 Tooltip 仍停留。

控制：Tooltip 在 pointer down 时关闭，直到重新 hover/focus；人工验证菜单打开、选择和关闭流程。

### 运行端样式遗漏

风险：只更新 package 测试或 Playground，生产 runtime 缺少 Tooltip 样式。

控制：文件清单强制同时修改 runtime 与 Playground；两端人工验收均列入完成定义。

## 明确不做

- 不为整个项目引入第三方 i18n 库。
- 不把 `RuntimeConfig.locale` 接进 Toolbar。
- 不新增语言切换器或运行时响应语言变化。
- 不翻译字号菜单内部选项、Toolbar 根 `aria-label`、Close 或其他非清单文案。
- 不将 Tooltip/labels 作为 package 公共 API。
- 不实现 Portal、自动碰撞检测、多方向、多延迟或富内容 Tooltip 系统。
- 不重构 Core command、Toolbar state、Link request 或 editor focus 机制。
- 不重做 Toolbar 的 Tab 顺序或 roving tabindex。
- 不修改 Flutter 原生 Toolbar。

## 回滚方案

本功能无数据、协议、存储或 public API 迁移，回滚仅涉及表现层：

1. 删除内部 Tooltip 与 label 模块。
2. 恢复 `ToolbarButton` / `HeaderStyleMenu` 的原生 `title`。
3. 恢复 `RichTextToolbar` 的英文常量和原列表顺序。
4. 删除 runtime 与 Playground 的 Tooltip 样式。
5. 删除对应新增测试并运行原基线验证。

回滚不会影响已保存的 rich-text 内容、Protocol 消息、Core command 或 Flutter runtime 配置。

## 完成定义（Definition of Done）

- [ ] Solid Desktop Toolbar 的 11 项按确认顺序显示。
- [ ] 11 项 hover 时通过自定义 Tooltip 显示正确文案。
- [ ] 11 项实际获得焦点时显示 Tooltip。
- [ ] disabled 项 hover 时仍显示 Tooltip。
- [ ] `zh` 与全部 `zh-*` locale 显示确认后的中文。
- [ ] 所有非中文 locale 显示确认后的英文。
- [ ] 11 项 `aria-label` 与 Tooltip 同语言、同文案。
- [ ] 11 项不存在原生 `title`，无重复提示。
- [ ] Close 和字号菜单内部选项不受本次改动影响。
- [ ] 无序列表位于有序列表之前，且两者 command 映射正确。
- [ ] Header 菜单、Link/Divider、Indent/Outdent、active/disabled 与 selection 行为无回归。
- [ ] runtime 与 Playground 样式均已覆盖并完成人工检查。
- [ ] `vp test`、`vp check`、递归测试与相关 build 全部通过。

## 文档决策说明

本次变更是局部、易回退的 UI 行为，不满足 ADR 所要求的“难以逆转、缺少上下文会令人意外、存在重大真实权衡”三项条件；Tooltip、Toolbar item 和浏览器语言也属于通用 UI/实现概念，而非 TeamGaga 富文本领域的专属术语。因此不新增 `CONTEXT.md` 或 ADR，本专项实施计划即为需求和执行依据。
