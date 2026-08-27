/**
 * Display sizing for editor image/video embeds.
 * Mirrors Flutter `ImSingleImage` + `kImImageCachedSize`.
 *
 * - Mobile / phone WebView: 240×240 max
 * - Desktop (`UniversalPlatformX.isLandscape`): 320×320 max
 * - Long/wide (ratio > 2.5): clamp each axis independently + object-fit cover
 * - Normal: contain within the max box (preserve aspect ratio)
 */

export type MediaAspectType = "normal" | "long" | "wide";

export type MediaMaxSize = 240 | 320;

const MIN_SIZE = 100;
const LONG_RATIO = 2.5;

let mediaMaxSize: MediaMaxSize = 240;

export function setMediaMaxSize(size: MediaMaxSize): void {
  mediaMaxSize = size;
}

export function getMediaMaxSize(): MediaMaxSize {
  return mediaMaxSize;
}

export function parseMediaDimension(value: string | undefined): number | undefined {
  if (value === undefined) {
    return undefined;
  }

  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return undefined;
  }

  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return undefined;
  }

  return parsed;
}

export function mediaAspectType(width?: number, height?: number): MediaAspectType {
  if (width === undefined || height === undefined || width <= 0 || height <= 0) {
    return "normal";
  }

  if (width / height > LONG_RATIO) {
    return "wide";
  }

  if (height / width > LONG_RATIO) {
    return "long";
  }

  return "normal";
}

/**
 * Flutter `BoxConstraints.loose(max).constrainSizeAndAttemptToPreserveAspectRatio`.
 */
function containInMaxBox(
  width: number,
  height: number,
  maxSize: number,
): { width: number; height: number } {
  if (width <= maxSize && height <= maxSize) {
    return { width, height };
  }

  const scale = Math.min(maxSize / width, maxSize / height);
  return {
    width: width * scale,
    height: height * scale,
  };
}

export function computeMediaDisplaySize(
  intrinsicWidth?: number,
  intrinsicHeight?: number,
  maxSize: number = mediaMaxSize,
): { width: number; height: number; aspectType: MediaAspectType } {
  const aspectType = mediaAspectType(intrinsicWidth, intrinsicHeight);

  if (aspectType === "normal") {
    const contained = containInMaxBox(
      intrinsicWidth ?? MIN_SIZE,
      intrinsicHeight ?? MIN_SIZE,
      maxSize,
    );
    return { ...contained, aspectType };
  }

  return {
    width: Math.min(maxSize, intrinsicWidth ?? Number.POSITIVE_INFINITY),
    height: Math.min(maxSize, intrinsicHeight ?? Number.POSITIVE_INFINITY),
    aspectType,
  };
}

export function applyMediaDisplaySize(
  node: HTMLElement,
  widthAttr?: string,
  heightAttr?: string,
): void {
  const intrinsicWidth = parseMediaDimension(widthAttr);
  const intrinsicHeight = parseMediaDimension(heightAttr);
  const { width, height, aspectType } = computeMediaDisplaySize(intrinsicWidth, intrinsicHeight);

  node.style.width = `${width}px`;
  node.style.height = `${height}px`;
  node.style.maxWidth = "100%";
  node.style.objectFit = "cover";
  node.style.borderRadius = "12px";
  node.style.display = "block";
  node.dataset.mediaAspect = aspectType;
}

/**
 * Applies Parchment format mutations to an image or video blot DOM node.
 * Returns `true` if the attribute was handled, `false` otherwise.
 */
export function applyMediaBlotFormat(domNode: HTMLElement, name: string, value: unknown): boolean {
  if (name === "width") {
    if (typeof value === "string" || typeof value === "number") {
      const valStr = String(value);
      domNode.setAttribute("width", valStr);
      applyMediaDisplaySize(domNode, valStr, domNode.getAttribute("height") ?? undefined);
    } else {
      domNode.removeAttribute("width");
      applyMediaDisplaySize(domNode, undefined, domNode.getAttribute("height") ?? undefined);
    }
    return true;
  }

  if (name === "height") {
    if (typeof value === "string" || typeof value === "number") {
      const valStr = String(value);
      domNode.setAttribute("height", valStr);
      applyMediaDisplaySize(domNode, domNode.getAttribute("width") ?? undefined, valStr);
    } else {
      domNode.removeAttribute("height");
      applyMediaDisplaySize(domNode, domNode.getAttribute("width") ?? undefined, undefined);
    }
    return true;
  }

  if (name === "mimeType") {
    if (typeof value === "string") {
      domNode.setAttribute("data-mime-type", value);
    } else {
      domNode.removeAttribute("data-mime-type");
    }
    return true;
  }

  if (name === "fileSize") {
    if (typeof value === "number" || typeof value === "string") {
      domNode.setAttribute("data-file-size", String(value));
    } else {
      domNode.removeAttribute("data-file-size");
    }
    return true;
  }

  if (name === "poster") {
    if (typeof value === "string") {
      domNode.setAttribute("data-poster", value);
      const media = domNode.querySelector<HTMLVideoElement>(".tgg-video__media");
      if (media) {
        media.poster = value;
      }
    } else {
      domNode.removeAttribute("data-poster");
    }
    return true;
  }

  if (name === "duration") {
    if (typeof value === "number" || typeof value === "string") {
      domNode.setAttribute("data-duration", String(value));
    } else {
      domNode.removeAttribute("data-duration");
    }
    return true;
  }

  return false;
}
