import { createRoot } from "solid-js";
import { render } from "solid-js/web";
import { describe, expect, it, vi } from "vite-plus/test";
import { createEditor } from "@teamgaga/richtext-core";
import { MockEditorAdapter } from "@teamgaga/richtext-testing";
import {
  extractLinkContext,
  isValidUrl,
  LinkPopoverHost,
  resolveLinkPopoverLabels,
  useLinkPopover,
  ZH_LABELS,
  EN_LABELS,
  HI_LABELS,
} from "../src/link-popover";

describe("Link Popover Labels and Validation", () => {
  it("resolves labels by locale with English fallback", () => {
    expect(resolveLinkPopoverLabels("zh")).toEqual(ZH_LABELS);
    expect(resolveLinkPopoverLabels("zh-CN")).toEqual(ZH_LABELS);
    expect(resolveLinkPopoverLabels("en")).toEqual(EN_LABELS);
    expect(resolveLinkPopoverLabels("en-US")).toEqual(EN_LABELS);
    expect(resolveLinkPopoverLabels("hi")).toEqual(HI_LABELS);
    expect(resolveLinkPopoverLabels("hi-IN")).toEqual(HI_LABELS);
    expect(resolveLinkPopoverLabels("fr")).toEqual(EN_LABELS);
    expect(resolveLinkPopoverLabels(undefined)).toBeDefined();
  });

  it("validates URL protocols safely", () => {
    expect(isValidUrl("https://teamgaga.com")).toBe(true);
    expect(isValidUrl("http://localhost:3000/path?query=1")).toBe(true);
    expect(isValidUrl("mp://miniapp/page")).toBe(true);
    expect(isValidUrl("mps://miniapp/page")).toBe(true);
    expect(isValidUrl("mailto:user@example.com")).toBe(true);
    expect(isValidUrl("tel:+1234567890")).toBe(true);
    expect(isValidUrl("sms:+1234567890")).toBe(true);

    expect(isValidUrl("")).toBe(false);
    expect(isValidUrl("   ")).toBe(false);
    expect(isValidUrl("https://baidu")).toBe(false);
    expect(isValidUrl("http://baidu")).toBe(false);
    expect(isValidUrl("https://baidu.")).toBe(false);
    expect(isValidUrl("javascript:alert(1)")).toBe(false);
    expect(isValidUrl("JAVASCRIPT:alert(1)")).toBe(false);
    expect(isValidUrl("data:text/html,<script>alert(1)</script>")).toBe(false);
    expect(isValidUrl("vbscript:alert(1)")).toBe(false);
    expect(isValidUrl("plain text without scheme")).toBe(false);
    expect(isValidUrl("mailto:invalid")).toBe(false);
  });
});

describe("extractLinkContext", () => {
  it("returns empty context when editor has no selection", () => {
    const adapter = new MockEditorAdapter({ selection: null });
    const editor = createEditor({ adapter });

    const context = extractLinkContext(editor);
    expect(context.range).toBeNull();
    expect(context.text).toBe("");
    expect(context.url).toBe("");
    expect(context.isEditingExisting).toBe(false);
  });

  it("extracts plain text on non-link selection", () => {
    const adapter = new MockEditorAdapter();
    const editor = createEditor({ adapter });
    adapter.setSnapshot({
      content: [{ insert: "Hello world\n" }],
    });
    adapter.setSelection({ start: 0, end: 5 });

    const context = extractLinkContext(editor);
    expect(context.range).toEqual({ start: 0, end: 5 });
    expect(context.text).toBe("Hello");
    expect(context.url).toBe("");
    expect(context.isEditingExisting).toBe(false);
  });

  it("extracts and expands existing link at collapsed caret", () => {
    const adapter = new MockEditorAdapter();
    const editor = createEditor({ adapter });
    adapter.setSnapshot({
      content: [
        { insert: "Prefix " },
        { insert: "TeamGaga", attributes: { link: "https://teamgaga.com" } },
        { insert: " Suffix\n" },
      ],
    });
    // Caret at index 9 (inside 'TeamGaga' which spans 7..15)
    adapter.setSelection({ start: 9, end: 9 });

    const context = extractLinkContext(editor);
    expect(context.range).toEqual({ start: 7, end: 15 });
    expect(context.text).toBe("TeamGaga");
    expect(context.url).toBe("https://teamgaga.com");
    expect(context.isEditingExisting).toBe(true);
  });

  it("extracts existing link on range selection", () => {
    const adapter = new MockEditorAdapter();
    const editor = createEditor({ adapter });
    adapter.setSnapshot({
      content: [
        { insert: "Prefix " },
        { insert: "TeamGaga", attributes: { link: "https://teamgaga.com" } },
        { insert: " Suffix\n" },
      ],
    });
    adapter.setSelection({ start: 7, end: 15 });

    const context = extractLinkContext(editor);
    expect(context.range).toEqual({ start: 7, end: 15 });
    expect(context.text).toBe("TeamGaga");
    expect(context.url).toBe("https://teamgaga.com");
    expect(context.isEditingExisting).toBe(true);
  });
});

