import assert from "node:assert/strict";

import { normalizeSnapshot, type RichTextSnapshotV1 } from "@teamgaga/richtext-delta";

/** 比较两个 snapshot 的规范化结果。 */
export function expectSnapshotEqual(
  actual: RichTextSnapshotV1,
  expected: RichTextSnapshotV1,
): void {
  assert.deepStrictEqual(normalizeSnapshot(actual), normalizeSnapshot(expected));
}
