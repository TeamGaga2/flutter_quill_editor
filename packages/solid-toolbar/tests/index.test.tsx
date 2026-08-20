import { createRoot, createSignal, type JSX } from "solid-js";
import { render } from "solid-js/web";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { browserToolbarLabels, resolveToolbarLabels } from "../src/i18n/toolbar-labels.ts";
import type {
  EditorAdapterEvent,
  EditorCommand,
  EditorState,
  RichTextAdapter,
} from "@teamgaga/richtext-core";
import {
  createRichTextEditor,
  RichTextEditor,
  RichTextProvider,
  type SolidRichTextController,
} from "@teamgaga/richtext-solid";
import {
  callIndent,
  callOutdent,
  getSelectedPlainText,
  HeaderStyleMenu,
  RichTextToolbar,
  ToolbarButton,
  useToolbarState,
  type LinkRequestContext,
} from "../src/index.ts";
import { computeBottomTooltipLayout } from "../src/components/tooltip-layout.ts";

const ORIGINAL_LANGUAGE = navigator.language;

function setBrowserLanguage(language: string): void {
  Object.defineProperty(navigator, "language", { value: language, configurable: true });
}

beforeEach(() => {
  // Pin the locale so queries on English labels never depend on the host machine.
  setBrowserLanguage("en-US");
});

afterEach(() => {
  vi.unstubAllGlobals();
  setBrowserLanguage(ORIGINAL_LANGUAGE);
});

const initialState: EditorState = {
  focused: false,
  selection: null,
  canUndo: false,
  canRedo: false,
  formats: {
    bold: false,
    italic: false,
    underline: false,
    strike: false,
    header: false,
    list: false,
    blockquote: false,
  },
};

function createFakeAdapter() {
  let state = initialState;
  let listener: ((event: EditorAdapterEvent) => void) | undefined;
  const commands: EditorCommand[] = [];
  const adapter: RichTextAdapter = {
    getSnapshot: () => ({ content: [{ insert: "\n" }] }),
    setSnapshot: () => undefined,
    setTitle: () => undefined,
    getSelection: () => state.selection,
    setSelection: (selection) => {
      state = { ...state, selection };
    },
    getCaretRect: () => null,
    getState: () => state,
    focus: () => undefined,
    blur: () => undefined,
    execute: (command) => commands.push(command),
    subscribe: (nextListener) => {
      listener = nextListener;
      return () => undefined;
    },
    destroy: () => undefined,
  };

  return {
    adapter,
    commands,
    emit(event: EditorAdapterEvent) {
      if (event.type === "state-change") {
        state = event.state;
      }

      listener?.(event);
    },
  };
}

