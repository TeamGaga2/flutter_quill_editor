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

  static create(value: VideoValue) {
    const node = super.create() as HTMLDivElement;
    node.setAttribute("contenteditable", "false");

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

    if (value.poster) {
      node.setAttribute("data-poster", value.poster);
    }

    if (value.duration !== undefined) {
      node.setAttribute("data-duration", String(value.duration));
    }

    applyMediaDisplaySize(node, value.width, value.height);

    const media = document.createElement("video");
    media.className = "tgg-video__media";
    media.setAttribute("playsinline", "");
    media.setAttribute("preload", "metadata");
    media.controls = false;
    media.src = resolveMediaUri(value.src);

    if (value.poster) {
      media.poster = resolveMediaUri(value.poster);
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
    const poster = node.dataset.poster;
    if (poster) {
      value.poster = poster;
    }

    const duration = node.getAttribute("data-duration");
    if (duration !== null) {
      value.duration = Number(duration);
    }

    return value;
  }
}
