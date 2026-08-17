# @teamgaga/richtext-testing

TeamGaga 富文本 monorepo 的共享测试基础设施。

## API

### `loadDeltaFixture()`

加载 `src/delta.json` 中来自生产环境的完整历史 Delta。每次调用都会返回深拷贝，测试之间可以安全修改。fixture 会原样保留历史数据，不保证符合当前 canonical schema，可用于迁移与兼容性测试。

```ts
import { loadDeltaFixture } from "@teamgaga/richtext-testing";

const snapshot = loadDeltaFixture();
```

### `MockEditorAdapter`

不启动 Quill 即可测试 `richtext-core` 或 UI 集成。

```ts
import { MockEditorAdapter } from "@teamgaga/richtext-testing";

const adapter = new MockEditorAdapter({
  snapshot: { content: [{ insert: "hello\n" }] },
});
adapter.emit({ type: "change" });
```

### `expectSnapshotEqual(actual, expected)`

规范化两个 snapshot 后进行深度比较。

```ts
expectSnapshotEqual(actual, expected);
```

## Development

```bash
vp test
vp check
vp pack
```