describe("optional Solid toolbar", () => {
  it("derives active and disabled state from the Solid controller", async () => {
    const fake = createFakeAdapter();
    let controller!: SolidRichTextController;
    let toolbarState!: ReturnType<typeof useToolbarState>;
    let dispose!: () => void;

    createRoot((rootDispose) => {
      dispose = rootDispose;
      controller = createRichTextEditor({ adapterFactory: () => fake.adapter });
      toolbarState = useToolbarState(controller);
    });

    expect(toolbarState().bold.disabled).toBe(true);
    expect(toolbarState().divider.disabled).toBe(true);
    expect(toolbarState().indent.disabled).toBe(true);
    expect(toolbarState().link.disabled).toBe(true);

    controller.mount(document.createElement("div"));
    await Promise.resolve();
    fake.emit({
      type: "state-change",
      state: {
        ...initialState,
        canUndo: true,
        formats: {
          ...initialState.formats,
          bold: true,
          header: 2,
          list: "bullet",
        },
      },
    });

    expect(toolbarState().bold).toEqual({ active: true, disabled: false });
    expect(toolbarState().header2.active).toBe(true);
    expect(toolbarState().bulletList.active).toBe(true);
    expect(toolbarState().divider).toEqual({ active: false, disabled: false });
    expect(toolbarState().indent).toEqual({ active: false, disabled: false });
    expect(toolbarState().outdent).toEqual({ active: false, disabled: false });
    // Standalone useToolbarState defaults canRequestLink=true.
    expect(toolbarState().link).toEqual({ active: false, disabled: false });
    expect(toolbarState().undo.disabled).toBe(false);
    expect(toolbarState().redo.disabled).toBe(true);

    controller.destroy();
    await Promise.resolve();
    expect(toolbarState().bold.disabled).toBe(true);
    dispose();
  });

  it("renders accessible buttons without taking the editor selection", () => {
    const onPress = vi.fn();
    const root = document.createElement("div");
    document.body.append(root);
    const dispose = render(
      () => (
        <ToolbarButton label="Bold" active onPress={onPress}>
          B
        </ToolbarButton>
      ),
      root,
    );
    const button = root.querySelector("button");
    const pointerDown = new PointerEvent("pointerdown", { cancelable: true });
    const mouseDown = new MouseEvent("mousedown", { cancelable: true });

    button?.dispatchEvent(pointerDown);
    button?.dispatchEvent(mouseDown);
    button?.click();

    expect(button?.getAttribute("type")).toBe("button");
    expect(button?.getAttribute("aria-label")).toBe("Bold");
    expect(button?.getAttribute("aria-pressed")).toBe("true");
    expect(button?.hasAttribute("data-active")).toBe(true);
    expect(pointerDown.defaultPrevented).toBe(false);
    expect(onPress).toHaveBeenCalledTimes(1);
    dispose();
    root.remove();
  });

  it("handles header menu open and selection interactions", () => {
    const onSelect = vi.fn();
    const root = document.createElement("div");
    document.body.append(root);
    const dispose = render(() => <HeaderStyleMenu value="body" onSelect={onSelect} />, root);
    const trigger = root.querySelector<HTMLButtonElement>('button[aria-label="Header"]');
    const pointerDown = new PointerEvent("pointerdown", { cancelable: true });
    const mouseDown = new MouseEvent("mousedown", { cancelable: true });

    trigger?.dispatchEvent(pointerDown);
    trigger?.dispatchEvent(mouseDown);
    trigger?.click();

    expect(pointerDown.defaultPrevented).toBe(false);
    expect(trigger?.getAttribute("aria-expanded")).toBe("true");

    const option = root.querySelector<HTMLButtonElement>('button[aria-label="H2"]');
    const optionPointerDown = new PointerEvent("pointerdown", { cancelable: true });
    const optionMouseDown = new MouseEvent("mousedown", { cancelable: true });
    option?.dispatchEvent(optionPointerDown);
    option?.dispatchEvent(optionMouseDown);
    option?.click();

    expect(optionPointerDown.defaultPrevented).toBe(false);
    expect(onSelect).toHaveBeenCalledWith(2);
    expect(trigger?.getAttribute("aria-expanded")).toBe("false");

    dispose();
    root.remove();
  });

  it("renders the selected header check at the Figma 12×20 size", () => {
    const root = document.createElement("div");
    document.body.append(root);
    const dispose = render(() => <HeaderStyleMenu value={2} onSelect={() => undefined} />, root);
    root.querySelector<HTMLButtonElement>('button[aria-label="Header"]')?.click();

    const selected = root.querySelector<HTMLButtonElement>('button[aria-label="H2"]');
    const check = selected?.querySelector(".tg-toolbar-header-menu__check svg");
    expect(check?.getAttribute("width")).toBe("12");
    expect(check?.getAttribute("height")).toBe("20");

    dispose();
    root.remove();
  });

  it("dispatches Core commands without accessing Quill", () => {
    const fake = createFakeAdapter();

    function App(): JSX.Element {
      const controller = createRichTextEditor({ adapterFactory: () => fake.adapter });

      return (
        <RichTextProvider editor={controller}>
          <RichTextToolbar />
          <RichTextEditor />
        </RichTextProvider>
      );
    }

    const root = document.createElement("div");
    document.body.append(root);
    const dispose = render(() => <App />, root);
    fake.emit({
      type: "state-change",
      state: {
        ...initialState,
        canUndo: true,
        canRedo: true,
        formats: { ...initialState.formats, list: "bullet" },
      },
    });
    const click = (label: string): void => {
      root.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)?.click();
    };

    click("Bold");
    const headerTrigger = root.querySelector<HTMLButtonElement>('button[aria-label="Font size"]');
    if (!headerTrigger) {
      throw new Error("Expected header menu trigger.");
    }
    headerTrigger.click();
    root.querySelector<HTMLButtonElement>('button[aria-label="H1"]')?.click();
    click("Bulleted list");
    click("Numbered list");
    click("Quote");
    click("Divider");
    click("Increase indent");
    click("Decrease indent");

    expect(fake.commands).toEqual([
      { type: "toggle-inline-format", format: "bold" },
      { type: "toggle-block-format", format: "header", value: 1 },
      { type: "toggle-block-format", format: "list", value: "bullet" },
      { type: "toggle-block-format", format: "list", value: "ordered" },
      { type: "toggle-block-format", format: "blockquote" },
      { type: "insert-divider" },
      { type: "indent" },
      { type: "outdent" },
    ]);

    fake.emit({
      type: "state-change",
      state: {
        ...initialState,
        formats: { ...initialState.formats, header: 2 },
      },
    });

    expect(
      root
        .querySelector<HTMLButtonElement>('button[aria-label="Font size"]')
        ?.getAttribute("data-value"),
    ).toBe("2");
    expect(root.querySelector('button[aria-label="Strike"]')).toBeNull();
    expect(root.querySelector('button[aria-label="Undo"]')).toBeNull();
    expect(root.querySelector('button[aria-label="Redo"]')).toBeNull();

    dispose();
    root.remove();
  });

  it("restores focus after a format only when the caret was lost", () => {
    const fake = createFakeAdapter();
    const focus = vi.fn();
    fake.adapter.focus = focus;

    function App(): JSX.Element {
      const controller = createRichTextEditor({ adapterFactory: () => fake.adapter });

      return (
        <RichTextProvider editor={controller}>
          <RichTextToolbar />
          <RichTextEditor />
        </RichTextProvider>
      );
    }

    const root = document.createElement("div");
    document.body.append(root);
    const dispose = render(() => <App />, root);
    const click = (label: string): void => {
      root.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)?.click();
    };

    // Caret still live: re-focusing would re-emit protocol `focus` and make the
    // host re-enter WebView2's native focus path, dropping the caret.
    fake.emit({ type: "state-change", state: { ...initialState, focused: true } });
    click("Bold");
    const headerTrigger = root.querySelector<HTMLButtonElement>('button[aria-label="Font size"]');
    headerTrigger?.click();
    root.querySelector<HTMLButtonElement>('button[aria-label="H1"]')?.click();
    expect(focus).not.toHaveBeenCalled();

    fake.emit({ type: "state-change", state: { ...initialState, focused: false } });
    click("Bold");
    expect(focus).toHaveBeenCalledTimes(1);

    dispose();
    root.remove();
  });

  it("disables body controls for title focus while keeping Close available", () => {
    const fake = createFakeAdapter();
    const onRequestClose = vi.fn();
    const [titleFocused, setTitleFocused] = createSignal(false);

    function App(): JSX.Element {
      const controller = createRichTextEditor({ adapterFactory: () => fake.adapter });

      return (
        <RichTextProvider editor={controller}>
          <RichTextToolbar onRequestClose={onRequestClose} titleFocused={titleFocused} />
          <RichTextEditor />
        </RichTextProvider>
      );
    }

    const root = document.createElement("div");
    document.body.append(root);
    const dispose = render(() => <App />, root);
    setTitleFocused(true);

    expect(root.querySelector<HTMLButtonElement>('button[aria-label="Bold"]')?.disabled).toBe(true);
    expect(root.querySelector<HTMLButtonElement>('button[aria-label="Font size"]')?.disabled).toBe(
      true,
    );
    expect(root.querySelector<HTMLButtonElement>('button[aria-label="Link"]')?.disabled).toBe(true);
    expect(
      root.querySelector<HTMLButtonElement>('button[aria-label="Increase indent"]')?.disabled,
    ).toBe(true);
    const closeButton = root.querySelector<HTMLButtonElement>('button[aria-label="Close"]');
    expect(closeButton?.disabled).toBe(false);
    closeButton?.click();
    expect(onRequestClose).toHaveBeenCalledTimes(1);

    dispose();
    root.remove();
  });

  it("hides the Close button when showCloseButton is false", () => {
    const fake = createFakeAdapter();
    const onRequestClose = vi.fn();

    function App(): JSX.Element {
      const controller = createRichTextEditor({ adapterFactory: () => fake.adapter });

      return (
        <RichTextProvider editor={controller}>
          <RichTextToolbar onRequestClose={onRequestClose} showCloseButton={false} />
          <RichTextEditor />
        </RichTextProvider>
      );
    }

    const root = document.createElement("div");
    document.body.append(root);
    const dispose = render(() => <App />, root);

    expect(root.querySelector<HTMLButtonElement>('button[aria-label="Close"]')).toBeNull();
    expect(root.querySelector<HTMLSpanElement>(".tg-toolbar-spacer")).toBeNull();

    dispose();
    root.remove();
  });

  it("disables Link until onRequestLink is provided, then requests the host dialog", () => {
    const fake = createFakeAdapter();
    const onRequestLink = vi.fn();
    let controller!: SolidRichTextController;

    function App(): JSX.Element {
      controller = createRichTextEditor({ adapterFactory: () => fake.adapter });

      return (
        <RichTextProvider editor={controller}>
          <RichTextToolbar onRequestLink={onRequestLink} />
          <RichTextEditor />
        </RichTextProvider>
      );
    }

    const root = document.createElement("div");
    document.body.append(root);
    const dispose = render(() => <App />, root);

    const linkButton = root.querySelector<HTMLButtonElement>('button[aria-label="Link"]');
    expect(linkButton?.disabled).toBe(false);

    fake.adapter.getSnapshot = () => ({
      content: [{ insert: "Hello world" }, { insert: "\n" }],
    });
    fake.adapter.getSelection = () => ({ start: 0, end: 5 });
    controller.editor()?.setSelection({ start: 0, end: 5 });

    linkButton?.click();

    expect(onRequestLink).toHaveBeenCalledTimes(1);
    const context = onRequestLink.mock.calls[0]?.[0] as LinkRequestContext;
    expect(context).toEqual({
      selection: { start: 0, end: 5 },
      selectedText: "Hello",
    });

    dispose();
    root.remove();
  });

  it("triggers onOpenLinkForm when link button is clicked", () => {
    const fake = createFakeAdapter();
    const onOpenLinkForm = vi.fn();
    let controller!: SolidRichTextController;

    function App(): JSX.Element {
      controller = createRichTextEditor({ adapterFactory: () => fake.adapter });

      return (
        <RichTextProvider editor={controller}>
          <RichTextToolbar onOpenLinkForm={onOpenLinkForm} />
          <RichTextEditor />
        </RichTextProvider>
      );
    }

    const root = document.createElement("div");
    document.body.append(root);
    const dispose = render(() => <App />, root);

    const linkButton = root.querySelector<HTMLButtonElement>('button[aria-label="Link"]');
    expect(linkButton?.disabled).toBe(false);

    linkButton?.click();
    expect(onOpenLinkForm).toHaveBeenCalledTimes(1);

    dispose();
    root.remove();
  });

  it("keeps Link disabled when no host handler is wired", () => {
    const fake = createFakeAdapter();

    function App(): JSX.Element {
      const controller = createRichTextEditor({ adapterFactory: () => fake.adapter });

      return (
        <RichTextProvider editor={controller}>
          <RichTextToolbar />
          <RichTextEditor />
        </RichTextProvider>
      );
    }

    const root = document.createElement("div");
    document.body.append(root);
    const dispose = render(() => <App />, root);

    expect(root.querySelector<HTMLButtonElement>('button[aria-label="Link"]')?.disabled).toBe(true);

    dispose();
    root.remove();
  });

  it("enables indent/outdent only for lists or blockquotes", () => {
    const fake = createFakeAdapter();
    let controller!: SolidRichTextController;

    function App(): JSX.Element {
      controller = createRichTextEditor({ adapterFactory: () => fake.adapter });

      return (
        <RichTextProvider editor={controller}>
          <RichTextToolbar />
          <RichTextEditor />
        </RichTextProvider>
      );
    }

    const root = document.createElement("div");
    document.body.append(root);
    const dispose = render(() => <App />, root);

    const mounted = controller.editor();
    if (!mounted) {
      throw new Error("Expected editor to mount.");
    }

    expect(
      root.querySelector<HTMLButtonElement>('button[aria-label="Increase indent"]')?.disabled,
    ).toBe(true);
    expect(
      root.querySelector<HTMLButtonElement>('button[aria-label="Decrease indent"]')?.disabled,
    ).toBe(true);
    fake.emit({
      type: "state-change",
      state: {
        ...initialState,
        formats: { ...initialState.formats, blockquote: true },
      },
    });

    root.querySelector<HTMLButtonElement>('button[aria-label="Increase indent"]')?.click();
    root.querySelector<HTMLButtonElement>('button[aria-label="Decrease indent"]')?.click();

    expect(fake.commands).toEqual([{ type: "indent" }, { type: "outdent" }]);

    callIndent(mounted);
    callOutdent(mounted);
    expect(fake.commands).toEqual([
      { type: "indent" },
      { type: "outdent" },
      { type: "indent" },
      { type: "outdent" },
    ]);

    dispose();
    root.remove();
  });

  it("extracts selected plain text for host link prefill", async () => {
    let controller!: SolidRichTextController;

    function App(): JSX.Element {
      controller = createRichTextEditor();

      return (
        <RichTextProvider editor={controller}>
          <RichTextEditor />
        </RichTextProvider>
      );
    }

    const root = document.createElement("div");
    document.body.append(root);
    const dispose = render(() => <App />, root);
    await Promise.resolve();

    const editor = controller.editor();
    if (!editor) {
      throw new Error("Expected the editor to be mounted.");
    }

    editor.setSnapshot({ content: [{ insert: "Hello world" }, { insert: "\n" }] });
    editor.setSelection({ start: 6, end: 11 });

    expect(getSelectedPlainText(editor)).toBe("world");

    dispose();
    root.remove();
  });

  it("preserves a real editor selection while applying a format", async () => {
    let controller!: SolidRichTextController;

    function App(): JSX.Element {
      controller = createRichTextEditor();

      return (
        <RichTextProvider editor={controller}>
          <RichTextToolbar />
          <RichTextEditor />
        </RichTextProvider>
      );
    }

    const root = document.createElement("div");
    document.body.append(root);
    const dispose = render(() => <App />, root);
    await Promise.resolve();

    const editor = controller.editor();
    const boldButton = root.querySelector<HTMLButtonElement>('button[aria-label="Bold"]');

    if (!editor || !boldButton) {
      throw new Error("Expected the editor and Bold button to be mounted.");
    }

    editor.setSnapshot({ content: [{ insert: "Hello" }, { insert: "\n" }] });
    editor.setSelection({ start: 0, end: 5 });
    boldButton.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, cancelable: true }));
    boldButton.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
    boldButton.click();

    expect(editor.getSelection()).toEqual({ start: 0, end: 5 });
    expect(editor.getSnapshot().content).toEqual([
      { insert: "Hello", attributes: { bold: true } },
      { insert: "\n" },
    ]);

    dispose();
    root.remove();
  });
});

