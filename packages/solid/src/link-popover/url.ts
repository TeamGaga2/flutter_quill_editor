const DANGEROUS_SCHEME_PATTERN = /^(?:javascript|data|vbscript):/i;

// http / https URLs must have a valid host:
// - localhost (with optional port)
// - IPv4 address (e.g. 127.0.0.1:8080)
// - Domain with at least one dot and a 2+ char TLD (e.g. baidu.com, www.google.com)
const HTTP_URL_PATTERN =
  /^https?:\/\/(?:localhost(?::\d+)?|(?:\d{1,3}\.){3}\d{1,3}(?::\d+)?|(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]*[a-zA-Z0-9])?\.)+[a-zA-Z0-9-]{2,63}(?::\d+)?)(?:[/?#][^\s]*)?$/i;

// mp / mps miniprogram URLs (e.g. mp://miniapp/path or mps://app.teamgaga.com)
const MP_URL_PATTERN = /^mps?:\/\/[a-zA-Z0-9_.-]+(?:\/[^\s]*)?$/i;

const MAILTO_PATTERN = /^mailto:[^\s@]+@[^\s@]+\.[^\s@]+$/i;
const TEL_SMS_PATTERN = /^(?:tel|sms):[+0-9-]+$/i;

export function isValidUrl(raw: string): boolean {
  const trimmed = raw.trim();
  if (!trimmed) {
    return false;
  }

  if (DANGEROUS_SCHEME_PATTERN.test(trimmed)) {
    return false;
  }

  return (
    HTTP_URL_PATTERN.test(trimmed) ||
    MP_URL_PATTERN.test(trimmed) ||
    MAILTO_PATTERN.test(trimmed) ||
    TEL_SMS_PATTERN.test(trimmed)
  );
}
