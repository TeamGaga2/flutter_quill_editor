import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createRoot, type Accessor, type JSX } from "solid-js";
import { render } from "solid-js/web";
import { describe, expect, it, vi } from "vite-plus/test";
import type {
  EditorAdapterEvent,
  EditorCommand,
  EditorState,
  RichTextAdapter,
} from "@teamgaga/richtext-core";
import {
  createRichTextEditor,
  EMPTY_EDITOR_STATE,
  RichTextEditor,
  RichTextProvider,
  useEditorState,
  useRichText,
  type SolidRichTextController,
} from "../src/index.ts";

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
  const destroy = vi.fn();
  const unsubscribe = vi.fn();
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
    execute: (command) => {
      commands.push(command);
    },
    subscribe: (nextListener) => {
      listener = nextListener;
      return unsubscribe;
    },
    destroy,
  };

  return {
    adapter,
    commands,
    destroy,
    emit(event: EditorAdapterEvent) {
      if (event.type === "state-change") {
        state = event.state;
      }

      listener?.(event);
    },
    unsubscribe,
  };
}

describe("createRichTextEditor", () => {
  it("creates the adapter lazily and cleans up idempotently", () => {
    const fake = createFakeAdapter();
    const adapterFactory = vi.fn((_element: HTMLElement): RichTextAdapter => fake.adapter);

    createRoot((dispose) => {
      const controller = createRichTextEditor({ adapterFactory });
      const element = document.createElement("div");

      expect(adapterFactory).not.toHaveBeenCalled();

      const editor = controller.mount(element);

      expect(adapterFactory).toHaveBeenCalledWith(element);
      expect(controller.editor()).toBe(editor);
      expect(controller.mount(element)).toBe(editor);
      expect(adapterFactory).toHaveBeenCalledTimes(1);

      controller.destroy();
      controller.destroy();

      expect(controller.editor()).toBeUndefined();
      expect(fake.unsubscribe).toHaveBeenCalledTimes(1);
      expect(fake.destroy).toHaveBeenCalledTimes(1);

      dispose();
    });
  });

  it("closes the Solid to Core to Quill snapshot loop", () => {
    createRoot((dispose) => {
      const controller = createRichTextEditor();
      const element = document.createElement("div");
      document.body.append(element);

      const editor = controller.mount(element);

      expect(editor.getSnapshot()).toEqual({
        content: [{ insert: "\n" }],
      });

      dispose();
      element.remove();
    });
  });
});

describe("useEditorState", () => {
  it("bridges Core state events without storing snapshots", async () => {
    const fake = createFakeAdapter();
    let controller!: SolidRichTextController;
    let editorState!: Accessor<EditorState>;
    let dispose!: () => void;

    createRoot((rootDispose) => {
      dispose = rootDispose;
      controller = createRichTextEditor({ adapterFactory: () => fake.adapter });
      editorState = useEditorState(controller);
      controller.mount(document.createElement("div"));
    });

    await Promise.resolve();
    expect(editorState()).toEqual(initialState);

    const nextState: EditorState = {
      focused: true,
      selection: { start: 1, end: 3 },
      canUndo: true,
      canRedo: false,
      formats: {
        bold: true,
        italic: false,
        underline: true,
        strike: false,
        header: 2,
        list: "ordered",
        blockquote: true,
      },
    };

    fake.emit({ type: "state-change", state: nextState });

    expect(editorState()).toBe(nextState);

    controller.destroy();
    await Promise.resolve();
    expect(editorState()).toBe(EMPTY_EDITOR_STATE);

    dispose();
  });
});

describe("RichText context and component", () => {
  it("throws when the context is missing", () => {
    expect(() => createRoot(() => useRichText())).toThrow(
      "useRichText must be used within a RichTextProvider.",
    );
  });

  it("mounts the DOM container and destroys the editor on cleanup", () => {
    const fake = createFakeAdapter();
    let mountedElement: HTMLElement | undefined;
    const adapterFactory = vi.fn((element: HTMLElement): RichTextAdapter => {
      mountedElement = element;
      return fake.adapter;
    });

    function App(): JSX.Element {
      const controller = createRichTextEditor({ adapterFactory });

      return (
        <RichTextProvider editor={controller}>
          <RichTextEditor id="editor" aria-label="Message editor" />
        </RichTextProvider>
      );
    }

    const root = document.createElement("div");
    const dispose = render(() => <App />, root);

    expect(mountedElement).toBe(root.querySelector("#editor"));
    expect(mountedElement?.getAttribute("aria-label")).toBe("Message editor");

    dispose();

    expect(fake.unsubscribe).toHaveBeenCalledTimes(1);
    expect(fake.destroy).toHaveBeenCalledTimes(1);
  });
});

describe("editor styles", () => {
  it("renders ordered and bullet markers with compact spacing", () => {
    const stylePath = [
      resolve(process.cwd(), "packages/solid/src/styles/editor.css"),
      resolve(process.cwd(), "src/styles/editor.css"),
    ].find((candidate) => existsSync(candidate));

    if (!stylePath) {
      throw new Error("Editor stylesheet was not found.");
    }

    const styles = readFileSync(stylePath, "utf8");

    expect(styles).toContain('li[data-list="ordered"] > .ql-ui::before');
    expect(styles).toContain('content: counter(list-0, decimal) "."');
    expect(styles).toContain('li[data-list="bullet"] > .ql-ui::before');
    expect(styles).toContain('content: "\\2022"');
    expect(styles).toContain("padding-left: 2em");
    expect(styles).toContain("padding-left: 0");
    // Safari/WKWebView CJK IME: must not keep Quill's relative/absolute list UI.
    expect(styles).toContain("position: static");
    expect(styles).toContain("display: contents");
  });

  it("renders a blockquote with a left color bar", () => {
    const stylePath = [
      resolve(process.cwd(), "packages/solid/src/styles/editor.css"),
      resolve(process.cwd(), "src/styles/editor.css"),
    ].find((candidate) => existsSync(candidate));

    if (!stylePath) {
      throw new Error("Editor stylesheet was not found.");
    }

    const styles = readFileSync(stylePath, "utf8");

    expect(styles).toContain(".ql-editor blockquote");
    expect(styles).toContain("border-inline-start: 4px solid #cbd5e1");
    expect(styles).toContain("padding-inline-start: 0.75em");
    // Block spacing (ADR 0002): the first quote line of a group is a
    // top-level block with 12px margin-top; consecutive lines keep 0 so the
    // bar stays continuous. Forward sibling selectors only — relational
    // :has selectors break continuity on WKWebView Enter (stale margin).
    expect(styles).toContain("margin: 12px 0 0");
    expect(styles).toContain("blockquote + blockquote");
    expect(styles).toContain("margin-top: 0");
    expect(styles).not.toContain("*:not(blockquote) + blockquote");
    expect(styles).not.toContain("blockquote + *:not(blockquote)");
    expect(styles).not.toMatch(/blockquote\s*:has\s*\(/);
  });
});
