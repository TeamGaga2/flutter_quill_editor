import { createEffect, createSignal, onCleanup, type Accessor } from "solid-js";
import type {
  CaretRect,
  ChannelInsert,
  MentionInsert,
  RichTextEditor,
} from "@teamgaga/richtext-core";

export interface TriggerState {
  isOpen: boolean;
  type: "mention" | "channel" | null;
  query: string;
  replaceRange: { start: number; end: number } | null;
  anchor: CaretRect | null;
}

export function detectTriggerContext(editor: RichTextEditor): {
  type: "mention" | "channel";
  query: string;
  triggerIndex: number;
  caretIndex: number;
  anchor: CaretRect | null;
} | null {
  const selection = editor.getSelection();
  if (!selection) return null;

  const { start, end } = selection;
  // Trigger requires a collapsed caret and at least index 1
  if (start !== end || start === 0) return null;

  const caretIndex = start;
  const snapshot = editor.getSnapshot();
  const content = snapshot.content;

  // Reconstruct text before caret
  let currentOffset = 0;
  let textBeforeCaret = "";

  for (const rawOp of content) {
    const op = rawOp as { insert?: unknown };
    if (typeof op.insert === "string") {
      const opLen = op.insert.length;
      const opEnd = currentOffset + opLen;

      if (caretIndex <= opEnd) {
        const sliceLen = caretIndex - currentOffset;
        textBeforeCaret += op.insert.slice(0, sliceLen);
        break;
      } else {
        textBeforeCaret += op.insert;
        currentOffset = opEnd;
      }
    } else {
      // Embed blot (length = 1)
      const opEnd = currentOffset + 1;
      if (caretIndex <= opEnd) {
        break;
      }
      textBeforeCaret += "\0";
      currentOffset = opEnd;
    }
  }

  const lastLine = textBeforeCaret.split("\n").pop() ?? "";
  const lastSegment = lastLine.split("\0").pop() ?? "";

  // Match @ or # preceded by start of line, whitespace, or punctuation
  const match = lastSegment.match(/(?:^|[\s([{'"])([@#])([^\s@#]*)$/);
  if (!match) {
    return null;
  }

  const triggerChar = match[1];
  const query = match[2] ?? "";
  const triggerType: "mention" | "channel" = triggerChar === "@" ? "mention" : "channel";
  const triggerLen = 1 + query.length;
  const triggerIndex = caretIndex - triggerLen;

  const anchor = editor.getCaretRect();

  return {
    type: triggerType,
    query,
    triggerIndex,
    caretIndex,
    anchor,
  };
}

export function useTriggerDetection(editorAccessor: Accessor<RichTextEditor | undefined>) {
  const [triggerState, setTriggerState] = createSignal<TriggerState>({
    isOpen: false,
    type: null,
    query: "",
    replaceRange: null,
    anchor: null,
  });

  let dismissedTriggerIndex: number | null = null;

  const checkTrigger = (): void => {
    const editor = editorAccessor();
    if (!editor) {
      setTriggerState({
        isOpen: false,
        type: null,
        query: "",
        replaceRange: null,
        anchor: null,
      });
      return;
    }

    const context = detectTriggerContext(editor);
    if (!context) {
      dismissedTriggerIndex = null;
      setTriggerState({
        isOpen: false,
        type: null,
        query: "",
        replaceRange: null,
        anchor: null,
      });
      return;
    }

    // Check if dismissed at this position
    if (dismissedTriggerIndex !== null && context.triggerIndex === dismissedTriggerIndex) {
      return;
    }

    // If new trigger position, reset dismissed
    if (dismissedTriggerIndex !== null && context.triggerIndex !== dismissedTriggerIndex) {
      dismissedTriggerIndex = null;
    }

    setTriggerState({
      isOpen: true,
      type: context.type,
      query: context.query,
      replaceRange: {
        start: context.triggerIndex,
        end: context.caretIndex,
      },
      anchor: context.anchor,
    });
  };

  createEffect(() => {
    const editor = editorAccessor();
    if (!editor) return;

    // Listen to editor changes and selection updates
    const unsubChange = editor.on("change", () => {
      // Run after tick so selection is fully synchronized
      queueMicrotask(checkTrigger);
    });

    const unsubSelection = editor.on("selection-change", () => {
      queueMicrotask(checkTrigger);
    });

    // Also listen to window events like keyup, input, scroll/resize
    const handleInputOrKeyUp = (): void => {
      queueMicrotask(checkTrigger);
    };

    const handleScrollOrResize = (): void => {
      if (triggerState().isOpen) {
        checkTrigger();
      }
    };

    window.addEventListener("keyup", handleInputOrKeyUp, true);
    window.addEventListener("input", handleInputOrKeyUp, true);
    window.addEventListener("scroll", handleScrollOrResize, true);
    window.addEventListener("resize", handleScrollOrResize, true);

    onCleanup(() => {
      unsubChange();
      unsubSelection();
      window.removeEventListener("keyup", handleInputOrKeyUp, true);
      window.removeEventListener("input", handleInputOrKeyUp, true);
      window.removeEventListener("scroll", handleScrollOrResize, true);
      window.removeEventListener("resize", handleScrollOrResize, true);
    });
  });

  const closeTrigger = (): void => {
    const current = triggerState();
    if (current.replaceRange) {
      dismissedTriggerIndex = current.replaceRange.start;
    }
    setTriggerState({
      isOpen: false,
      type: null,
      query: "",
      replaceRange: null,
      anchor: null,
    });
  };

  const insertMention = (mention: MentionInsert): void => {
    const editor = editorAccessor();
    const range = triggerState().replaceRange;
    if (editor) {
      editor.commands.insertMention(mention, range ?? undefined);
      editor.focus();
    }
    closeTrigger();
  };

  const insertChannel = (channel: ChannelInsert): void => {
    const editor = editorAccessor();
    const range = triggerState().replaceRange;
    if (editor) {
      editor.commands.insertChannel(channel, range ?? undefined);
      editor.focus();
    }
    closeTrigger();
  };

  return {
    triggerState,
    closeTrigger,
    insertMention,
    insertChannel,
  };
}