describe("useLinkPopover hook", () => {
  it("manages open, edit, validation and submit lifecycle", () => {
    createRoot((dispose) => {
      const adapter = new MockEditorAdapter();
      const editor = createEditor({ adapter });
      adapter.setSnapshot({
        content: [{ insert: "Hello world\n" }],
      });
      adapter.setSelection({ start: 0, end: 5 });

      const controller = useLinkPopover({
        editor: () => editor,
        locale: "zh",
      });

      expect(controller.state().isOpen).toBe(false);
      expect(controller.labels().title).toBe("添加链接");

      controller.open();
      expect(controller.state().isOpen).toBe(true);
      expect(controller.state().text).toBe("Hello");
      expect(controller.state().url).toBe("");
      expect(controller.canSubmit()).toBe(false);

      controller.setUrl("https://teamgaga.com");
      expect(controller.canSubmit()).toBe(true);

      controller.submit();
      expect(controller.state().isOpen).toBe(false);
      expect(adapter.commands).toEqual([
        {
          type: "insert-link",
          link: {
            url: "https://teamgaga.com",
            text: "Hello",
          },
          selection: { start: 0, end: 5 },
        },
      ]);

      dispose();
    });
  });

  it("supports cancel and close", () => {
    createRoot((dispose) => {
      const adapter = new MockEditorAdapter();
      const editor = createEditor({ adapter });
      const focusSpy = vi.spyOn(editor, "focus");

      const controller = useLinkPopover({
        editor: () => editor,
        locale: "en",
      });

      controller.open();
      expect(controller.state().isOpen).toBe(true);

      controller.close();
      expect(controller.state().isOpen).toBe(false);
      expect(focusSpy).toHaveBeenCalled();

      dispose();
    });
  });
});

