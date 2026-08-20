# 插入操作由宿主选择器完成

Solid 桌面工具栏上的表情、提及、频道引用、图片不在运行时内打开选择器。点击发出 Web→Flutter 事件 `request_emoji` / `request_mention` / `request_channel` / `request_image`，payload 为 `{ selection: ProtocolSelection | null }`；宿主打开选择器后用已有的 `insert_*` 命令写回正文。这与链接浮层（ADR 0004）相反：链接是无业务依赖的表单，插入操作依赖成员列表、频道列表、表情资源和系统文件选择器。

可见性由闭集允许列表 `visibleInsertActions` 控制，默认不传则全隐藏；展示顺序固定为表情 → 提及 → 频道引用 → 图片，与排版控件之间用工具栏分隔线隔开。协议版本不升，运行时与客户端继续共发版。

## Considered Options

- **选择器做进 WebView**（否决）：成员、频道、相册、表情资源都属于 Flutter 业务，搬进去会把运行时绑到客户端。
- **一个 `request_insert` + kind**（否决）：和现有 `request_close` 的一事件一意图不一致，Dart 侧也无法按类型分流。
- **空 payload，靠最近一次 selection_change**（否决）：工具栏点击会失焦，点击当下的选区必须随事件带上。
- **`isCircle` 开关**（否决）：产品模块名不能进编辑器包。
