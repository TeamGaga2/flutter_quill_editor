import { describe, expect, it, vi } from "vite-plus/test";
import type {
  EditorAdapterEvent,
  EditorCommand,
  EditorState,
  RichTextAdapter,
} from "@teamgaga/richtext-core";
import { mountHostApp } from "../src/ui/mount-host-app";

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
    destroy,
    unsubscribe,
    emit(event: EditorAdapterEvent) {
      listener?.(event);
    },
  };
}

describe("HostApp mount boundary", () => {
  it("mounts a core editor without toolbar chrome", async () => {
    const fake = createFakeAdapter();
    const root = document.createElement("div");
    document.body.append(root);

    const mounted = mountHostApp(root, {
      adapterFactory: () => fake.adapter,
    });

    const editor = await mounted.editorReady;
    expect(editor.getSnapshot()).toEqual({ content: [{ insert: "\n" }] });
    expect(root.querySelector(".tg-richtext-host-editor")).not.toBeNull();
    expect(root.querySelector('[aria-label="Rich text editor"]')).not.toBeNull();
    expect(root.textContent ?? "").not.toMatch(/toolbar/i);
    expect(root.querySelector("[data-toolbar]")).toBeNull();

    mounted.dispose();
    mounted.dispose();

    expect(fake.destroy).toHaveBeenCalled();
    expect(root.childNodes.length).toBe(0);

    root.remove();
  });

  it("renders optional chrome inside the provider tree", async () => {
    const fake = createFakeAdapter();
    const root = document.createElement("div");
    document.body.append(root);

    const mounted = mountHostApp(root, {
      adapterFactory: () => fake.adapter,
      renderChrome: () => (
        <div data-testid="host-chrome" role="toolbar" aria-label="Test chrome">
          Chrome
        </div>
      ),
    });

    await mounted.editorReady;
    expect(root.querySelector('[data-testid="host-chrome"]')).not.toBeNull();
    expect(root.querySelector(".tg-richtext-host-editor")).not.toBeNull();

    mounted.dispose();
    root.remove();
  });

  it("places headerElement between chrome and the editor body", async () => {
    const fake = createFakeAdapter();
    const root = document.createElement("div");
    document.body.append(root);
    const header = document.createElement("div");
    header.dataset.testid = "host-header";
    header.textContent = "Title";

    const mounted = mountHostApp(root, {
      adapterFactory: () => fake.adapter,
      renderChrome: () => <div data-testid="host-chrome">Chrome</div>,
      headerElement: header,
    });

    await mounted.editorReady;
    const chrome = root.querySelector('[data-testid="host-chrome"]');
    const headerNode = root.querySelector('[data-testid="host-header"]');
    const editor = root.querySelector(".tg-richtext-host-editor");
    expect(chrome).not.toBeNull();
    expect(headerNode).not.toBeNull();
    expect(editor).not.toBeNull();

    const position = (node: Element | null): number => {
      if (!node) return -1;
      return [...root.querySelectorAll("*")].indexOf(node);
    };
    expect(position(chrome)).toBeLessThan(position(headerNode));
    expect(position(headerNode)).toBeLessThan(position(editor));

    mounted.dispose();
    root.remove();
  });

  it("resolves editorReady only once", async () => {
    const fake = createFakeAdapter();
    const root = document.createElement("div");
    document.body.append(root);

    const mounted = mountHostApp(root, {
      adapterFactory: () => fake.adapter,
    });

    const first = await mounted.editorReady;
    const second = await mounted.editorReady;
    expect(first).toBe(second);

    mounted.dispose();
    root.remove();
  });

  it("rejects editorReady when adapter construction fails", async () => {
    const root = document.createElement("div");
    document.body.append(root);

    const mounted = mountHostApp(root, {
      adapterFactory: () => {
        throw new Error("adapter boom");
      },
    });

    await expect(mounted.editorReady).rejects.toThrow(/adapter boom/);
    mounted.dispose();
    expect(root.childNodes.length).toBe(0);
    root.remove();
  });

  it("dispose is idempotent and clears the root after ready", async () => {
    const fake = createFakeAdapter();
    const root = document.createElement("div");
    document.body.append(root);

    const mounted = mountHostApp(root, {
      adapterFactory: () => fake.adapter,
    });
    await mounted.editorReady;

    mounted.dispose();
    mounted.dispose();

    expect(root.childNodes.length).toBe(0);
    expect(fake.destroy).toHaveBeenCalled();
    root.remove();
  });
});
