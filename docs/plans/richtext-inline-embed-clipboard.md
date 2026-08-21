# 内联嵌入剪贴板传输实施计划

## 文档状态

- 日期：2026-08-21
- 状态：grilling 决策已确认（见 `docs/adr/0006-inline-embed-clipboard-transfer.md`），本计划固化实施细节
- 涉及仓库：仅 `flutter_quill_editor`（`packages/quill` 为主；playground / webview-runtime 随 Quill 打包验证）
- 术语：`CONTEXT.md`（内联嵌入、提及、频道引用、正文媒体）
- 不改：`teamgaga-client`、Protocol 版本、Core 命令、Delta schema、Flutter 剪贴板拦截

工作区里已有一份未提交的 clipboard 草稿（matcher、`extractPlainText`、部分测试）。**以本计划与 ADR 0006 为准**，草稿中与契约不符的部分（复制 HTML 仍带 `<img src>`、复制侧未剥媒体、仍引用不存在的 ADR-0016、类名仍叫 text-only）必须改掉，不能把草稿当完成态。

## 背景与目标

已提交策略（代码注释称 ADR-0016，本仓库没有这份 ADR）：粘贴/拖放剥掉**全部**嵌入，包括表情、提及、频道引用。用户在同一文档或跨 TeamGaga 编辑器挪段落时，这三个内联嵌入会变成普通字，或直接消失。

目标：复制、剪切、粘贴、拖到光标走同一套契约——保住正文、已支持的基础排版、以及**作为实体的内联嵌入**；继续剔除正文媒体与分割线；系统剪贴板的 `text/html` 给我们往返，`text/plain` 给人读。外源 HTML / 纯文本不推断成嵌入。剪贴板不是第二条媒体上传通道，也不是搬图工具。

这与 ADR 0005 一致：图片仍只能经宿主选择器进入文档。粘贴不向宿主校验成员/频道是否仍有效（文档是哑巴仓库）。

## 已确认决策

| 项            | 决定                                                                                                                                          |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| 操作集合      | 复制、剪切、粘贴、拖到光标，同一契约                                                                                                          |
| 表面          | 同一文档、跨 TeamGaga 编辑器（IM ↔ Circle、两篇草稿）。标题栏不在范围（放不了内联嵌入）                                                       |
| 载体          | 系统剪贴板 `text/html` 往返；`text/plain` 只给人读。不新增自定义 MIME，不加嵌入签名                                                           |
| 保住          | 正文文字；已有基础排版（`bold` / `italic` / `underline` / `strike` / `link` / `header` / `list` / `indent` / `blockquote`）；三个内联嵌入实体 |
| 剔除          | 正文媒体（图片、视频）、分割线；不留 `[图片]` 或空标签。块结构（段落/列表/标题/引用）保留                                                     |
| 外源          | Slack / 微信 / 手写 `@Alice` / `:foo:` / 系统 😀 **不**升格为内联嵌入。😀 就是普通字                                                          |
| 提及身份      | `id` + `sign` + `displayText`。HTML：`span.tgg-mention` + `data-id` / `data-sign` / `data-display`，文本 `@${displayText}`                    |
| 频道引用身份  | `id` + `displayText`。HTML：`span.tgg-channel` + `data-id` / `data-display`，文本 `#${displayText}`                                           |
| 表情身份      | 只有 emoji id。**禁止**把 `src` / blob / 本地资源路径写入剪贴板                                                                               |
| 表情复制 HTML | `<span class="tgg-emoji" data-emoji-id="tada">:tada:</span>`。无 `<img>`、无 `src`、无 `data-emoji-missing`                                   |
| 纯文本        | `@${displayText}`、`#${displayText}`、`:${emojiId}:`。`@所有人` 无特殊分支                                                                    |
| 有效性        | 粘贴只检查形状。跨社区、退群、伪造 id 照样写入。发送/通知/权限归宿主或后端                                                                    |
| 未注册表情    | 留下实体，按缺失渲染（`hydrateEmojiNodes` 已有 `data-emoji-missing`）。注册表是视图                                                           |
| 残缺          | 没 id、有显示名 → `@Alice` / `#general` 普通文字。有 id、没显示名 → 整颗丢弃。sign 非法或缺失 → `!`                                           |
| 搬媒体        | 同一文档剪切带图选区再粘贴，图从原处删除且不会回来。这是有意缺口，不是漏做                                                                    |
| 协议          | 不升版本，不加命令。宿主经现有 `change` / `state_change` 看到结果                                                                             |
| 所有权        | 策略装在 Quill adapter（`createQuillAdapter` 已调用的 clipboard module）。Flutter 不拦截剪贴板。Host 不参与粘贴                               |

