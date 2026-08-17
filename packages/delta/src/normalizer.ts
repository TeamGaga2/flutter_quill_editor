import type { DeltaOperation, RichTextSnapshotV1, TextDeltaOperation } from "./types";

import { assertValidSnapshot } from "./validator";

export function normalizeSnapshot(input: RichTextSnapshotV1): RichTextSnapshotV1 {
  const normalized: RichTextSnapshotV1 = {
    content: normalizeOperations(input.content),
  };

  if (input.title !== undefined) {
    normalized.title = input.title;
  }

  if (input.size !== undefined) {
    normalized.size = input.size;
  }

  if (input.theme !== undefined) {
    normalized.theme = input.theme;
  }

  assertValidSnapshot(normalized);

  return normalized;
}

export function normalizeOperations(input: readonly DeltaOperation[]): DeltaOperation[] {
  const output: DeltaOperation[] = [];

  for (const operation of input) {
    const normalized = normalizeOperation(operation);

    if (isTextOperation(normalized) && normalized.insert.length === 0) {
      continue;
    }

    const previous = output.at(-1);

    if (
      previous &&
      isTextOperation(previous) &&
      isTextOperation(normalized) &&
      !previous.insert.includes("\n") &&
      !normalized.insert.includes("\n") &&
      haveSameAttributes(previous, normalized)
    ) {
      previous.insert += normalized.insert;
      continue;
    }

    output.push(normalized);
  }

  ensureTerminalNewline(output);

  return output;
}

function isTextOperation(operation: DeltaOperation): operation is TextDeltaOperation {
  return typeof operation.insert === "string";
}

function normalizeOperation(operation: DeltaOperation): DeltaOperation {
  if (!isTextOperation(operation)) {
    return structuredClone(operation);
  }

  const insert = operation.insert.replaceAll("\r\n", "\n").replaceAll("\r", "\n");

  const attributes =
    operation.attributes && Object.keys(operation.attributes).length > 0
      ? structuredClone(operation.attributes)
      : undefined;

  return attributes
    ? {
        insert,
        attributes,
      }
    : {
        insert,
      };
}

function haveSameAttributes(left: TextDeltaOperation, right: TextDeltaOperation): boolean {
  return stableJson(left.attributes) === stableJson(right.attributes);
}

function stableJson(value: unknown): string {
  if (value === undefined) {
    return "";
  }

  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return JSON.stringify(value);
  }

  return JSON.stringify(
    Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right))),
  );
}

function ensureTerminalNewline(operations: DeltaOperation[]): void {
  if (operations.length === 0) {
    operations.push({
      insert: "\n",
    });
    return;
  }

  const last = operations.at(-1);

  if (last && isTextOperation(last) && last.insert.endsWith("\n")) {
    return;
  }

  operations.push({
    insert: "\n",
  });
}
