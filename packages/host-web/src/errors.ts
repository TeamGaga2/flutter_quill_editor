export type RichTextHostErrorPhase = "decode" | "dispatch" | "event" | "send" | "mount" | "destroy";

export interface RichTextHostError {
  phase: RichTextHostErrorPhase;
  code: string;
  message: string;
}

export function createHostError(
  phase: RichTextHostErrorPhase,
  code: string,
  message: string,
): RichTextHostError {
  return { phase, code, message };
}

export function sanitizeErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && typeof error.message === "string" && error.message.length > 0) {
    // Keep host-facing messages short and non-sensitive.
    const message = error.message.trim();
    if (message.length > 0 && message.length <= 200 && !message.includes("\n")) {
      return message;
    }
  }

  return fallback;
}

export function toMountError(error: unknown): RichTextHostError {
  return createHostError(
    "mount",
    "mount_failed",
    sanitizeErrorMessage(error, "Host mount failed."),
  );
}

export function toDestroyError(error: unknown): RichTextHostError {
  return createHostError(
    "destroy",
    "destroy_failed",
    sanitizeErrorMessage(error, "Host destroy failed."),
  );
}
