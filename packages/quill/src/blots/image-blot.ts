import { BlockEmbed } from "quill/blots/block";
import { applyMediaBlotFormat, applyMediaDisplaySize } from "./media-display-size";
import { bindImageLoadFallback } from "./media-fallback";
import { resolveMediaUri } from "./media-uri";

export interface ImageValue {
  src: string;
  width?: string;
  height?: string;
  mimeType?: string;
  fileSize?: number;
}

/**
 * Image as a block embed so media always occupies its own line
 * (matches Flutter Quill `BlockEmbed.image`).
 */
export class ImageBlot extends BlockEmbed {
  static blotName = "image";

  static tagName = "img";

  static className = "tgg-image";

  static create(value: string | ImageValue) {
    const node = super.create() as HTMLImageElement;
    const src = typeof value === "string" ? value : (value?.src ?? "");
    const width = typeof value === "string" ? undefined : value?.width;
    const height = typeof value === "string" ? undefined : value?.height;
    const mimeType = typeof value === "string" ? undefined : value?.mimeType;
    const fileSize = typeof value === "string" ? undefined : value?.fileSize;

    node.setAttribute("data-src", src);

    if (width) {
      node.setAttribute("width", width);
    }

    if (height) {
      node.setAttribute("height", height);
    }

    if (mimeType) {
      node.setAttribute("data-mime-type", mimeType);
    }

    if (fileSize !== undefined) {
      node.setAttribute("data-file-size", String(fileSize));
    }

    applyMediaDisplaySize(node, width, height);
    bindImageLoadFallback(node);
    node.src = resolveMediaUri(src);

    return node;
  }

  static value(node: HTMLImageElement): ImageValue {
    const value: ImageValue = {
      src: node.dataset.src ?? node.src,
      width: node.getAttribute("width") ?? undefined,
      height: node.getAttribute("height") ?? undefined,
    };

    const mimeType = node.getAttribute("data-mime-type");
    if (mimeType !== null) {
      value.mimeType = mimeType;
    }

    const fileSize = node.getAttribute("data-file-size");
    if (fileSize !== null) {
      value.fileSize = Number(fileSize);
    }

    return value;
  }

  /**
   * Parchment embed attribute mutation contract.
   * Ensures attribute updates (e.g. width/height) update DOM attributes and display size.
   */
  format(name: string, value: unknown): void {
    if (!applyMediaBlotFormat(this.domNode as HTMLElement, name, value)) {
      super.format(name, value);
    }
  }
}