describe("toolbar label localization", () => {
  const CHINESE_LABELS = {
    emoji: "表情",
    mention: "提及",
    channel: "频道",
    image: "图片",
    header: "字号",
    bold: "粗体",
    italic: "斜体",
    underline: "下划线",
    link: "链接",
    divider: "分割线",
    outdent: "左缩进",
    indent: "右缩进",
    bulletList: "无序列表",
    orderedList: "有序列表",
    blockquote: "引用",
  };
  const ENGLISH_LABELS = {
    emoji: "Emoji",
    mention: "Mention",
    channel: "Channel",
    image: "Image",
    header: "Font size",
    bold: "Bold",
    italic: "Italic",
    underline: "Underline",
    link: "Link",
    divider: "Divider",
    outdent: "Decrease indent",
    indent: "Increase indent",
    bulletList: "Bulleted list",
    orderedList: "Numbered list",
    blockquote: "Quote",
  };

  it("resolves every zh variant to the confirmed Chinese labels", () => {
    for (const language of ["zh", "zh-CN", "zh-TW", "zh-HK", "ZH-CN", "zH-tw"]) {
      expect(resolveToolbarLabels(language)).toEqual(CHINESE_LABELS);
    }
  });

  it("resolves non-Chinese, empty and missing languages to the English labels", () => {
    for (const language of ["en-US", "ja-JP", "ko-KR", "fr-FR", "zhx", "", "  "]) {
      expect(resolveToolbarLabels(language)).toEqual(ENGLISH_LABELS);
    }

    expect(resolveToolbarLabels(undefined)).toEqual(ENGLISH_LABELS);
  });

  it("reads navigator.language through the browser entry point", () => {
    setBrowserLanguage("zh-HK");
    expect(browserToolbarLabels()).toEqual(CHINESE_LABELS);
  });

  it("falls back to English when the browser API is unavailable", () => {
    vi.stubGlobal("navigator", undefined);
    expect(browserToolbarLabels()).toEqual(ENGLISH_LABELS);
  });
});

