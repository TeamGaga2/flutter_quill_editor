import { afterEach, describe, expect, it } from "vite-plus/test";
import {
  computeMediaDisplaySize,
  mediaAspectType,
  parseMediaDimension,
  setMediaMaxSize,
} from "../src/blots/media-display-size";

afterEach(() => {
  setMediaMaxSize(240);
});

describe("media display size", () => {
  it("parses bare numeric dimension strings like Flutter StyleAttributeUtils", () => {
    expect(parseMediaDimension("1920")).toBe(1920);
    expect(parseMediaDimension("1920px")).toBeUndefined();
    expect(parseMediaDimension("")).toBeUndefined();
  });

  it("classifies long and wide media with a 2.5 ratio threshold", () => {
    expect(mediaAspectType(400, 300)).toBe("normal");
    expect(mediaAspectType(1000, 100)).toBe("wide");
    expect(mediaAspectType(100, 1000)).toBe("long");
  });

  it("contains normal media inside the 240 mobile box", () => {
    setMediaMaxSize(240);
    expect(computeMediaDisplaySize(400, 300)).toEqual({
      width: 240,
      height: 180,
      aspectType: "normal",
    });
    expect(computeMediaDisplaySize(100, 80)).toEqual({
      width: 100,
      height: 80,
      aspectType: "normal",
    });
  });

  it("clamps long and wide media independently like ImSingleImage", () => {
    setMediaMaxSize(240);
    expect(computeMediaDisplaySize(500, 100)).toEqual({
      width: 240,
      height: 100,
      aspectType: "wide",
    });
    expect(computeMediaDisplaySize(100, 1000)).toEqual({
      width: 100,
      height: 240,
      aspectType: "long",
    });
  });

  it("uses the 320 desktop box when configured", () => {
    setMediaMaxSize(320);
    expect(computeMediaDisplaySize(640, 480)).toEqual({
      width: 320,
      height: 240,
      aspectType: "normal",
    });
  });
});
