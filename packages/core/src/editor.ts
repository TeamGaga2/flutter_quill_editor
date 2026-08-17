import type { RichTextSnapshotV1 } from "@teamgaga/richtext-delta";
import type { RichTextAdapter } from "./adapter";
import type { CaretRect, EditorCommands, EditorHistory } from "./commands";
import type {
  EditorAdapterEvent,
  EditorEvent,
  EditorEventListener,
  EditorEventType,
  Unsubscribe,
} from "./events";
import { assertValidSelection, type RichTextSelection } from "./selection";
import type { EditorState } from "./state";

export interface CreateEditorOptions {
  adapter: RichTextAdapter;
}

export interface RichTextEditor {
  readonly commands: EditorCommands;
  readonly history: EditorHistory;

  mount(): void;
  destroy(): void;

  getSnapshot(): RichTextSnapshotV1;
  setSnapshot(snapshot: RichTextSnapshotV1): void;
  setTitle(title: string): void;

  getSelection(): RichTextSelection | null;
  setSelection(selection: RichTextSelection): void;

  getCaretRect(): CaretRect | null;

  getState(): EditorState;

  focus(): void;
  blur(): void;

  on<Type extends EditorEventType>(type: Type, listener: EditorEventListener<Type>): Unsubscribe;
}

export function createEditor(options: CreateEditorOptions): RichTextEditor {
  const listeners = new Map<EditorEventType, Set<(event: EditorEvent) => void>>();
  let unsubscribeAdapter: Unsubscribe | undefined;
  let mounted = false;
  let destroyed = false;

  const emit = (event: EditorEvent): void => {
    for (const listener of listeners.get(event.type) ?? []) {
      listener(event);
    }
  };

  const assertNotDestroyed = (): void => {
    if (destroyed) {
      throw new Error("Editor has been destroyed.");
    }
  };

  const execute = (command: Parameters<RichTextAdapter["execute"]>[0]): void => {
    assertNotDestroyed();
    options.adapter.execute(command);
  };

  const commands: EditorCommands = {
    toggleBold: () => execute({ type: "toggle-inline-format", format: "bold" }),
    toggleItalic: () => execute({ type: "toggle-inline-format", format: "italic" }),
    toggleUnderline: () => execute({ type: "toggle-inline-format", format: "underline" }),
    toggleStrike: () => execute({ type: "toggle-inline-format", format: "strike" }),
    toggleHeader: (level) =>
      execute({ type: "toggle-block-format", format: "header", value: level }),
    toggleList: (type) => execute({ type: "toggle-block-format", format: "list", value: type }),
    toggleBlockquote: () => execute({ type: "toggle-block-format", format: "blockquote" }),
    insertEmoji(id) {
      if (id.trim().length === 0) {
        throw new Error("Emoji id must be a non-empty string.");
      }

      execute({ type: "insert-emoji", id });
    },
    insertMention(mention, selection) {
      assertValidInsertText(mention.id, "Mention id");
      assertValidInsertText(mention.displayText, "Mention displayText");
      if (mention.sign !== "!" && mention.sign !== "&") {
        throw new Error('Mention sign must be "!" or "&".');
      }
      assertOptionalSelection(selection);
      execute({ type: "insert-mention", mention, selection });
    },
    insertChannel(channel, selection) {
      assertValidInsertText(channel.id, "Channel id");
      assertValidInsertText(channel.displayText, "Channel displayText");
      assertOptionalSelection(selection);
      execute({ type: "insert-channel", channel, selection });
    },
    insertImage(image, selection) {
      assertValidInsertText(image.src, "Image src");
      assertOptionalSelection(selection);
      execute({ type: "insert-image", image, selection });
    },
    insertVideo(video, selection) {
      assertValidInsertText(video.src, "Video src");
      assertOptionalSelection(selection);
      execute({ type: "insert-video", video, selection });
    },
    insertLink(link, selection) {
      assertValidInsertText(link.url, "Link url");
      assertValidInsertText(link.text, "Link text");
      assertOptionalSelection(selection);
      execute({ type: "insert-link", link, selection });
    },
    insertDivider(selection) {
      assertOptionalSelection(selection);
      execute({ type: "insert-divider", selection });
    },
    indent: () => execute({ type: "indent" }),
    outdent: () => execute({ type: "outdent" }),
  };

  const history: EditorHistory = {
    undo: () => execute({ type: "undo" }),
    redo: () => execute({ type: "redo" }),
  };

  return {
    commands,
    history,

    mount() {
      assertNotDestroyed();

      if (mounted) {
        return;
      }

      unsubscribeAdapter = options.adapter.subscribe((event: EditorAdapterEvent) => {
        emit(event);
      });
      mounted = true;
      emit({ type: "ready" });
    },

    getSnapshot() {
      assertNotDestroyed();
      return options.adapter.getSnapshot();
    },

    setSnapshot(snapshot) {
      assertNotDestroyed();
      options.adapter.setSnapshot(snapshot);
    },

    setTitle(title) {
      assertNotDestroyed();
      options.adapter.setTitle(title);
    },

    getSelection() {
      assertNotDestroyed();
      return options.adapter.getSelection();
    },

    setSelection(selection) {
      assertNotDestroyed();
      assertValidSelection(selection);
      options.adapter.setSelection(selection);
    },

    getCaretRect() {
      assertNotDestroyed();
      return options.adapter.getCaretRect();
    },

    getState() {
      assertNotDestroyed();
      return options.adapter.getState();
    },

    focus() {
      assertNotDestroyed();
      options.adapter.focus();
    },

    blur() {
      assertNotDestroyed();
      options.adapter.blur();
    },

    on(type, listener) {
      assertNotDestroyed();
      const untypedListener = listener as (event: EditorEvent) => void;
      const typeListeners = listeners.get(type) ?? new Set<(event: EditorEvent) => void>();
      typeListeners.add(untypedListener);
      listeners.set(type, typeListeners);

      return () => {
        typeListeners.delete(untypedListener);
      };
    },

    destroy() {
      if (destroyed) {
        return;
      }

      destroyed = true;
      unsubscribeAdapter?.();
      options.adapter.destroy();
      listeners.clear();
    },
  };
}

function assertValidInsertText(value: string, label: string): void {
  if (value.trim().length === 0) {
    throw new Error(`${label} must be a non-empty string.`);
  }
}

function assertOptionalSelection(selection: RichTextSelection | undefined): void {
  if (selection) {
    assertValidSelection(selection);
  }
}