describe("localized desktop toolbar", () => {
  const ENGLISH_ORDER = [
    "Font size",
    "Bold",
    "Italic",
    "Underline",
    "Link",
    "Divider",
    "Decrease indent",
    "Increase indent",
    "Bulleted list",
    "Numbered list",
    "Quote",
  ];
  const CHINESE_ORDER = [
    "字号",
    "粗体",
    "斜体",
    "下划线",
    "链接",
    "分割线",
    "左缩进",
    "右缩进",
    "无序列表",
    "有序列表",
    "引用",
  ];

  function mountToolbar(language: string): { root: HTMLElement; dispose: () => void } {
    setBrowserLanguage(language);
    const fake = createFakeAdapter();
    const root = document.createElement("div");
    document.body.append(root);
    const dispose = render(
      () => (
        <RichTextProvider editor={createRichTextEditor({ adapterFactory: () => fake.adapter })}>
          <RichTextToolbar />
          <RichTextEditor />
        </RichTextProvider>
      ),
      root,
    );
    return { root, dispose };
  }

  function itemLabels(root: HTMLElement): string[] {
    return Array.from(root.querySelectorAll<HTMLButtonElement>("button[aria-label]"))
      .map((button) => button.getAttribute("aria-label")!)
      .filter((label) => label !== "Close");
  }

  function tooltipContent(trigger: Element): Element | null | undefined {
    return trigger
      .closest(".tg-toolbar-tooltip")
      ?.querySelector('.tg-toolbar-tooltip__content[role="tooltip"]');
  }

  it("renders the 11 items in the confirmed English order", () => {
    const { root, dispose } = mountToolbar("en-US");
    expect(itemLabels(root)).toEqual(ENGLISH_ORDER);
    dispose();
    root.remove();
  });

  it("renders the 11 items in the confirmed Chinese order for a zh-* locale", () => {
    const { root, dispose } = mountToolbar("zh-TW");
    expect(itemLabels(root)).toEqual(CHINESE_ORDER);
    dispose();
    root.remove();
  });

  it("wraps the 11 triggers in a custom tooltip with no native title", () => {
    const { root, dispose } = mountToolbar("zh-CN");
    const triggers = Array.from(
      root.querySelectorAll<HTMLButtonElement>("button[aria-label]"),
    ).filter((button) => button.getAttribute("aria-label") !== "Close");

    expect(triggers).toHaveLength(11);
    for (const trigger of triggers) {
      expect(trigger.hasAttribute("title")).toBe(false);
      trigger.dispatchEvent(new PointerEvent("pointerenter", { bubbles: true }));
      expect(tooltipContent(trigger)?.textContent).toBe(trigger.getAttribute("aria-label"));
      trigger.dispatchEvent(new PointerEvent("pointerleave", { bubbles: true }));
    }

    const close = root.querySelector<HTMLButtonElement>('button[aria-label="Close"]');
    expect(close?.getAttribute("title")).toBe("Close");
    expect(close?.closest(".tg-toolbar-tooltip")).toBeNull();

    dispose();
    root.remove();
  });

  it("shows tooltips on hover for disabled items through the wrapper", () => {
    const { root, dispose } = mountToolbar("en-US");

    for (const label of ["Link", "Increase indent", "Decrease indent"]) {
      const trigger = root.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
      expect(trigger?.disabled).toBe(true);
      trigger?.dispatchEvent(new PointerEvent("pointerenter", { bubbles: true }));
      expect(tooltipContent(trigger!)?.textContent).toBe(label);
      trigger?.dispatchEvent(new PointerEvent("pointerleave", { bubbles: true }));
    }

    dispose();
    root.remove();
  });

  it("localizes the header menu trigger while keeping the menu options untouched", () => {
    const { root, dispose } = mountToolbar("zh-CN");
    const trigger = root.querySelector<HTMLButtonElement>('button[aria-label="字号"]');

    expect(trigger?.getAttribute("aria-haspopup")).toBe("listbox");
    expect(trigger?.hasAttribute("title")).toBe(false);
    expect(trigger?.closest(".tg-toolbar-tooltip")).not.toBeNull();

    trigger?.dispatchEvent(new PointerEvent("pointerenter", { bubbles: true }));
    expect(tooltipContent(trigger!)?.textContent).toBe("字号");
    trigger?.dispatchEvent(new PointerEvent("pointerleave", { bubbles: true }));

    trigger?.click();
    expect(trigger?.getAttribute("aria-expanded")).toBe("true");
    const option = root.querySelector<HTMLButtonElement>('button[aria-label="H1"]');
    expect(option).not.toBeNull();
    expect(root.querySelector('button[aria-label="Body"]')).not.toBeNull();

    // While the menu is open the tooltip stays hidden even when hovering the
    // trigger again — it must never cover the dropdown.
    trigger?.dispatchEvent(new PointerEvent("pointerenter", { bubbles: true }));
    expect(tooltipContent(trigger!)).toBeNull();
    trigger?.dispatchEvent(new PointerEvent("pointerleave", { bubbles: true }));

    // The dropdown list lives outside the tooltip wrapper, so hovering an
    // option (the hover target changed) must not re-open the tooltip.
    option?.dispatchEvent(new PointerEvent("pointerenter", { bubbles: true }));
    expect(tooltipContent(trigger!)).toBeNull();

    // Selecting an option closes the menu and re-arms the tooltip.
    option?.click();
    expect(trigger?.getAttribute("aria-expanded")).toBe("false");
    trigger?.dispatchEvent(new PointerEvent("pointerenter", { bubbles: true }));
    expect(tooltipContent(trigger!)?.textContent).toBe("字号");

    dispose();
    root.remove();
  });
});

