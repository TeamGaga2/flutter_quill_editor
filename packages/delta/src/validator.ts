import type { RichTextSnapshotV1 } from "./types";
import { RichTextDeltaError, type DeltaValidationIssue, type ValidationResult } from "./errors";
import {
  hasOwn,
  isAllowedLink,
  isAllowedMediaUri,
  isDecimalDimension,
  isNonEmptyString,
  isNonNegativeInteger,
  isRecord,
  isLocalMediaUri,
} from "./guards";

export type ValidationContext = "editor" | "draft" | "submission" | "server";

export type ValidateSnapshotOptions = {
  context?: ValidationContext;
};

const SNAPSHOT_KEYS = new Set(["title", "content", "size", "theme"]);

const THEMES = new Set(["yellow", "purple", "pink", "red", "blue", "green"]);

export function validateSnapshot(
  input: unknown,
  options: ValidateSnapshotOptions = {},
): ValidationResult {
  const issues: DeltaValidationIssue[] = [];
  const context = options.context ?? "editor";

  if (!isRecord(input)) {
    return {
      ok: false,
      issues: [
        {
          code: "INVALID_SNAPSHOT",
          path: "$",
          message: "Snapshot must be an object.",
        },
      ],
    };
  }

  for (const key of Object.keys(input)) {
    if (!SNAPSHOT_KEYS.has(key)) {
      issues.push({
        code: "INVALID_SNAPSHOT",
        path: `$.${key}`,
        message: `Unknown snapshot property: ${key}.`,
      });
    }
  }

  if (hasOwn(input, "title") && typeof input.title !== "string") {
    issues.push({
      code: "INVALID_SNAPSHOT",
      path: "$.title",
      message: "Title must be a string.",
    });
  }

  if (hasOwn(input, "size") && input.size !== "medium") {
    issues.push({
      code: "INVALID_SNAPSHOT",
      path: "$.size",
      message: 'Size must be "medium".',
    });
  }

  if (hasOwn(input, "theme") && !THEMES.has(input.theme as string)) {
    issues.push({
      code: "INVALID_SNAPSHOT",
      path: "$.theme",
      message: "Unknown theme.",
    });
  }

  if (!Array.isArray(input.content)) {
    issues.push({
      code: "INVALID_SNAPSHOT",
      path: "$.content",
      message: "Content must be an array.",
    });

    return {
      ok: false,
      issues,
    };
  }

  input.content.forEach((operation, index) => {
    validateOperation(operation, `$.content[${index}]`, context, issues);
  });

  if (!hasTerminalNewline(input.content)) {
    issues.push({
      code: "TERMINAL_NEWLINE_REQUIRED",
      path: "$.content",
      message: "Delta document must end with a newline.",
    });
  }

  return issues.length === 0 ? { ok: true } : { ok: false, issues };
}

const OPERATION_KEYS = new Set(["insert", "attributes"]);

function hasTerminalNewline(operations: unknown[]): boolean {
  const last = operations.at(-1);

  if (!isRecord(last)) {
    return false;
  }

  return typeof last.insert === "string" && last.insert.endsWith("\n");
}

function validateOperation(
  input: unknown,
  path: string,
  context: ValidationContext,
  issues: DeltaValidationIssue[],
): void {
  if (!isRecord(input)) {
    issues.push({
      code: "INVALID_OPERATION",
      path,
      message: "Operation must be an object.",
    });
    return;
  }

  for (const key of Object.keys(input)) {
    if (!OPERATION_KEYS.has(key)) {
      issues.push({
        code: "UNKNOWN_OPERATION_KEY",
        path: `${path}.${key}`,
        message: `Unknown operation property: ${key}.`,
      });
    }
  }

  if (!hasOwn(input, "insert")) {
    issues.push({
      code: "INVALID_INSERT",
      path: `${path}.insert`,
      message: "Operation must contain insert.",
    });
    return;
  }

  if (typeof input.insert === "string") {
    validateTextOperation(input, path, issues);
    return;
  }

  if (isRecord(input.insert)) {
    validateEmbedOperation(input, path, context, issues);
    return;
  }

  issues.push({
    code: "INVALID_INSERT",
    path: `${path}.insert`,
    message: "Insert must be a string or embed object.",
  });
}

const INLINE_ATTRIBUTE_KEYS = new Set(["bold", "italic", "underline", "strike", "link"]);

const BLOCK_ATTRIBUTE_KEYS = new Set(["header", "list", "indent", "blockquote"]);

