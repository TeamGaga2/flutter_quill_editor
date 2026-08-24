import { BlockEmbed } from "quill/blots/block";
import { applyMediaDisplaySize } from "./media-display-size";
import { bindVideoLoadFallback } from "./media-fallback";
import { resolveMediaUri } from "./media-uri";

export interface VideoValue {
  src: string;
  width?: string;
  height?: string;
  mimeType?: string;
  fileSize?: number;
  poster?: string;
  duration?: number;
}

/**
 * Video as a block embed so media always occupies its own line
 * (matches Flutter Quill `BlockEmbed.video`).
 *
 * DOM mirrors Flutter `ImSingleImage(video: true)`: poster/video cover plus a
 * centered semi-transparent play button (`AppIconButton.black60`).
 */
export class VideoBlot extends BlockEmbed {
  static blotName = "video";

  /** Block-level wrapper — `<video>` alone cannot host a reliable overlay. */
  static tagName = "div";

  static className = "tgg-video";

  static create(value: string | VideoValue) {
    const node = super.create() as HTMLDivElement;
    node.setAttribute("contenteditable", "false");

    const src = typeof value === "string" ? value : (value?.src ?? "");
    const width = typeof value === "string" ? undefined : value?.width;
    const height = typeof value === "string" ? undefined : value?.height;
    const mimeType = typeof value === "string" ? undefined : value?.mimeType;
    const fileSize = typeof value === "string" ? undefined : value?.fileSize;
    const poster = typeof value === "string" ? undefined : value?.poster;
    const duration = typeof value === "string" ? undefined : value?.duration;

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

    if (poster) {
      node.setAttribute("data-poster", poster);
    }

    if (duration !== undefined) {
      node.setAttribute("data-duration", String(duration));
    }

    applyMediaDisplaySize(node, width, height);

    const media = document.createElement("video");
    media.className = "tgg-video__media";
    media.setAttribute("playsinline", "");
    media.setAttribute("preload", "metadata");
    media.controls = false;
    media.src = resolveMediaUri(src);

    if (poster) {
      media.poster = resolveMediaUri(poster);
    }

    bindVideoLoadFallback(media);

    const play = document.createElement("span");
    play.className = "tgg-video__play";
    play.setAttribute("aria-hidden", "true");

    node.append(media, play);
    return node;
  }

  static value(node: HTMLElement): VideoValue {
    const value: VideoValue = {
      src: node.dataset.src ?? "",
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

    // Prefer canonical poster from data-poster so a fallback data-URI never leaks
    // into snapshots after a load failure.
    const poster = node.dataset.poster ?? node.getAttribute("data-poster");
    if (poster) {
      value.poster = poster;
    }

    const duration = node.getAttribute("data-duration");
    if (duration !== null) {
      value.duration = Number(duration);
    }

    return value;
  }

  format(name: string, value: unknown) {
    const domNode = this.domNode as HTMLDivElement;
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
    } else if (name === "poster") {
      if (typeof value === "string") {
        domNode.setAttribute("data-poster", value);
        const media = domNode.querySelector<HTMLVideoElement>(".tgg-video__media");
        if (media) media.poster = resolveMediaUri(value);
      } else {
        domNode.removeAttribute("data-poster");
      }
    } else if (name === "duration") {
      if (typeof value === "number" || typeof value === "string") {
        domNode.setAttribute("data-duration", String(value));
      } else {
        domNode.removeAttribute("data-duration");
      }
    } else {
      super.format(name, value);
    }
  }
}