describe("toolbar tooltip behavior", () => {
  function mountButton(tooltip?: string): { root: HTMLElement; dispose: () => void } {
    const root = document.createElement("div");
    document.body.append(root);
    const dispose = render(
      () => (
        <ToolbarButton label="Bold" tooltip={tooltip} onPress={() => undefined}>
          B
        </ToolbarButton>
      ),
      root,
    );
    return { root, dispose };
  }

  function content(root: HTMLElement): Element | null {
    return root.querySelector('.tg-toolbar-tooltip__content[role="tooltip"]');
  }

  it("opens on pointer enter and closes on pointer leave", () => {
    const { root, dispose } = mountButton("Bold");
    const button = root.querySelector("button")!;

    expect(content(root)).toBeNull();
    button.dispatchEvent(new PointerEvent("pointerenter", { bubbles: true }));
    expect(content(root)?.textContent).toBe("Bold");
    button.dispatchEvent(new PointerEvent("pointerleave", { bubbles: true }));
    expect(content(root)).toBeNull();
    dispose();
    root.remove();
  });

  it("opens on focus and closes on blur", () => {
    const { root, dispose } = mountButton("Bold");
    const button = root.querySelector("button")!;

    button.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
    expect(content(root)?.textContent).toBe("Bold");
    button.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
    expect(content(root)).toBeNull();
    dispose();
    root.remove();
  });

  it("closes on pointer down and stays closed until the pointer re-enters", () => {
    const { root, dispose } = mountButton("Bold");
    const button = root.querySelector("button")!;

    button.dispatchEvent(new PointerEvent("pointerenter", { bubbles: true }));
    expect(content(root)).not.toBeNull();
    button.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    expect(content(root)).toBeNull();
    // Focus arriving during the same interaction must not re-open the tooltip
    // (it would otherwise cover the header menu after a click).
    button.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
    expect(content(root)).toBeNull();
    // Leaving and re-entering re-arms the tooltip.
    button.dispatchEvent(new PointerEvent("pointerleave", { bubbles: true }));
    button.dispatchEvent(new PointerEvent("pointerenter", { bubbles: true }));
    expect(content(root)?.textContent).toBe("Bold");
    dispose();
    root.remove();
  });

  it("keeps the legacy title behavior when no tooltip copy is provided", () => {
    const { root, dispose } = mountButton();
    const button = root.querySelector("button")!;
    expect(button.getAttribute("title")).toBe("Bold");
    expect(root.querySelector(".tg-toolbar-tooltip")).toBeNull();
    dispose();
    root.remove();
  });
});

