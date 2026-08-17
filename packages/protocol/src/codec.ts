import type { ProtocolParseResult, ProtocolValidationIssue } from "./errors";
import { parseProtocolMessage, type ProtocolMessage } from "./guards";

export function encodeProtocolMessage(message: ProtocolMessage): string {
  const parsed = parseProtocolMessage(message);

  if (!parsed.ok) {
    const firstIssue = parsed.error.issues[0];
    throw new TypeError(
      firstIssue
        ? `Cannot encode invalid protocol message at ${firstIssue.path}: ${firstIssue.message}`
        : "Cannot encode invalid protocol message.",
    );
  }

  try {
    const encoded = JSON.stringify(sanitizeForJson(parsed.value));
    const roundTrip = decodeProtocolMessage(encoded);

    if (!roundTrip.ok) {
      throw new TypeError("Serialized protocol message failed validation.");
    }

    return encoded;
  } catch (error) {
    if (
      error instanceof TypeError &&
      error.message === "Serialized protocol message failed validation."
    ) {
      throw error;
    }

    throw new TypeError("Protocol message is not JSON-serializable.", { cause: error });
  }
}

function sanitizeForJson(input: unknown): unknown {
  if (Array.isArray(input)) {
    const output = input.map((value) => sanitizeForJson(value));
    Object.defineProperty(output, "toJSON", { value: undefined });
    return output;
  }

  if (typeof input === "object" && input !== null) {
    const output: Record<string, unknown> = Object.create(null) as Record<string, unknown>;

    for (const [key, value] of Object.entries(input)) {
      output[key] = sanitizeForJson(value);
    }

    return output;
  }

  return input;
}

export function decodeProtocolMessage(raw: string): ProtocolParseResult<ProtocolMessage> {
  let input: unknown;

  try {
    input = JSON.parse(raw) as unknown;
  } catch {
    const issue: ProtocolValidationIssue = {
      code: "invalid_json",
      path: "$",
      message: "Protocol message must be valid JSON.",
    };

    return {
      ok: false,
      error: {
        code: "invalid_json",
        message: issue.message,
        issues: [issue],
      },
    };
  }

  return parseProtocolMessage(input);
}
