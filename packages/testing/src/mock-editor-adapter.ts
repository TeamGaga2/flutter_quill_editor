import type {
  CaretRect,
  EditorAdapterEvent,
  EditorCommand,
  EditorState,
  RichTextAdapter,
  RichTextSelection,
  Unsubscribe,
} from "@teamgaga/richtext-core";
import type { RichTextSnapshotV1 } from "@teamgaga/richtext-delta";

const EMPTY_SNAPSHOT: RichTextSnapshotV1 = {
  content: [{ insert: "\n" }],
};

const EMPTY_STATE: EditorState = {
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

export interface MockEditorAdapterOptions {
  snapshot?: RichTextSnapshotV1;
  selection?: RichTextSelection | null;
  state?: EditorState;
  caretRect?: CaretRect | null;
}

/** 可在 core 和 UI 测试中替代真实 Quill 实例的轻量 adapter。 */
export class MockEditorAdapter implements RichTextAdapter {
  readonly commands: EditorCommand[] = [];

  private snapshot: RichTextSnapshotV1;
  private selection: RichTextSelection | null;
  private lastSelection: RichTextSelection | null;
  private state: EditorState;
  private caretRect: CaretRect | null;
  private readonly listeners = new Set<(event: EditorAdapterEvent) => void>();

  constructor(options: MockEditorAdapterOptions = {}) {
    this.snapshot = structuredClone(options.snapshot ?? EMPTY_SNAPSHOT);
    this.selection = structuredClone(options.selection ?? null);
    this.lastSelection = structuredClone(this.selection);
    this.state = structuredClone(options.state ?? EMPTY_STATE);
    this.caretRect = options.caretRect === undefined ? null : structuredClone(options.caretRect);
  }

  getSnapshot(): RichTextSnapshotV1 {
    return structuredClone(this.snapshot);
  }

  setSnapshot(snapshot: RichTextSnapshotV1): void {
    this.snapshot = structuredClone(snapshot);
  }

  setTitle(title: string): void {
    this.snapshot = { ...structuredClone(this.snapshot), title };
    this.emit({ type: "change" });
  }

  getSelection(): RichTextSelection | null {
    return structuredClone(this.selection);
  }

  setSelection(selection: RichTextSelection): void {
    this.selection = structuredClone(selection);
    this.lastSelection = structuredClone(selection);
    this.state = { ...this.state, focused: true, selection: structuredClone(selection) };
  }

  getCaretRect(): CaretRect | null {
    return this.caretRect === null ? null : structuredClone(this.caretRect);
  }

  setCaretRect(rect: CaretRect | null): void {
    this.caretRect = rect === null ? null : structuredClone(rect);
  }

  getState(): EditorState {
    return structuredClone(this.state);
  }

  setState(state: EditorState): void {
    this.state = structuredClone(state);
    this.selection = structuredClone(state.selection);

    if (state.selection) {
      this.lastSelection = structuredClone(state.selection);
    }
  }

  focus(): void {
    if (this.state.focused) {
      return;
    }

    this.selection = structuredClone(this.lastSelection);
    this.state = { ...this.state, focused: true, selection: this.getSelection() };
    this.emit({ type: "focus" });
    this.emit({ type: "state-change", state: this.getState() });
  }

  blur(): void {
    if (!this.state.focused) {
      return;
    }

    this.state = { ...this.state, focused: false, selection: null };
    this.selection = null;
    this.emit({ type: "selection-change", selection: null });
    this.emit({ type: "blur" });
    this.emit({ type: "state-change", state: this.getState() });
  }

  execute(command: EditorCommand): void {
    this.commands.push(structuredClone(command));
  }

  subscribe(listener: (event: EditorAdapterEvent) => void): Unsubscribe {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  emit(event: EditorAdapterEvent): void {
    for (const listener of this.listeners) {
      listener(event);
    }
  }

  destroy(): void {
    this.listeners.clear();
  }
}
