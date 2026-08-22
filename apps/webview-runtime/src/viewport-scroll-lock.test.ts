import { afterEach, describe, expect, it } from "vite-plus/test";
import { createViewportScrollLock, type ViewportScrollLock } from "./viewport-scroll-lock";

let lock: ViewportScrollLock | undefined;

afterEach(() => {
  lock?.destroy();
  lock = undefined;
  document.body.innerHTML = "";
  document.documentElement.scrollTop = 0;
  document.documentElement.scrollLeft = 0;
  document.body.scrollTop = 0;
  document.body.scrollLeft = 0;
});

describe("viewport scroll ownership", () => {
  it("restores document offsets after a focus-driven root scroll", () => {
    document.documentElement.scrollTop = 11;
    document.documentElement.scrollLeft = 3;
    document.body.scrollTop = 11;
    document.body.scrollLeft = 3;
    lock = createViewportScrollLock();

    const input = document.createElement("textarea");
    document.body.append(input);
    document.documentElement.scrollTop = 84;
    document.documentElement.scrollLeft = 29;
    document.body.scrollTop = 84;
    document.body.scrollLeft = 29;

    lock.focus(input);

    expect(document.documentElement.scrollTop).toBe(11);
    expect(document.documentElement.scrollLeft).toBe(3);
    expect(document.body.scrollTop).toBe(11);
    expect(document.body.scrollLeft).toBe(3);
  });

  it("does not claim the body editor's scrollport", () => {
    lock = createViewportScrollLock();
    const editorScrollport = document.createElement("div");
    document.body.append(editorScrollport);
    editorScrollport.scrollTop = 42;

    editorScrollport.dispatchEvent(new Event("scroll"));

    expect(editorScrollport.scrollTop).toBe(42);
  });
});
