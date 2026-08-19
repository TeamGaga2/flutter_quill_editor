import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vite-plus/test";

/**
 * ADR 0002 acceptance contract — stable rich-text visual rules live only in
 * `style.css`. These assertions pin the token subset, typography T, node
 * styles, content alignment and unified 12px block spacing so a refactor or
 * a token re-copy cannot silently drift from the ADR table.
 */
const css = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), "style.css"), "utf8");

function rule(selector: string): string {
  const start = css.indexOf(`${selector} {`);
  if (start < 0) {
    throw new Error(`rule not found: ${selector}`);
  }
  const end = css.indexOf("}", start);
  return css.slice(start, end + 1);
}

describe("ADR 0002 style contract", () => {
  it("copies only the Figma token subset with Light/Dark values", () => {
    const light = rule(":root");
    expect(light).toContain("--tgg-schemes-on-surface: #171d19");
    expect(light).toContain("--tgg-schemes-surface-container-low: #f5f5f4");
    expect(light).toContain("--tgg-common-blue: #009dff");
    expect(light).toContain("--tgg-blue-secondary: #0091ed");
    expect(light).toContain("--tgg-primary-01: #009c64");
    expect(light).toContain("--tgg-divider-low: #e3e8e5");
    expect(light).toContain(
      "--tgg-state-layers-on-surface-variant-opacity-08: rgba(64, 73, 66, 0.08)",
    );
    expect(light).toContain("--tgg-fill04: #ffffff");
    expect(light).toContain("--tgg-fill03: #fafafa");
    expect(light).toContain("--tgg-fill01: #e9e9e9");
    expect(light).toContain("--tgg-text01: #121212");
    expect(light).toContain("--tgg-text05: #ffffff");
    expect(light).toContain("--tgg-schemes-primary: #009c64");
    expect(light).toContain("--tgg-schemes-on-primary: #ffffff");
    expect(light).toContain("--tgg-schemes-outline-variant: #a0a7a1");
    expect(light).toContain("--tgg-schemes-on-surface-variant: #404942");
    expect(light).toContain("--tgg-primary03: #38c585");
    expect(light).toContain("--tgg-primary04: #88dcb6");
    expect(light).toContain("--tgg-shadow-primary: 0px 8px 40px 0px rgba(0, 0, 0, 0.2)");
    expect(light).toContain("--tgg-scrim-black70: rgba(0, 0, 0, 0.70196)");

    const dark = rule("html.tg-theme-dark");
    expect(dark).toContain("--tgg-schemes-on-surface: #e4e8e3");
    expect(dark).toContain("--tgg-schemes-surface-container-low: #2c302d");
    expect(dark).toContain("--tgg-common-blue: #009dff");
    expect(dark).toContain("--tgg-blue-secondary: #0091ed");
    expect(dark).toContain("--tgg-primary-01: #009c64");
    expect(dark).toContain("--tgg-divider-low: #313532");
    expect(dark).toContain(
      "--tgg-state-layers-on-surface-variant-opacity-08: rgba(192, 201, 192, 0.08)",
    );
    expect(dark).toContain("--tgg-fill04: #3a3a3a");
    expect(dark).toContain("--tgg-fill03: #313131");
    expect(dark).toContain("--tgg-fill01: #272727");
    expect(dark).toContain("--tgg-text01: #fafafa");
    expect(dark).toContain("--tgg-text05: #ffffff");
    expect(dark).toContain("--tgg-schemes-primary: #91d5ac");
    expect(dark).toContain("--tgg-schemes-on-primary: #003921");
    expect(dark).toContain("--tgg-schemes-outline-variant: #4e5550");
    expect(dark).toContain("--tgg-schemes-on-surface-variant: #c0c9c0");
    expect(dark).toContain("--tgg-primary03: #009c64");
    expect(dark).toContain("--tgg-primary04: #4a8f70");
    expect(dark).toContain("--tgg-shadow-primary: 0px 8px 40px 0px rgba(0, 0, 0, 0.2)");
    expect(dark).toContain("--tgg-scrim-black70: rgba(0, 0, 0, 0.70196)");
  });

  it("paints the WebView editor surface with Surface Container Low", () => {
    expect(rule(":root")).toContain("background: var(--tgg-schemes-surface-container-low);");
    expect(rule(["html,", "body"].join("\n"))).toContain(
      "background: var(--tgg-schemes-surface-container-low);",
    );
    expect(rule(".tg-webview-root")).toContain(
      "background: var(--tgg-schemes-surface-container-low);",
    );
  });

  it("keeps Figma semantics even when two tokens share a color value", () => {
    // Common Blue (Link) and Blue/Primary are both #009dff — variables must
    // not be merged across semantics.
    expect(css).toContain("--tgg-common-blue");
    expect(css).toContain("var(--tgg-common-blue)");
    expect(css).not.toContain("--tgg-blue-primary");
  });

  it("does not carry the per-orientation body text indirection anymore", () => {
    // Body T color is Schemes/On Surface on both platforms (ADR 0002 table);
    // the host no longer injects --tgg-body-text.
    expect(css).not.toContain("--tgg-body-text");
    expect(rule(".tg-webview-editor-root .ql-container")).toContain(
      "color: var(--tgg-schemes-on-surface);",
    );
  });

  it("defines body typography T per platform", () => {
    const mobile = rule(".tg-webview-editor-root .ql-container");
    expect(mobile).toContain('"PingFang SC"');
    expect(mobile).toContain("font-size: 16px");
    expect(mobile).toContain("line-height: 24px");
    expect(mobile).toContain("font-weight: 400");
    expect(mobile).toContain("letter-spacing: 0");

    const desktop = rule(".tg-webview-layout-desktop .tg-webview-editor-root .ql-container");
    expect(desktop).toContain("font-size: 14px");
    expect(desktop).toContain("line-height: 20px");
  });

  it("defines H1–H3 with Figma px line-heights and On Surface color", () => {
    const h1 = rule(".tg-webview-editor-root .ql-editor h1");
    expect(h1).toContain("font-size: 28px");
    expect(h1).toContain("line-height: 40px");
    expect(h1).toContain("font-weight: 600");
    expect(h1).toContain("color: var(--tgg-schemes-on-surface)");

    expect(rule(".tg-webview-editor-root .ql-editor h2")).toContain("line-height: 32px");
    expect(rule(".tg-webview-editor-root .ql-editor h2")).toContain("font-size: 24px");
    expect(rule(".tg-webview-editor-root .ql-editor h3")).toContain("line-height: 28px");
    expect(rule(".tg-webview-editor-root .ql-editor h3")).toContain("font-size: 20px");
  });

  it("spaces top-level blocks with 12px margin-top and no bottom margin", () => {
    const shared = rule(
      [
        ".tg-webview-editor-root .ql-editor > p,",
        ".tg-webview-editor-root .ql-editor > h1,",
        ".tg-webview-editor-root .ql-editor > h2,",
        ".tg-webview-editor-root .ql-editor > h3,",
        ".tg-webview-editor-root .ql-editor > ol,",
        ".tg-webview-editor-root .ql-editor > ul",
      ].join("\n"),
    );
    expect(shared).toContain("margin: 12px 0 0;");

    // Media and divider carry the same 12px top-only spacing.
    expect(rule(".tg-webview-editor-root hr.tgg-divider")).toContain("margin: 12px 0 0;");
    expect(rule(".tg-webview-editor-root img.tgg-image")).toContain("margin: 12px 0 0;");
    expect(rule(".tg-webview-editor-root div.tgg-video")).toContain("margin: 12px 0 0;");
  });

  it("treats a consecutive quote run as one top-level block", () => {
    const quote = rule(".tg-webview-editor-root .ql-editor > blockquote");
    expect(quote).toContain("margin: 12px 0 0;");
    expect(quote).toContain("padding: 0 0 0 8px;");
    expect(quote).toContain("border-left: 3px solid var(--tgg-quote-bar);");
    expect(quote).toContain("border-radius: 0;");
    expect(quote).toContain("color: var(--tgg-quote-text);");
    expect(css).not.toContain(".tg-webview-editor-root .ql-editor > blockquote::before");

    const consecutive = rule(".tg-webview-editor-root .ql-editor > blockquote + blockquote");
    expect(consecutive).toContain("margin-top: 0;");
    expect(consecutive).not.toContain("padding-top");

    expect(rule(".tg-webview-editor-root .ql-editor > blockquote.tgg-quote-group-start")).toContain(
      "border-top-left-radius: 2px;",
    );
    expect(rule(".tg-webview-editor-root .ql-editor > blockquote.tgg-quote-group-end")).toContain(
      "border-bottom-left-radius: 2px;",
    );
  });

  it("derives Quote content and bar opacity from On Surface", () => {
    const light = rule(":root");
    expect(light).toContain(
      "--tgg-quote-text: color-mix(in srgb, var(--tgg-schemes-on-surface) 80%, transparent)",
    );
    expect(light).toContain(
      "--tgg-quote-bar: color-mix(in srgb, var(--tgg-schemes-on-surface) 30%, transparent)",
    );
  });

  it("pads the content area 0 0 16px 6px without !important", () => {
    const editor = rule(".tg-webview-editor-root .ql-editor");
    expect(editor).toContain("padding: 0 0 16px 6px;");
    expect(editor).not.toContain("padding: 0 0 16px 6px !important");
  });

  it("aligns placeholder with the first block origin (6px / 12px)", () => {
    const placeholder = rule(".tg-webview-editor-root .ql-editor.ql-blank::before");
    expect(placeholder).toContain("top: 12px;");
    expect(placeholder).toContain("left: 6px;");
    expect(placeholder).not.toContain("!important");
  });

  it("applies platform compensation and title insets from the alignment table", () => {
    // Mobile body: host 0 + compensation 10 + content inset 6 = 16.
    expect(
      rule(".tg-webview-layout-mobile .tg-webview-editor-root .tg-richtext-host-editor"),
    ).toContain("padding-left: 10px;");

    // Desktop title: host 10 + inset 6 = 16.
    const title = rule(".tg-webview-title-wrap");
    expect(title).toContain("margin: 8px 0 0;");
    expect(title).toContain("padding: 0 6px;");

    // Mobile title: host 0 + inset 16 = 16; old 10px top padding is gone.
    const mobileTitle = rule(".tg-webview-layout-mobile .tg-webview-title-wrap");
    expect(mobileTitle).toContain("margin: 16px 0 0;");
    expect(mobileTitle).toContain("padding: 0 16px;");
    expect(rule(".tg-webview-editor-root--with-title")).toContain("padding: 0;");
    expect(css).not.toContain("padding: 10px 16px 0");
  });

  it("colors Link, Mention and Channel from their own Figma tokens", () => {
    expect(rule(".tg-webview-editor-root .ql-editor a")).toContain("var(--tgg-common-blue)");
    expect(rule(".tg-webview-editor-root .ql-editor a")).toContain("text-decoration: underline;");
    expect(rule(".tg-webview-editor-root .tgg-mention")).toContain("var(--tgg-blue-secondary)");
    expect(rule(".tg-webview-editor-root .tgg-channel")).toContain("var(--tgg-primary-01)");
  });

  it("uses State Layers/On Surface Variant/Opacity-08 for toolbar hover", () => {
    expect(rule(".tg-webview-toolbar .tg-toolbar-icon-btn:hover:not(:disabled)")).toContain(
      "background: var(--tgg-state-layers-on-surface-variant-opacity-08);",
    );
    expect(rule(".tg-webview-toolbar .tg-toolbar-header-menu__list button:hover")).toContain(
      "background: var(--tgg-state-layers-on-surface-variant-opacity-08);",
    );
    expect(css).not.toContain("--tgg-fill14");
  });

  it("sizes the header-menu check to the Figma 12×20 icon frame", () => {
    const check = rule(".tg-webview-toolbar .tg-toolbar-header-menu__check");
    expect(check).toContain("width: 12px;");
    expect(check).toContain("height: 20px;");
  });

  it("does not keep unused --tgg-* tokens", () => {
    const defined = [...css.matchAll(/--tgg-[a-z0-9-]+/g)].map((match) => match[0]);
    for (const name of new Set(defined)) {
      expect(css, `${name} is defined but never referenced`).toContain(`var(${name}`);
    }
    expect(css).not.toContain("--tgg-background02");
    expect(css).not.toContain("--tgg-background05");
    expect(css).not.toContain("--tgg-line03");
    expect(css).not.toContain("--tgg-line07");
  });

  it("uses Divider Low with a 0.5px mobile and 1px desktop stroke", () => {
    expect(rule(".tg-webview-editor-root hr.tgg-divider")).toContain(
      "border-top: 1px solid var(--tgg-divider-low);",
    );
    expect(rule(".tg-webview-layout-mobile .tg-webview-editor-root hr.tgg-divider")).toContain(
      "border-top-width: 0.5px;",
    );
  });

  it("implements ADR 0004 link popover and modal visual specs", () => {
    const desktop = rule(".tg-link-popover");
    expect(desktop).toContain("width: 360px;");
    expect(desktop).toContain("max-height: 230px;");
    expect(desktop).toContain("padding: 24px;");
    expect(desktop).toContain("border-radius: 16px;");
    expect(desktop).toContain("background: var(--tgg-fill04);");
    expect(desktop).toContain("box-shadow: var(--tgg-shadow-primary);");

    const modal = rule(".tg-link-popover-modal");
    expect(modal).toContain("max-width: 420px;");
    expect(modal).toContain("border-radius: 16px;");
    expect(modal).toContain("background: var(--tgg-fill04);");

    const scrim = rule(".tg-link-popover-modal-scrim");
    expect(scrim).toContain("background: var(--tgg-scrim-black70);");

    const okBtn = rule(".tg-link-popover-btn-ok");
    expect(okBtn).toContain("background: var(--tgg-schemes-primary);");
    expect(okBtn).toContain("color: var(--tgg-schemes-on-primary);");

    const okDisabled = rule(".tg-link-popover-btn-ok:disabled");
    expect(okDisabled).toContain("background: var(--tgg-primary04);");
    expect(okDisabled).toContain("color: var(--tgg-text05);");

    const cancelBtn = rule(".tg-link-popover-btn-cancel");
    expect(cancelBtn).toContain("border: 1px solid var(--tgg-schemes-outline-variant);");
    expect(cancelBtn).toContain("color: var(--tgg-schemes-on-surface-variant);");
  });
});
