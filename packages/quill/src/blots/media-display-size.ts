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