describe("computeBottomTooltipLayout (auto shift)", () => {
  const viewport = { width: 400, height: 300 };
  const contentSize = { width: 100, height: 28 };

  it("keeps the bubble centered when there is room", () => {
    const layout = computeBottomTooltipLayout({
      trigger: { left: 150, top: 10, width: 32, height: 32 },
      contentSize,
      viewport,
    });
    expect(layout.shiftX).toBe(0);
    expect(layout.arrowX).toBe(50);
  });

  it("shifts right and moves the arrow left near the leading edge", () => {
    // Trigger near left; ideal content left would be -34 without clamp.
    const layout = computeBottomTooltipLayout({
      trigger: { left: 8, top: 10, width: 32, height: 32 },
      contentSize,
      viewport,
      padding: 8,
      arrowPadding: 12,
    });
    expect(layout.shiftX).toBeGreaterThan(0);
    // Arrow aims at trigger center (8 + 16 = 24) within the shifted bubble.
    expect(layout.arrowX).toBeLessThan(50);
    expect(layout.arrowX).toBeGreaterThanOrEqual(12);
  });

  it("shifts left and moves the arrow right near the trailing edge", () => {
    const layout = computeBottomTooltipLayout({
      trigger: { left: 360, top: 10, width: 32, height: 32 },
      contentSize,
      viewport,
      padding: 8,
      arrowPadding: 12,
    });
    expect(layout.shiftX).toBeLessThan(0);
    expect(layout.arrowX).toBeGreaterThan(50);
    expect(layout.arrowX).toBeLessThanOrEqual(100 - 12);
  });

  it("scrolls out with the trigger when the trigger is far off-screen", () => {
    // Trigger fully left of the viewport — limitShift undoes viewport clamp
    // so the bubble does not stick to padding=8.
    const layout = computeBottomTooltipLayout({
      trigger: { left: -80, top: 10, width: 32, height: 32 },
      contentSize,
      viewport,
      padding: 8,
      arrowPadding: 12,
    });
    const triggerCenter = -80 + 16;
    const contentLeft = triggerCenter - contentSize.width / 2 + layout.shiftX;
    expect(contentLeft).toBeLessThan(0);
    // Arrow stays aimed at the off-screen trigger (pinned to the bubble's
    // leading arrow padding after limitShift).
    expect(layout.arrowX).toBe(12);
  });
});

