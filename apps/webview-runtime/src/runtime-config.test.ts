import { afterEach, describe, expect, it } from "vite-plus/test";
import { resolveRuntimeConfig } from "./runtime-config";

afterEach(() => {
  Reflect.deleteProperty(window, "__TG_RICHTEXT_CONFIG__");
});

describe("webview runtime config", () => {
  it("keeps the mobile runtime editor-only by default", () => {
    expect(resolveRuntimeConfig()).toMatchObject({ toolbarMode: "none" });
  });

  it("accepts an injected desktop mode without changing the default contract", () => {
    window.__TG_RICHTEXT_CONFIG__ = { toolbarMode: "desktop", locale: "en", mediaMaxSize: 320 };

    expect(resolveRuntimeConfig()).toMatchObject({
      toolbarMode: "desktop",
      locale: "en",
      mediaMaxSize: 320,
    });
  });

  it("defaults mediaMaxSize to the mobile 240 box", () => {
    expect(resolveRuntimeConfig().mediaMaxSize).toBe(240);
  });

  it("passes through shellBackgroundColor and emojiDefinitions from the injected config", () => {
    window.__TG_RICHTEXT_CONFIG__ = {
      shellBackgroundColor: "#101010",
      emojiDefinitions: [{ id: "ok", src: "/assets/assets/images/emoji/ok.png" }],
    };

    const config = resolveRuntimeConfig();

    expect(config.shellBackgroundColor).toBe("#101010");
    expect(config.emojiDefinitions).toEqual([
      { id: "ok", src: "/assets/assets/images/emoji/ok.png" },
    ]);
  });

  it("defaults body placeholder so blank editor shows hint without host inject", () => {
    expect(resolveRuntimeConfig().placeholder).toBe("Enter text");
  });

  it("accepts an injected body placeholder from Flutter l10n", () => {
    window.__TG_RICHTEXT_CONFIG__ = { placeholder: "输入正文..." };

    expect(resolveRuntimeConfig().placeholder).toBe("输入正文...");
  });
});