function validateTextOperation(
  operation: Record<string, unknown>,
  path: string,
  issues: DeltaValidationIssue[],
): void {
  const insert = operation.insert as string;

  if (insert.length === 0) {
    issues.push({
      code: "INVALID_INSERT",
      path: `${path}.insert`,
      message: "Text insert must not be empty.",
    });
  }

  if (!hasOwn(operation, "attributes")) {
    return;
  }

  if (!isRecord(operation.attributes)) {
    issues.push({
      code: "INVALID_ATTRIBUTE",
      path: `${path}.attributes`,
      message: "Attributes must be an object.",
    });
    return;
  }

  const containsNewline = insert.includes("\n");
  const isOnlyNewlines = /^[\n]+$/.test(insert);

  if (containsNewline && !isOnlyNewlines) {
    issues.push({
      code: "INVALID_ATTRIBUTE",
      path: `${path}.insert`,
      message: "Text and newline characters must be split into separate operations.",
    });
    return;
  }

  if (isOnlyNewlines) {
    validateBlockAttributes(operation.attributes, `${path}.attributes`, issues);
    return;
  }

  validateInlineAttributes(operation.attributes, `${path}.attributes`, issues);
}

function validateInlineAttributes(
  attributes: Record<string, unknown>,
  path: string,
  issues: DeltaValidationIssue[],
): void {
  for (const [key, value] of Object.entries(attributes)) {
    if (!INLINE_ATTRIBUTE_KEYS.has(key)) {
      issues.push({
        code: "UNKNOWN_ATTRIBUTE",
        path: `${path}.${key}`,
        message: `Unknown inline attribute: ${key}.`,
      });
      continue;
    }

    if (key === "link") {
      if (!isAllowedLink(value)) {
        issues.push({
          code: "INVALID_LINK",
          path: `${path}.link`,
          message: "Link scheme is not allowed.",
        });
      }
      continue;
    }

    if (value !== true) {
      issues.push({
        code: "INVALID_ATTRIBUTE",
        path: `${path}.${key}`,
        message: `${key} must be true.`,
      });
    }
  }
}

function validateBlockAttributes(
  attributes: Record<string, unknown>,
  path: string,
  issues: DeltaValidationIssue[],
): void {
  for (const key of Object.keys(attributes)) {
    if (!BLOCK_ATTRIBUTE_KEYS.has(key)) {
      issues.push({
        code: "UNKNOWN_ATTRIBUTE",
        path: `${path}.${key}`,
        message: `Unknown block attribute: ${key}.`,
      });
    }
  }

  const { header, list, indent, blockquote } = attributes;

  if (header !== undefined && header !== 1 && header !== 2 && header !== 3) {
    issues.push({
      code: "INVALID_ATTRIBUTE",
      path: `${path}.header`,
      message: "Header must be 1, 2 or 3.",
    });
  }

  if (list !== undefined && list !== "ordered" && list !== "bullet") {
    issues.push({
      code: "INVALID_ATTRIBUTE",
      path: `${path}.list`,
      message: 'List must be "ordered" or "bullet".',
    });
  }

  if (
    indent !== undefined &&
    (!Number.isInteger(indent) || Number(indent) < 1 || Number(indent) > 5)
  ) {
    issues.push({
      code: "INVALID_ATTRIBUTE",
      path: `${path}.indent`,
      message: "Indent must be an integer from 1 to 5.",
    });
  }

  if (blockquote !== undefined && blockquote !== true) {
    issues.push({
      code: "INVALID_ATTRIBUTE",
      path: `${path}.blockquote`,
      message: "Blockquote must be true.",
    });
  }

  const mutuallyExclusive = [
    header !== undefined,
    list !== undefined,
    blockquote !== undefined,
  ].filter(Boolean).length;

  if (mutuallyExclusive > 1) {
    issues.push({
      code: "INVALID_ATTRIBUTE",
      path,
      message: "Header, list and blockquote are mutually exclusive.",
    });
  }

  if (indent !== undefined && list === undefined && blockquote === undefined) {
    issues.push({
      code: "INVALID_ATTRIBUTE",
      path: `${path}.indent`,
      message: "Indent may only be combined with list or blockquote.",
    });
  }
}

const EMBED_KEYS = new Set(["mention", "channel", "emoji", "divider", "image", "video"]);

