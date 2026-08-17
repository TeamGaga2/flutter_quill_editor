const LOCAL_MEDIA_PREFIX = "tgg-local-media://";

export type MediaUriResolver = (uri: string) => string;

/**
 * Default resolver: keeps local media canonical in Delta while giving the
 * native WebView DOM a fetchable loopback URL.
 */
export function defaultResolveMediaUri(uri: string): string {
  if (!uri.startsWith(LOCAL_MEDIA_PREFIX)) {
    return uri;
  }

  const token = uri.slice(LOCAL_MEDIA_PREFIX.length);
  return `/__tg_media__/${encodeURIComponent(token)}`;
}

let customResolver: MediaUriResolver | null = null;

/** Host-owned override (Flutter Web Blob object URLs). Pass null to restore default. */
export function setMediaUriResolver(resolver: MediaUriResolver | null): void {
  customResolver = resolver;
}

/**
 * Keeps local media canonical in Delta while giving the DOM a fetchable URL.
 * Native: loopback `/__tg_media__/<token>`. Web: host-registered object URL.
 */
export function resolveMediaUri(uri: string): string {
  return (customResolver ?? defaultResolveMediaUri)(uri);
}