describe("insert actions and separator", () => {
  const ENGLISH_FORMAT_ORDER = [
    "Font size",
    "Bold",
    "Italic",
    "Underline",
    "Link",
    "Divider",
    "Decrease indent",
    "Increase indent",
    "Bulleted list",
    "Numbered list",
    "Quote",
  ];
  const CHINESE_FORMAT_ORDER = [
    "字号",
    "粗体",
    "斜体",
    "下划线",
    "链接",
    "分割线",
    "左缩进",
    "右缩进",
    "无序列表",
    "有序列表",
    "引用",
  ];

  function itemLabels(root: HTMLElement): string[] {
    return Array.from(root.querySelectorAll<HTMLButtonElement>("button[aria-label]"))
      .map((button) => button.getAttribute("aria-label")!)
      .filter((label) => label !== "Close");
  }

  it("renders no insert actions and no separator when visibleInsertActions is omitted or empty", () => {
    const fake = createFakeAdapter();
    const root = document.createElement("div");
    document.body.append(root);

    const dispose = render(
      () => (
        <RichTextProvider editor={createRichTextEditor({ adapterFactory: () => fake.adapter })}>
          <RichTextToolbar />
        </RichTextProvider>
      ),
      root,
    );

    expect(itemLabels(root)).toEqual(ENGLISH_FORMAT_ORDER);
    expect(root.querySelector(".tg-toolbar-separator")).toBeNull();

    dispose();
    root.remove();
  });

  it("renders all 4 insert actions in fixed order before format controls in English and Chinese", () => {
    const fake = createFakeAdapter();

    // English
    setBrowserLanguage("en-US");
    const rootEn = document.createElement("div");
    document.body.append(rootEn);
    const disposeEn = render(
      () => (
        <RichTextProvider editor={createRichTextEditor({ adapterFactory: () => fake.adapter })}>
          <RichTextToolbar
            visibleInsertActions={["emoji", "mention", "channel", "image"]}
            onRequestEmoji={() => undefined}
            onRequestMention={() => undefined}
            onRequestChannel={() => undefined}
            onRequestImage={() => undefined}
          />
        </RichTextProvider>
      ),
      rootEn,
    );

    expect(itemLabels(rootEn)).toEqual([
      "Emoji",
      "Mention",
      "Channel",
      "Image",
      ...ENGLISH_FORMAT_ORDER,
    ]);
    const sepEn = rootEn.querySelector(".tg-toolbar-separator");
    expect(sepEn).not.toBeNull();
    expect(sepEn?.getAttribute("aria-hidden")).toBe("true");
    disposeEn();
    rootEn.remove();

    // Chinese
    setBrowserLanguage("zh-CN");
    const rootZh = document.createElement("div");
    document.body.append(rootZh);
    const disposeZh = render(
      () => (
        <RichTextProvider editor={createRichTextEditor({ adapterFactory: () => fake.adapter })}>
          <RichTextToolbar
            visibleInsertActions={["emoji", "mention", "channel", "image"]}
            onRequestEmoji={() => undefined}
            onRequestMention={() => undefined}
            onRequestChannel={() => undefined}
            onRequestImage={() => undefined}
          />
        </RichTextProvider>
      ),
      rootZh,
    );

    expect(itemLabels(rootZh)).toEqual(["表情", "提及", "频道", "图片", ...CHINESE_FORMAT_ORDER]);
    disposeZh();
    rootZh.remove();
  });

  it("enforces fixed order and deduplicates/ignores unknown insert actions", () => {
    const fake = createFakeAdapter();
    const root = document.createElement("div");
    document.body.append(root);

    const dispose = render(
      () => (
        <RichTextProvider editor={createRichTextEditor({ adapterFactory: () => fake.adapter })}>
          <RichTextToolbar
            visibleInsertActions={["image", "unknown" as any, "emoji", "image"]}
            onRequestEmoji={() => undefined}
            onRequestImage={() => undefined}
          />
        </RichTextProvider>
      ),
      root,
    );

    expect(itemLabels(root)).toEqual(["Emoji", "Image", ...ENGLISH_FORMAT_ORDER]);
    expect(root.querySelector(".tg-toolbar-separator")).not.toBeNull();

    dispose();
    root.remove();
  });

  it("disables insert actions when corresponding callback is missing or when title is focused", () => {
    const fake = createFakeAdapter();
    const [titleFocused, setTitleFocused] = createSignal(false);
    const root = document.createElement("div");
    document.body.append(root);

    const onRequestEmoji = vi.fn();

    const dispose = render(
      () => (
        <RichTextProvider editor={createRichTextEditor({ adapterFactory: () => fake.adapter })}>
          <RichTextToolbar
            visibleInsertActions={["emoji", "mention"]}
            onRequestEmoji={onRequestEmoji}
            titleFocused={titleFocused}
          />
          <RichTextEditor />
        </RichTextProvider>
      ),
      root,
    );

    const emojiButton = root.querySelector<HTMLButtonElement>('button[aria-label="Emoji"]');
    const mentionButton = root.querySelector<HTMLButtonElement>('button[aria-label="Mention"]');

    // Emoji has callback -> enabled; Mention has no callback -> disabled
    expect(emojiButton?.disabled).toBe(false);
    expect(mentionButton?.disabled).toBe(true);

    // Title focused -> both disabled
    setTitleFocused(true);
    expect(emojiButton?.disabled).toBe(true);
    expect(mentionButton?.disabled).toBe(true);

    emojiButton?.click();
    expect(onRequestEmoji).not.toHaveBeenCalled();

    dispose();
    root.remove();
  });

  it("passes current editor selection to insert action callbacks and does not restore focus", () => {
    const fake = createFakeAdapter();
    const focus = vi.fn();
    fake.adapter.focus = focus;
    let controller!: SolidRichTextController;

    const onRequestEmoji = vi.fn();
    const onRequestImage = vi.fn();

    const root = document.createElement("div");
    document.body.append(root);

    const dispose = render(() => {
      controller = createRichTextEditor({ adapterFactory: () => fake.adapter });
      return (
        <RichTextProvider editor={controller}>
          <RichTextToolbar
            visibleInsertActions={["emoji", "image"]}
            onRequestEmoji={onRequestEmoji}
            onRequestImage={onRequestImage}
          />
          <RichTextEditor />
        </RichTextProvider>
      );
    }, root);

    fake.emit({
      type: "state-change",
      state: {
        ...initialState,
        focused: true,
        selection: { start: 2, end: 5 },
      },
    });

    const emojiButton = root.querySelector<HTMLButtonElement>('button[aria-label="Emoji"]');
    emojiButton?.click();

    expect(onRequestEmoji).toHaveBeenCalledTimes(1);
    expect(onRequestEmoji).toHaveBeenCalledWith({ start: 2, end: 5 });
    expect(focus).not.toHaveBeenCalled();

    fake.emit({
      type: "state-change",
      state: {
        ...initialState,
        focused: false,
        selection: null,
      },
    });

    const imageButton = root.querySelector<HTMLButtonElement>('button[aria-label="Image"]');
    imageButton?.click();

    expect(onRequestImage).toHaveBeenCalledTimes(1);
    expect(onRequestImage).toHaveBeenCalledWith(null);
    expect(focus).not.toHaveBeenCalled();

    dispose();
    root.remove();
  });
});
