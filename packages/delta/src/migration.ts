import type { RichTextSnapshotV1 } from "./types";
import type { DeltaValidationIssue } from "./errors";
import { isRecord } from "./guards";
import { normalizeSnapshot } from "./normalizer";
import { validateSnapshot } from "./validator";

export type MigrationResult =
  | {
      ok: true;
      value: RichTextSnapshotV1;
      changed: boolean;
    }
  | {
      ok: false;
      issues: DeltaValidationIssue[];
    };

type HistoricalSnapshotCandidate = {
  content: unknown[];
  title?: unknown;
  size?: unknown;
  theme?: unknown;
};

function isHistoricalSnapshotCandidate(value: unknown): value is HistoricalSnapshotCandidate {
  return isRecord(value) && Array.isArray(value.content);
}

export function migrateHistoricalSnapshot(input: unknown): MigrationResult {
  if (!isHistoricalSnapshotCandidate(input)) {
    return {
      ok: false,
      issues: [
        {
          code: "UNSUPPORTED_HISTORICAL_CONTENT",
          path: "$",
          message: "Historical snapshot shape is unsupported.",
        },
      ],
    };
  }

  const cloned = structuredClone<HistoricalSnapshotCandidate>(input);

  let changed = false;

  for (const operation of cloned.content) {
    if (!isRecord(operation)) {
      continue;
    }

    if (isRecord(operation.insert) && typeof operation.insert.divider === "boolean") {
      operation.insert.divider = operation.insert.divider ? "true" : "false";

      changed = true;
    }

    if (!isRecord(operation.attributes)) {
      continue;
    }

    const attributes = operation.attributes;

    for (const key of ["bold", "italic", "underline", "strike", "blockquote"]) {
      if (attributes[key] === "true") {
        attributes[key] = true;
        changed = true;
      }
    }

    for (const key of ["header", "indent"]) {
      const value = attributes[key];

      if (typeof value === "string" && /^\d+$/.test(value)) {
        attributes[key] = Number(value);
        changed = true;
      }
    }

    for (const key of ["width", "height"]) {
      const value = attributes[key];

      if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
        attributes[key] = String(Math.trunc(value));
        changed = true;
      }
    }

    if ("index" in attributes) {
      delete attributes.index;
      changed = true;
    }

    if ("id" in attributes) {
      delete attributes.id;
      changed = true;
    }
  }

  const validation = validateSnapshot(cloned);

  if (!validation.ok) {
    return {
      ok: false,
      issues: validation.issues,
    };
  }

  // validateSnapshot 目前只是返回结果，并不会自动
  // 把 cloned 收窄为 RichTextSnapshotV1。
  const normalized = normalizeSnapshot(cloned as RichTextSnapshotV1);

  return {
    ok: true,
    value: normalized,
    changed: changed || JSON.stringify(normalized) !== JSON.stringify(input),
  };
}
