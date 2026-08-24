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

  format(name: string, value: unknown) {
    const domNode = this.domNode as HTMLImageElement;
    if (name === "width") {
      if (typeof value === "string" || typeof value === "number") {
        const valStr = String(value);
        domNode.setAttribute("width", valStr);
        applyMediaDisplaySize(domNode, valStr, domNode.getAttribute("height") ?? undefined);
      } else {
        domNode.removeAttribute("width");
      }
    } else if (name === "height") {
      if (typeof value === "string" || typeof value === "number") {
        const valStr = String(value);
        domNode.setAttribute("height", valStr);
        applyMediaDisplaySize(domNode, domNode.getAttribute("width") ?? undefined, valStr);
      } else {
        domNode.removeAttribute("height");
      }
    } else if (name === "mimeType") {
      if (typeof value === "string") {
        domNode.setAttribute("data-mime-type", value);
      } else {
        domNode.removeAttribute("data-mime-type");
      }
    } else if (name === "fileSize") {
      if (typeof value === "number" || typeof value === "string") {
        domNode.setAttribute("data-file-size", String(value));
      } else {
        domNode.removeAttribute("data-file-size");
      }
    } else {
      super.format(name, value);
    }
  }
}