describe("LinkPopover Component and Host", () => {
  it("renders form elements when opened", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);

    const adapter = new MockEditorAdapter();
    const editor = createEditor({ adapter });

    let hostController!: any;
    const dispose = render(
      () => (
        <LinkPopoverHost
          editor={() => editor}
          locale="zh"
          onControllerReady={(c) => {
            hostController = c;
          }}
        >
          <div class="editor-body">Editor</div>
        </LinkPopoverHost>
      ),
      container,
    );

    expect(container.querySelector(".tg-link-popover")).toBeNull();

    hostController.open();
    const popover = document.body.querySelector(".tg-link-popover");
    expect(popover).not.toBeNull();
    expect(document.body.querySelector(".tg-link-popover-btn-ok")).not.toBeNull();
    expect(document.body.querySelector(".tg-link-popover-btn-cancel")).not.toBeNull();

    hostController.close();
    expect(document.body.querySelector(".tg-link-popover")).toBeNull();

    dispose();
    container.remove();
  });

  it("opens on Cmd/Ctrl+K when editor is focused", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);

    const adapter = new MockEditorAdapter();
    const editor = createEditor({ adapter });
    let hostController!: any;

    const dispose = render(
      () => (
        <LinkPopoverHost
          editor={() => editor}
          locale="en"
          onControllerReady={(c) => {
            hostController = c;
          }}
        />
      ),
      container,
    );

    // Not focused: Cmd+K ignored
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "k", metaKey: true, bubbles: true }));
    expect(hostController.state().isOpen).toBe(false);

    // Focused: Cmd+K opens
    adapter.setSelection({ start: 0, end: 0 });
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "k", metaKey: true, bubbles: true }));
    expect(hostController.state().isOpen).toBe(true);

    // Escape closes
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(hostController.state().isOpen).toBe(false);

    dispose();
    container.remove();
  });

  it("does not render visible label elements and keeps focus on text input while typing", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);

    const adapter = new MockEditorAdapter();
    const editor = createEditor({ adapter });
    let hostController!: any;

    const dispose = render(
      () => (
        <LinkPopoverHost
          editor={() => editor}
          locale="zh"
          onControllerReady={(c) => {
            hostController = c;
          }}
        />
      ),
      container,
    );

    hostController.open();

    // 1. Verify no visible <label> elements
    const labels = container.querySelectorAll("label");
    expect(labels.length).toBe(0);

    const urlInput = container.querySelector<HTMLInputElement>("#tg-link-url-input")!;
    const textInput = container.querySelector<HTMLInputElement>("#tg-link-text-input")!;

    expect(urlInput).not.toBeNull();
    expect(textInput).not.toBeNull();
    expect(urlInput.getAttribute("placeholder")).toBe("粘贴或输入链接地址");
    expect(textInput.getAttribute("placeholder")).toBe("输入文本");

    // 2. Focus and type into text input
    textInput.focus();
    expect(document.activeElement).toBe(textInput);

    const urlFocusSpy = vi.spyOn(urlInput, "focus");
    const urlSelectSpy = vi.spyOn(urlInput, "select");

    textInput.value = "H";
    textInput.dispatchEvent(new Event("input", { bubbles: true }));
    textInput.value = "He";
    textInput.dispatchEvent(new Event("input", { bubbles: true }));
    textInput.value = "Hello";
    textInput.dispatchEvent(new Event("input", { bubbles: true }));

    // Focus must remain on text input, not jump back to url input
    expect(document.activeElement).toBe(textInput);
    expect(hostController.state().text).toBe("Hello");
    expect(urlFocusSpy).not.toHaveBeenCalled();
    expect(urlSelectSpy).not.toHaveBeenCalled();

    // 3. Focus and type into url input
    urlInput.focus();
    expect(document.activeElement).toBe(urlInput);

    urlInput.value = "https://example.com";
    urlInput.dispatchEvent(new Event("input", { bubbles: true }));

    expect(document.activeElement).toBe(urlInput);
    expect(hostController.state().url).toBe("https://example.com");

    dispose();
    container.remove();
  });

  it("renders mobile modal dialog when isMobile is true", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);

    const adapter = new MockEditorAdapter();
    const editor = createEditor({ adapter });
    let hostController!: any;

    const dispose = render(
      () => (
        <LinkPopoverHost
          editor={() => editor}
          locale="zh"
          isMobile={true}
          onControllerReady={(c) => {
            hostController = c;
          }}
        />
      ),
      container,
    );

    hostController.open();

    const scrim = container.querySelector<HTMLElement>(".tg-link-popover-scrim")!;
    expect(scrim).not.toBeNull();
    expect(scrim.classList.contains("tg-link-popover-scrim--modal")).toBe(true);

    const dialog = container.querySelector<HTMLElement>(".tg-link-popover")!;
    expect(dialog).not.toBeNull();
    expect(dialog.classList.contains("tg-link-popover-modal")).toBe(true);

    const title = container.querySelector<HTMLElement>(".tg-link-popover-modal-title")!;
    expect(title).not.toBeNull();
    expect(title.textContent).toBe("添加链接");

    // In mobile mode, positioning is handled by CSS flexbox centering in scrim, not inline coordinates
    expect(dialog.style.left).toBe("");
    expect(dialog.style.top).toBe("");

    dispose();
    container.remove();
  });
});
