# 剪贴板保留自产正文媒体与宿主托管文件粘贴

复制、剪切、粘贴和拖放到光标支持正文媒体（图片、视频）：自产 HTML 往返保留完整正文媒体顶层内容块；剪贴板/拖拽的系统媒体文件由宿主托管注册为本地媒体并写入草稿；外源普通 HTML 媒体继续剔除并维持媒体隔离边界。

TeamGaga 编辑器之间靠系统剪贴板上的 HTML 往返：

- **复制与剪切（自产 HTML）**：`text/html` 保留 `<img class="tgg-image" data-src="…" width="…" height="…" data-mime-type="…" data-file-size="…">` 以及 `<div class="tgg-video" data-src="…" …>` 的完整 blot DOM 与元数据；`text/plain` 给人读降级为 `[图片]\n` 与 `[视频]\n`。剪切带图选区时，原处图被删除，剪贴板带走图并在粘贴时完整还原。
- **自产富文本粘贴与认领**：`stripPasteHtml` 放行携带完整 `data-*` 属性的自产 `.tgg-image` 与 `.tgg-video` 节点；`stripEmbeds` 放行携带有效 `ImageAttributes`（`width`, `height`, `mimeType`, `fileSize`）与 `VideoAttributes` 的 Delta 操作。
- **系统剪贴板文件 / 截图 / 拖放文件（宿主托管）**：WebView 捕获 `paste` / `drop` 中的媒体文件（`image/*`, `video/*`），由 Web 端轻量探活自然尺寸后发出 Web→Flutter 协议事件 `request_paste_media`；宿主接收并持久化至草稿媒体仓库（`MediaResourceRegistry`），生成 `tgg-local-media://<token>`，通过现有的 `insert_image` / `insert_video` 指令写回编辑器。Delta 中严禁直接写入 Base64。
- **外源 HTML 媒体隔离**：外源网页中缺乏合法元数据的普通 `<img>` / `<video>` 标签继续被 `stripPasteHtml` 剥离，防止外链失效、防盗链破图以及破坏 Delta 强元数据校验契约。
- **容错与回退**：跨会话或未命中本地 Token 的媒体在 Delta 中正常解析，在渲染层触发既有的 `media-fallback` 占位图，不阻断文档正常编辑与保存。

## Considered Options

- **在 Delta 中直接写入 Base64 Data URL**（否决）：大幅膨胀文档体积，破坏 Delta 轻量性，且绕过了草稿持久化与正式提交时的上传管道。
- **WebView 内部自闭环读取 Blob/IndexedDB**（否决）：破坏了 Flutter 端 `MediaResourceRegistry` 对未发送草稿媒体的所有权与生命周期管理（见 ADR-0005）。
- **认领并放行外源普通 `<img>`**（否决）：外源图片缺失宽高与 MIME/大小元数据，易引发跨域防盗链与死链破图；用户可通过复制图片本身（走文件粘贴链路）获得真实元数据与本地缓存。
- **纯文本降级为 Markdown `![image](url)` 或留空**（否决）：Markdown 语法会向外部暴露 `tgg-local-media://` 内部协议 URI；留空则无法传达此处存在媒体的意图。`[图片]` / `[视频]` 是最清晰且安全的占位语义。

## Consequences

- 同一文档内或跨 TeamGaga 编辑器挪动包含图片/视频的内容时，正文媒体能够完整无损往返。
- 支持操作系统截图（快捷键粘贴）与本地文件（复制粘贴/拖放）直接插入编辑器，体验与主流桌面/移动端富文本编辑器对齐。
- Delta 规范与校验契约（`packages/delta`）无需放宽或妥协，依然保持严格的强元数据约束。
