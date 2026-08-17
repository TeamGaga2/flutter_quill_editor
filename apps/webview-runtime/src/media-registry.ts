import type { HostControlOperation } from "@teamgaga/richtext-host-web";

const LOCAL_MEDIA_PREFIX = "tgg-local-media://";

/** token → object URL registrations from the Flutter Web host-control plane. */
const registrations = new Map<string, string>();

export function clearMediaRegistrations(): void {
  registrations.clear();
}

function defaultLoopbackUri(uri: string): string {
  if (!uri.startsWith(LOCAL_MEDIA_PREFIX)) {
    return uri;
  }
  const token = uri.slice(LOCAL_MEDIA_PREFIX.length);
  return `/__tg_media__/${encodeURIComponent(token)}`;
}

export function resolveRegisteredMediaUri(uri: string): string {
  if (!uri.startsWith(LOCAL_MEDIA_PREFIX)) {
    return uri;
  }
  const token = uri.slice(LOCAL_MEDIA_PREFIX.length);
  return registrations.get(token) ?? defaultLoopbackUri(uri);
}

export function applyMediaHostControl(operation: HostControlOperation): void {
  if (operation.type === "registerMedia") {
    registrations.set(operation.token, operation.objectUrl);
    return;
  }
  if (operation.type === "revokeMedia") {
    registrations.delete(operation.token);
  }
}