## 非目标

- 不经剪贴板搬图片、视频、分割线；不为「自家 HTML」开媒体例外。
- 粘贴时不向宿主问「这个人还在不在」。
- 不给内联嵌入加签名或自定义 MIME。
- 不从纯文本或外源 HTML 推断提及 / 频道引用 / 表情。
- 不把系统表情 😀 变成自定义表情。
- 不改标题栏。
- 不改 Delta canonical schema（快照仍是 `{ mention: id, attributes: { sign, displayText } }` 等）。
- 不改 Core `insert_*`、Protocol、Dart codec。
- 不改 `teamgaga-client`。
- 不把剪贴板文件读成 data URL（继续 `NoopUploader`，`DataTransfer.files` 永不检查）。

## 架构

```text
复制 / 剪切
  Quill selection
    → onCopy
      → text/plain = extractPlainText(getContents(range))
      → text/html  = rewriteCopyHtml(getSemanticHTML(range))
         · 表情 span 改写成 :id: 文本，去掉 img 与 data-emoji-missing
         · 去掉正文媒体与分割线节点，不留占位
         · 提及 / 频道引用保持 blot DOM（data-* + 可见文本）

粘贴 / 拖到光标
  clipboardData / dataTransfer
    → 读 text/html 与 text/plain（无则 text/uri-list）
    → 永不读 files
    → stripPasteHtml：清空 .tgg-emoji 子节点后删除剩余 img / video / hr / .tgg-divider / .tgg-video / .tgg-image
    → Quill convert + span.tgg-* matcher
    → stripEmbeds：白名单内联嵌入，残缺按表降级，丢掉媒体/分割线 op
    → 写入当前选区（剪切后的删除仍由 Quill 对整段选区执行，含媒体）

快照
  Quill embed value { mention: { id, sign, displayText } }
    → converters.quillDeltaToSnapshot
    → canonical { mention: id, attributes: { sign, displayText } }
```

Matcher 必须产出 **Quill 侧** embed value（对象），不能直接写 canonical 快照形。`getSnapshot()` 仍走现有 converters。`stripEmbeds` 可同时容忍对象形和字符串 id 形，避免 convert 中间态漏网。

`EmojiBlot` 保持 `Scope.INLINE_BLOT`、节点仍是带内层 `<img>` 的 span：那是 **编辑器内渲染**。复制 HTML 不得使用当前 DOM 的 `innerHTML` 原样出海。不要为了复制去改 live DOM 的 img。

## 复制 / 粘贴 HTML 契约

### 复制出海（`text/html`）

| 节点                 | 复制 HTML                                                                                     |
| -------------------- | --------------------------------------------------------------------------------------------- |
| 提及                 | `<span class="tgg-mention" data-id="…" data-sign="!"\|"&" data-display="Alice">@Alice</span>` |
| 频道引用             | `<span class="tgg-channel" data-id="…" data-display="general">#general</span>`                |
| 表情                 | `<span class="tgg-emoji" data-emoji-id="tada">:tada:</span>`                                  |
| 图片 / 视频 / 分割线 | 删除节点，不留洞                                                                              |
| `data-emoji-missing` | 不出现在复制 HTML                                                                             |

### 粘贴认领（只认我们的 class + 必需 data）

