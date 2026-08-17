import { afterEach, describe, expect, it } from "vite-plus/test";
import { ImageBlot } from "../src/blots/image-blot";
import { MEDIA_FALLBACK_SRC } from "../src/blots/media-fallback";
import { resolveMediaUri, setMediaUriResolver } from "../src/blots/media-uri";
import { VideoBlot } from "../src/blots/video-blot";

describe("media URI rendering", () => {
  afterEach(() => {
    setMediaUriResolver(null);
  });

  it("resolves local tokens to the runtime media route and keeps HTTPS unchanged", () => {
    expect(resolveMediaUri("tgg-local-media://image-token")).toBe("/__tg_media__/image-token");
    expect(resolveMediaUri("https://cdn.teamgaga.com/image.png")).toBe(
      "https://cdn.teamgaga.com/image.png",
    );
  });

  it("allows a host-owned resolver override for Blob object URLs", () => {
    setMediaUriResolver((uri) => {
      if (uri === "tgg-local-media://blob-token") {
        return "blob:https://app.example/abc";
      }
      return uri;
    });
    expect(resolveMediaUri("tgg-local-media://blob-token")).toBe("blob:https://app.example/abc");
  });

  it("renders local image and video media without changing their canonical values", () => {
    const image = ImageBlot.create({
      src: "tgg-local-media://image-token",
      width: "640",
      height: "480",
      mimeType: "image/png",
      fileSize: 12,
    }) as HTMLImageElement;
    const wrap = VideoBlot.create({
      src: "tgg-local-media://video-token",
      poster: "tgg-local-media://poster-token",
      width: "1280",
      height: "720",
      mimeType: "video/mp4",
      fileSize: 42,
      duration: 8,
    });
    const video = wrap.querySelector("video.tgg-video__media") as HTMLVideoElement;
    const play = wrap.querySelector("span.tgg-video__play");

    expect(image.src).toContain("/__tg_media__/image-token");
    expect(ImageBlot.value(image).src).toBe("tgg-local-media://image-token");
    expect(image.style.width).toBe("240px");
    expect(image.style.height).toBe("180px");
    expect(wrap.classList.contains("tgg-video")).toBe(true);
    expect(play).not.toBeNull();
    expect(video.src).toContain("/__tg_media__/video-token");
    expect(video.poster).toContain("/__tg_media__/poster-token");
    expect(wrap.style.width).toBe("240px");
    expect(wrap.style.height).toBe("135px");
    expect(VideoBlot.value(wrap)).toMatchObject({
      src: "tgg-local-media://video-token",
      poster: "tgg-local-media://poster-token",
    });
  });

  it("swaps failed images to the placeholder without changing the canonical src", () => {
    const image = ImageBlot.create({
      src: "tgg-local-media://missing-image",
      width: "320",
      height: "240",
    }) as HTMLImageElement;

    image.dispatchEvent(new Event("error"));

    expect(image.dataset.mediaMissing).toBe("true");
    expect(image.src).toBe(MEDIA_FALLBACK_SRC);
    expect(ImageBlot.value(image).src).toBe("tgg-local-media://missing-image");

    image.dispatchEvent(new Event("error"));
    expect(image.src).toBe(MEDIA_FALLBACK_SRC);
  });

  it("swaps failed videos to the placeholder poster without changing canonical values", () => {
    const wrap = VideoBlot.create({
      src: "tgg-local-media://missing-video",
      poster: "tgg-local-media://missing-poster",
      width: "640",
      height: "360",
    });
    const video = wrap.querySelector("video.tgg-video__media") as HTMLVideoElement;

    video.dispatchEvent(new Event("error"));

    expect(wrap.dataset.mediaMissing).toBe("true");
    expect(video.getAttribute("src")).toBeNull();
    expect(video.poster).toBe(MEDIA_FALLBACK_SRC);
    expect(VideoBlot.value(wrap)).toMatchObject({
      src: "tgg-local-media://missing-video",
      poster: "tgg-local-media://missing-poster",
    });
  });
});
