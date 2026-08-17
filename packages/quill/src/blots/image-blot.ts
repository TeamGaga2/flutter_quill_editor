import { BlockEmbed } from "quill/blots/block";
import { applyMediaDisplaySize } from "./media-display-size";
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

  static create(value: ImageValue) {
    const node = super.create() as HTMLImageElement;

    node.setAttribute("data-src", value.src);

    if (value.width) {
      node.setAttribute("width", value.width);
    }

    if (value.height) {
      node.setAttribute("height", value.height);
    }

    if (value.mimeType) {
      node.setAttribute("data-mime-type", value.mimeType);
    }

    if (value.fileSize !== undefined) {
      node.setAttribute("data-file-size", String(value.fileSize));
    }

    applyMediaDisplaySize(node, value.width, value.height);
    bindImageLoadFallback(node);
    node.src = resolveMediaUri(value.src);

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
}