| 条件                                                                        | 结果                         |
| --------------------------------------------------------------------------- | ---------------------------- |
| `span.tgg-mention` 且 id、displayText 都非空                                | 提及实体；sign 缺省 `!`      |
| `span.tgg-mention` 无 id、有 displayText                                    | 文本 `@displayText`          |
| `span.tgg-mention` 有 id、无 displayText                                    | 丢掉                         |
| 频道引用同上，前缀 `#`                                                      | 同规则（无 sign）            |
| `span.tgg-emoji` 且 `data-emoji-id` 非空                                    | 表情实体（不论注册表有没有） |
| `span.tgg-emoji` 无 id                                                      | 丢掉                         |
| 纯文本 `@Alice` / `#general` / `:tada:`                                     | 纯文本                       |
| 外源 mention-like HTML（无 `tgg-mention`）                                  | 当普通 HTML/文本，不升格     |
| `<img>` / `<video>` / `<hr>` / `.tgg-image` / `.tgg-video` / `.tgg-divider` | 删除，周围文本留下           |

粘贴后表情 live DOM 仍由 `EmojiBlot.create` 建 `<img>`，再由 `hydrateEmojiNodes` 灌 `src`。未注册则 `data-emoji-missing`，这只存在于编辑器内，不进下一次复制 HTML。

## 与当前草稿的差距

对照 `packages/quill/src/clipboard/text-only-clipboard.ts` 未提交改动：

| 草稿已有                                                  | 对照 ADR 0006                                                                                                 |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `span.tgg-*` matcher、残缺降级                            | 保留，补齐「有 id 没 displayText 则丢」的测试                                                                 |
| `extractPlainText`                                        | 保留                                                                                                          |
| 粘贴前剥 block img/video/hr                               | 保留；复制侧必须做**另一份** rewrite（表情留下 `:id:` 文本，而不是 `textContent = ""`）                       |
| `onCopy` = `getSemanticHTML` + 纯文本                     | **不够**：`getSemanticHTML` 会带表情 `<img src>`、媒体、可能带 `data-emoji-missing`                           |
| 类名 / 文件名 `text-only`，注释 ADR-0016                  | 改名并改注释。本仓库决策是 ADR 0006；媒体隔离并入该 ADR 与 ADR 0005，不要再引用不存在的 ADR-0016              |
| `clipboard-paste-drop.test.ts` 已测粘贴嵌入、复制含 class | 必须加：复制 HTML 无 `src`、表情 inner 为 `:id:`、复制/剪切 HTML 无媒体、纯文本不升格、未注册表情保留、残缺表 |

`EmojiBlot` 上新增的 `Scope.INLINE_BLOT` 保留：没有它，HTML convert 可能把内层 img 当 `ImageBlot` 拆块。

## 实施步骤

### 阶段 0 文档

- [x] grilling 写入 `CONTEXT.md`（内联嵌入定义不含剪贴板策略）
- [x] `docs/adr/0006-inline-embed-clipboard-transfer.md`
- [x] 本计划
- [x] 实施时把 `docs/plans/todos.md` 本项勾成进行中/完成（本计划落地后）

### 阶段 1 复制路径

文件：`packages/quill/src/clipboard/`（建议将 `text-only-clipboard.ts` 重命名为更能反映契约的名字，例如 `clipboard-policy.ts`；`installTextOnlyClipboardPolicy` 改名为 `installClipboardPolicy`，旧名不要留 re-export）。

- [x] `onCopy(range)`：
  - `text` = `extractPlainText(this.quill.getContents(range.index, range.length))`
  - `html` = 对 `getSemanticHTML` 的 **clone** 做 `rewriteCopyHtml`，不要改 editor DOM
- [x] `rewriteCopyHtml`：
  - 每个 `.tgg-emoji`：`textContent = :${data-emoji-id}:`，删 `data-emoji-missing`
  - 删除 `.tgg-image`、`img`（此时表情内不应再有 img）、`.tgg-video`、`video`、`.tgg-divider`、`hr`
  - 提及 / 频道引用不动
- [x] 剪切继续走 Quill 默认：先 `onCopy` 再删选区。选区里的图会被删且不在剪贴板上

### 阶段 2 粘贴 / 拖放路径

