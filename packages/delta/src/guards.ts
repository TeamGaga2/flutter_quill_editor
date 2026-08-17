export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function hasOwn(value: object, key: PropertyKey): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

export function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

export function isNonNegativeInteger(value: unknown): value is number {
  return Number.isInteger(value) && Number(value) >= 0;
}

export function isDecimalDimension(value: unknown): value is string {
  return typeof value === "string" && /^(0|[1-9]\d*)$/.test(value);
}

export function isAllowedLink(value: unknown): value is string {
  if (typeof value !== "string") {
    return false;
  }

  const trimmed = value.trim();

  try {
    const url = new URL(trimmed);

    return (
      url.protocol === "http:" ||
      url.protocol === "https:" ||
      url.protocol === "mp:" ||
      url.protocol === "mps:"
    );
  } catch {
    return false;
  }
}

export function isLocalMediaUri(value: unknown): value is string {
  return typeof value === "string" && /^tgg-local-media:\/\/[^/\s?#]+$/.test(value);
}

export function isHttpsMediaUri(value: unknown): value is string {
  if (typeof value !== "string") {
    return false;
  }

  try {
    const url = new URL(value);
    return url.protocol === "https:";
  } catch {
    return false;
  }
}

export function isAllowedMediaUri(value: unknown): value is string {
  return isHttpsMediaUri(value) || isLocalMediaUri(value);
}
