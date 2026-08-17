export type DeltaErrorCode =
  | "INVALID_SNAPSHOT"
  | "INVALID_OPERATION"
  | "UNKNOWN_OPERATION_KEY"
  | "INVALID_INSERT"
  | "UNKNOWN_EMBED"
  | "INVALID_EMBED"
  | "UNKNOWN_ATTRIBUTE"
  | "INVALID_ATTRIBUTE"
  | "INVALID_LINK"
  | "INVALID_MEDIA_URI"
  | "LOCAL_MEDIA_NOT_ALLOWED"
  | "TERMINAL_NEWLINE_REQUIRED"
  | "UNSUPPORTED_HISTORICAL_CONTENT";

export type DeltaValidationIssue = {
  code: DeltaErrorCode;
  path: string;
  message: string;
};

export type ValidationResult =
  | {
      ok: true;
    }
  | {
      ok: false;
      issues: DeltaValidationIssue[];
    };

export class RichTextDeltaError extends Error {
  readonly issues: DeltaValidationIssue[];

  constructor(message: string, issues: DeltaValidationIssue[]) {
    super(message);
    this.name = "RichTextDeltaError";
    this.issues = issues;
  }
}
