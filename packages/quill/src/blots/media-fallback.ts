/**
 * Fallback visual for failed image/video loads in the editor.
 * Matches Flutter `Assets.svg.imageNotExists` (tgg_design).
 */
const IMAGE_NOT_EXISTS_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="204" height="204" viewBox="0 0 204 204" fill="none"><g clip-path="url(#clip0)"><rect width="204" height="204" rx="8" fill="#E3E3E3"/><g clip-path="url(#clip1)"><rect width="272" height="204" transform="translate(-34)" fill="white"/><path d="M13.0257 113.137C-15.0693 112.833 -40.031 173.586 -49 204H271C262.439 185.676 193.337 65 148.346 65C103.356 65 90.7761 145.988 70.2465 146.178C49.7169 146.368 48.1444 113.517 13.0257 113.137Z" fill="#F1F1F1"/><ellipse cx="64" cy="51" rx="21" ry="22" fill="#F1F1F1"/></g></g><defs><clipPath id="clip0"><rect width="204" height="204" rx="8" fill="white"/></clipPath><clipPath id="clip1"><rect width="272" height="204" fill="white" transform="translate(-34)"/></clipPath></defs></svg>`;

export const MEDIA_FALLBACK_SRC = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(IMAGE_NOT_EXISTS_SVG)}`;

const MEDIA_MISSING_ATTR = "mediaMissing";

function markMediaMissing(node: HTMLElement): boolean {
  if (node.dataset[MEDIA_MISSING_ATTR] === "true") {
    return false;
  }

  node.dataset[MEDIA_MISSING_ATTR] = "true";
  return true;
}

/**
 * Swap a failed `<img>` to the Flutter-equivalent placeholder.
 * Preserves `data-src` so snapshot round-trips keep the canonical URI.
 */
export function bindImageLoadFallback(node: HTMLImageElement): void {
  node.addEventListener("error", () => {
    if (!markMediaMissing(node)) {
      return;
    }

    node.src = MEDIA_FALLBACK_SRC;
  });
}

/**
 * When a `<video>` fails to load, show the same placeholder as Flutter's
 * poster `errorBuilder` path. Canonical `data-src` / `data-poster` are kept
 * on the `.tgg-video` wrapper (or the video node when used alone).
 */
export function bindVideoLoadFallback(node: HTMLVideoElement): void {
  node.addEventListener("error", () => {
    const host = (node.closest(".tgg-video") as HTMLElement | null) ?? node;
    if (!markMediaMissing(host)) {
      return;
    }

    node.removeAttribute("src");
    node.poster = MEDIA_FALLBACK_SRC;

    try {
      node.load();
    } catch {
      // Some environments (jsdom/happy-dom) may not implement load().
    }
  });
}