function validateEmbedOperation(
  operation: Record<string, unknown>,
  path: string,
  context: ValidationContext,
  issues: DeltaValidationIssue[],
): void {
  const insert = operation.insert;

  if (!isRecord(insert)) {
    return;
  }

  const keys = Object.keys(insert);

  if (keys.length !== 1) {
    issues.push({
      code: "INVALID_EMBED",
      path: `${path}.insert`,
      message: "Embed object must contain exactly one key.",
    });
    return;
  }

  const embedKey = keys[0];

  if (!embedKey || !EMBED_KEYS.has(embedKey)) {
    issues.push({
      code: "UNKNOWN_EMBED",
      path: `${path}.insert`,
      message: `Unknown embed: ${embedKey ?? "<empty>"}.`,
    });
    return;
  }

  switch (embedKey) {
    case "mention":
      validateMention(operation, path, issues);
      break;

    case "channel":
      validateChannel(operation, path, issues);
      break;

    case "emoji":
      validateEmoji(operation, path, issues);
      break;

    case "divider":
      validateDivider(operation, path, issues);
      break;

    case "image":
      validateImage(operation, path, context, issues);
      break;

    case "video":
      validateVideo(operation, path, context, issues);
      break;
  }
}

function validateMention(
  operation: Record<string, unknown>,
  path: string,
  issues: DeltaValidationIssue[],
): void {
  const insert = operation.insert as Record<string, unknown>;

  if (!isNonEmptyString(insert.mention)) {
    issues.push({
      code: "INVALID_EMBED",
      path: `${path}.insert.mention`,
      message: "Mention id must be a non-empty string.",
    });
  }

  if (!isRecord(operation.attributes)) {
    issues.push({
      code: "INVALID_ATTRIBUTE",
      path: `${path}.attributes`,
      message: "Mention attributes are required.",
    });
    return;
  }

  const keys = Object.keys(operation.attributes);

  for (const key of keys) {
    if (key !== "sign" && key !== "displayText") {
      issues.push({
        code: "UNKNOWN_ATTRIBUTE",
        path: `${path}.attributes.${key}`,
        message: `Unknown mention attribute: ${key}.`,
      });
    }
  }

  if (operation.attributes.sign !== "!" && operation.attributes.sign !== "&") {
    issues.push({
      code: "INVALID_ATTRIBUTE",
      path: `${path}.attributes.sign`,
      message: 'Mention sign must be "!" or "&".',
    });
  }

  if (!isNonEmptyString(operation.attributes.displayText)) {
    issues.push({
      code: "INVALID_ATTRIBUTE",
      path: `${path}.attributes.displayText`,
      message: "Mention displayText must be non-empty.",
    });
  }
}

function validateChannel(
  operation: Record<string, unknown>,
  path: string,
  issues: DeltaValidationIssue[],
): void {
  const insert = operation.insert as Record<string, unknown>;

  if (!isNonEmptyString(insert.channel)) {
    issues.push({
      code: "INVALID_EMBED",
      path: `${path}.insert.channel`,
      message: "Channel id must be a non-empty string.",
    });
  }

  if (!isRecord(operation.attributes)) {
    issues.push({
      code: "INVALID_ATTRIBUTE",
      path: `${path}.attributes`,
      message: "Channel attributes are required.",
    });
    return;
  }

  const keys = Object.keys(operation.attributes);

  for (const key of keys) {
    if (key !== "displayText") {
      issues.push({
        code: "UNKNOWN_ATTRIBUTE",
        path: `${path}.attributes.${key}`,
        message: `Unknown channel attribute: ${key}.`,
      });
    }
  }

  if (!isNonEmptyString(operation.attributes.displayText)) {
    issues.push({
      code: "INVALID_ATTRIBUTE",
      path: `${path}.attributes.displayText`,
      message: "Channel displayText must be non-empty.",
    });
  }
}

function validateEmoji(
  operation: Record<string, unknown>,
  path: string,
  issues: DeltaValidationIssue[],
): void {
  const insert = operation.insert as Record<string, unknown>;

  if (!isNonEmptyString(insert.emoji)) {
    issues.push({
      code: "INVALID_EMBED",
      path: `${path}.insert.emoji`,
      message: "Emoji id must be a non-empty string.",
    });
  }

  if (hasOwn(operation, "attributes")) {
    issues.push({
      code: "INVALID_ATTRIBUTE",
      path: `${path}.attributes`,
      message: "Emoji must not contain attributes.",
    });
  }
}