- [x] 保留 `onCapturePaste` / `onCaptureDrop`：不读 `files`；html+text 仍可粘贴
- [x] 粘贴 HTML 预处理与复制 rewrite **不要混成一个函数**（表情处理相反：复制写 `:id:` 文本，粘贴清空子节点以免残 img 触发 ImageBlot）
- [x] matcher：`span.tgg-mention` / `span.tgg-channel` / `span.tgg-emoji`，规则见上表
- [x] `stripEmbeds`：白名单三内联；媒体/分割线丢 op；残缺按表
- [x] `NoopUploader` 保留
- [x] 注释只引用 ADR 0006 / ADR 0005，删除 ADR-0016

### 阶段 3 测试（`packages/quill/tests`）

现有 `clipboard-paste-drop.test.ts` / `clipboard-strip-embeds.test.ts` 扩写，不要另起一套政策。

粘贴 / 拖放：

- [x] 从我们的 HTML 贴回提及、频道引用、表情，`getSnapshot()` 为 canonical 形
- [x] 混合正文媒体时图/视频/分割线消失，周围文字与内联嵌入留下
- [x] 纯文本 `@Alice` / `#general` / `:tada:` 仍是字符串，不变嵌入
- [x] 无 `tgg-mention` class 的 `<span data-id>` 不变提及
- [x] 没 id、有 display → `@Alice` / `#general`
- [x] 有 id、没 display → 该嵌入不出现，也不把 id 写进正文
- [x] 缺 sign / 非法 sign → `!`
- [x] 未注册 emoji id → snapshot 仍有 `{ emoji: id }`
- [x] 文件-only 剪贴板 / 拖放：文档不变、不抛
- [x] 同时有文字和文件：文字进入，文件忽略
- [x] 拖放内联嵌入 HTML 与粘贴相同

复制 / 剪切：

- [x] `text/plain` 为 `Hi @Bob in #general :tada:` 这种（末尾换行按 Quill 选区，不断言多余 `\n` 政策时与现有 copy 测试对齐）
- [x] `text/html` 含三个 class 与 data 属性
- [x] 表情 HTML **不含** `<img>`、**不含** `src=`、**不含** `data-emoji-missing`，span 文本为 `:tada:`
- [x] 选区含图片/视频/分割线时，复制 HTML 与纯文本都没有它们，也没有 `[图片]`
- [x] 剪切含提及的选区：剪贴板有提及，文档里该提及消失
- [x] 剪切含图片的选区：图片从文档消失，剪贴板没有图（有意缺口）

`stripEmbeds` 单测继续覆盖 Delta 层，不要只测 DOM 事件。

### 阶段 4 验证

在仓库根目录：

- [x] `vp check` / `vp test`（至少 `packages/quill`）
- [x] playground 人工：插入提及、频道引用、表情后复制到同一编辑器、再复制到备忘录看纯文本/HTML；贴回仍是实体；复制含图段落贴回图消失；从备忘录贴 `@Alice` 仍是字
- [x] 不要求本 PR 改 `teamgaga-client`
- [x] webview-runtime：Quill 变更随 `vp run -r build` 打进 runtime；Flutter 内置资产是否立刻同步走既有 ADR 0003 通道，不在本计划另开发布流程

## 完成定义

- 编辑器内复制/剪切/粘贴/拖到光标，三个内联嵌入往返后仍是可 `getSnapshot()` 的实体，id/sign/displayText（表情为 id）与源一致。
- 复制 HTML 中的表情是 `:id:` 文本 span，没有资源 URL。
- 复制与粘贴都不会把正文媒体或分割线放进文档；剪切带图等于删图。
- 纯文本和外源 HTML 不升格。
- 未注册表情留下实体。
- 残缺元数据按表处理，内部 id 不露到正文。
- `DataTransfer.files` 仍是静默忽略。
- Protocol / Core / Delta / Dart 无 diff（除非测试夹具被误伤——不应发生）。
- `vp check` 与 `vp test` 通过。

## 后续（不在本计划）

- 真机 WebView 剪贴板（iOS / Android / 桌面 WKWebView）随 `VERIFY-06` 恢复时一并看，不单独阻塞本 PR。
- 发送路径是否拒绝跨社区/伪造提及，归宿主或后端，不归编辑器。
- 若产品以后要「同一文档搬图」，必须先撤回 ADR 0006 的媒体条款并解决「如何分辨自家 HTML」，不能在实现里偷偷放行 `<img>`。