function validateDivider(
  operation: Record<string, unknown>,
  path: string,
  issues: DeltaValidationIssue[],
): void {
  const insert = operation.insert as Record<string, unknown>;

  if (insert.divider !== "true") {
    issues.push({
      code: "INVALID_EMBED",
      path: `${path}.insert.divider`,
      message: 'Divider value must be "true".',
    });
  }

  if (hasOwn(operation, "attributes")) {
    issues.push({
      code: "INVALID_ATTRIBUTE",
      path: `${path}.attributes`,
      message: "Divider must not contain attributes.",
    });
  }
}

function validateMediaUri(
  value: unknown,
  path: string,
  context: ValidationContext,
  issues: DeltaValidationIssue[],
): void {
  if (!isAllowedMediaUri(value)) {
    issues.push({
      code: "INVALID_MEDIA_URI",
      path,
      message: "Media URI must be HTTPS or tgg-local-media.",
    });
    return;
  }

  if (context === "server" && isLocalMediaUri(value)) {
    issues.push({
      code: "LOCAL_MEDIA_NOT_ALLOWED",
      path,
      message: "Local media URI is not allowed in server content.",
    });
  }
}

function validateBaseMediaAttributes(
  attributes: unknown,
  path: string,
  issues: DeltaValidationIssue[],
): attributes is Record<string, unknown> {
  if (!isRecord(attributes)) {
    issues.push({
      code: "INVALID_ATTRIBUTE",
      path,
      message: "Media attributes are required.",
    });
    return false;
  }

  if (!isDecimalDimension(attributes.width)) {
    issues.push({
      code: "INVALID_ATTRIBUTE",
      path: `${path}.width`,
      message: "Media width must be a decimal integer string.",
    });
  }

  if (!isDecimalDimension(attributes.height)) {
    issues.push({
      code: "INVALID_ATTRIBUTE",
      path: `${path}.height`,
      message: "Media height must be a decimal integer string.",
    });
  }

  if (!isNonEmptyString(attributes.mimeType)) {
    issues.push({
      code: "INVALID_ATTRIBUTE",
      path: `${path}.mimeType`,
      message: "Media mimeType must be non-empty.",
    });
  }

  if (!isNonNegativeInteger(attributes.fileSize)) {
    issues.push({
      code: "INVALID_ATTRIBUTE",
      path: `${path}.fileSize`,
      message: "Media fileSize must be a non-negative integer.",
    });
  }

  return true;
}

function validateImage(
  operation: Record<string, unknown>,
  path: string,
  context: ValidationContext,
  issues: DeltaValidationIssue[],
): void {
  const insert = operation.insert as Record<string, unknown>;

  validateMediaUri(insert.image, `${path}.insert.image`, context, issues);

  if (!validateBaseMediaAttributes(operation.attributes, `${path}.attributes`, issues)) {
    return;
  }

  const allowed = new Set(["width", "height", "mimeType", "fileSize"]);

  for (const key of Object.keys(operation.attributes)) {
    if (!allowed.has(key)) {
      issues.push({
        code: "UNKNOWN_ATTRIBUTE",
        path: `${path}.attributes.${key}`,
        message: `Unknown image attribute: ${key}.`,
      });
    }
  }
}

function validateVideo(
  operation: Record<string, unknown>,
  path: string,
  context: ValidationContext,
  issues: DeltaValidationIssue[],
): void {
  const insert = operation.insert as Record<string, unknown>;

  validateMediaUri(insert.video, `${path}.insert.video`, context, issues);

  if (!validateBaseMediaAttributes(operation.attributes, `${path}.attributes`, issues)) {
    return;
  }

  const allowed = new Set(["width", "height", "mimeType", "fileSize", "poster", "duration"]);

  for (const key of Object.keys(operation.attributes)) {
    if (!allowed.has(key)) {
      issues.push({
        code: "UNKNOWN_ATTRIBUTE",
        path: `${path}.attributes.${key}`,
        message: `Unknown video attribute: ${key}.`,
      });
    }
  }

  if (operation.attributes.poster !== undefined) {
    validateMediaUri(operation.attributes.poster, `${path}.attributes.poster`, context, issues);
  }

  if (
    operation.attributes.duration !== undefined &&
    !isNonNegativeInteger(operation.attributes.duration)
  ) {
    issues.push({
      code: "INVALID_ATTRIBUTE",
      path: `${path}.attributes.duration`,
      message: "Video duration must be a non-negative integer.",
    });
  }
}
export function assertValidSnapshot(
  input: unknown,
  options: ValidateSnapshotOptions = {},
): asserts input is RichTextSnapshotV1 {
  const result = validateSnapshot(input, options);

  if (!result.ok) {
    throw new RichTextDeltaError("Invalid RichTextSnapshotV1.", result.issues);
  }
}
