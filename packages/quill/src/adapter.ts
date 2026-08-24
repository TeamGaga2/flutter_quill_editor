import Quill, { Delta, type Range } from "quill";
import type {
  CaretRect,
  EditorAdapterEvent,
  ChannelInsert,
  EditorCommand,
  EditorState,
  HeaderLevel,
  ImageInsert,
  LinkInsert,
  ListType,
  MentionInsert,
  VideoInsert,
} from "@teamgaga/richtext-core";
import {
  assertValidSnapshot,
  normalizeSnapshot,
  type RichTextSnapshotV1,
} from "@teamgaga/richtext-delta";
import { registerBlots } from "./blots/register";
import { installClipboardPolicy } from "./clipboard/clipboard-policy";
import { quillDeltaToSnapshot, snapshotToQuillDelta } from "./converters";
import { hydrateEmojiNodes } from "./emoji/renderer";
import { MAX_INDENT_LEVEL } from "./blots/indent";
import { RICH_TEXT_FORMATS } from "./formats";
import type { QuillAdapter, QuillAdapterOptions } from "./types";

type ScrollRect = {
  top: number;
  right: number;
  bottom: number;
  left: number;
};

function readScrollPadding(value: string | undefined): number {
  const parsed = Number.parseFloat(value ?? "");
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

/**
 * Scroll one explicitly-owned port just enough to reveal a viewport-relative
 * Quill rect. This deliberately does not call Element#scrollIntoView: that API
 * is allowed to walk ancestors and can hand ownership back to WKWebView.
 */
function scrollRectWithinContainer(container: HTMLElement, target: ScrollRect): void {
  const containerRect = container.getBoundingClientRect();
  if (
    !Number.isFinite(containerRect.width) ||
    !Number.isFinite(containerRect.height) ||
    containerRect.width <= 0 ||
    containerRect.height <= 0
  ) {
    return;
  }

  const style = container.ownerDocument.defaultView?.getComputedStyle(container);
  const paddingTop = readScrollPadding(style?.scrollPaddingTop);
  const paddingRight = readScrollPadding(style?.scrollPaddingRight);
  const paddingBottom = Math.max(readScrollPadding(style?.scrollPaddingBottom), 16);
  const paddingLeft = readScrollPadding(style?.scrollPaddingLeft);

  const visibleTop = containerRect.top + paddingTop;
  const visibleBottom = containerRect.bottom - paddingBottom;
  const visibleLeft = containerRect.left + paddingLeft;
  const visibleRight = containerRect.right - paddingRight;

  let nextScrollTop = container.scrollTop;
  if (target.top < visibleTop) {
    nextScrollTop = container.scrollTop + (target.top - visibleTop);
  } else if (target.bottom > visibleBottom) {
    nextScrollTop = container.scrollTop + (target.bottom - visibleBottom);
  }

  let nextScrollLeft = container.scrollLeft;
  if (target.left < visibleLeft) {
    nextScrollLeft = container.scrollLeft + (target.left - visibleLeft);
  } else if (target.right > visibleRight) {
    nextScrollLeft = container.scrollLeft + (target.right - visibleRight);
  }

  if (Math.abs(nextScrollTop - container.scrollTop) >= 1) {
    container.scrollTop = Math.max(0, nextScrollTop);
  }
  if (Math.abs(nextScrollLeft - container.scrollLeft) >= 1) {
    container.scrollLeft = Math.max(0, nextScrollLeft);
  }
}

export function createQuillAdapter(options: QuillAdapterOptions): QuillAdapter {
  registerBlots();
  installClipboardPolicy();
  const placeholder = options.placeholder?.trim() ?? "";
  const quill = new Quill(options.element, {
    theme: undefined,
    formats: [...RICH_TEXT_FORMATS],
    // Quill only writes data-placeholder when truthy; empty string keeps blank.
    placeholder,
  });
  const scrollContainer = options.scrollContainer ?? options.element;
  const nativeScrollRectIntoView = quill.scrollRectIntoView.bind(quill);
  const scrollSelectionIntoEditor = (bounds: ScrollRect): void => {
    scrollRectWithinContainer(scrollContainer, bounds);
  };

  // Quill's focus, keyboard, clipboard, and non-SILENT selection paths all
  // call this method internally. Route that single seam through the explicit
  // owner so a future Quill call cannot reintroduce document scrolling.
  quill.scrollRectIntoView = (bounds) => {
    scrollSelectionIntoEditor(bounds);
  };
  let snapshotMetadata: Omit<RichTextSnapshotV1, "content"> = {};
  const listeners = new Set<(event: EditorAdapterEvent) => void>();
  let stateBatchDepth = 0;
  let stateEmissionVersion = 0;
  /** Last non-null selection — kept across blur so accessory inserts (emoji) can run without refocusing IME. */
  let lastSelection: { start: number; end: number } | null = null;
  const emit = (event: EditorAdapterEvent): void => {
    for (const listener of listeners) {
      listener(event);
    }
  };

  /**
   * Last selection forwarded to the host. Consecutive identical emissions are
   * coalesced: Quill reports the same caret through two channels —
   * editor-change for SILENT moves and selection-change for explicit moves —
   * and several adapter inserts emit the caret they computed themselves.
   */
  let lastEmittedSelection: { start: number; end: number } | null = null;
  let lastEmittedFocus = quill.hasFocus();

  const emitSelectionChange = (selection: { start: number; end: number } | null): void => {
    if (suppressHostSelectionSync > 0) return;
    const same =
      (lastEmittedSelection?.start ?? -1) === (selection?.start ?? -1) &&
      (lastEmittedSelection?.end ?? -1) === (selection?.end ?? -1);
    if (same) return;
    lastEmittedSelection = selection;
    emit({ type: "selection-change", selection });
  };

  const emitFocusTransition = (): void => {
    if (suppressHostSelectionSync > 0) return;
    const current = quill.hasFocus();
    if (current === lastEmittedFocus) return;
    lastEmittedFocus = current;
    emit({ type: current ? "focus" : "blur" });
  };

  /**
   * While > 0, SILENT-source caret moves observed via editor-change are NOT
   * forwarded to the host. Adapter-initiated operations (format-preserving
   * focus swaps, snapshot restore) must not leak caret changes — they either
   * emit their own selection-change or intentionally stay silent.
   */
  let suppressHostSelectionSync = 0;

  const runWithSuppressedSelectionSync = <Result>(operation: () => Result): Result => {
    suppressHostSelectionSync += 1;
    try {
      return operation();
    } finally {
      suppressHostSelectionSync -= 1;
    }
  };

  const readState = (): EditorState => {
    const focused = quill.hasFocus();
    const range = focused ? quill.getSelection() : null;
    const formatRange = range ?? resolveRangeWithoutFocus();
    const formats = formatRange ? quill.getFormat(formatRange.index, formatRange.length) : {};

    return {
      focused,
      selection: range
        ? {
            start: range.index,
            end: range.index + range.length,
          }
        : null,
      canUndo: quill.history.stack.undo.length > 0,
      canRedo: quill.history.stack.redo.length > 0,
      formats: {
        bold: formats.bold === true,
        italic: formats.italic === true,
        underline: formats.underline === true,
        strike: formats.strike === true,
        header: readHeaderFormat(formats.header),
        list: readListFormat(formats.list),
        blockquote: formats.blockquote === true,
      },
    };
  };

  const emitState = (): void => {
    if (stateBatchDepth === 0) {
      stateEmissionVersion += 1;
      emit({ type: "state-change", state: readState() });
    }
  };

  const scheduleState = (): void => {
    if (stateBatchDepth > 0) {
      return;
    }

    const scheduledVersion = ++stateEmissionVersion;

    queueMicrotask(() => {
      if (scheduledVersion === stateEmissionVersion && stateBatchDepth === 0) {
        emit({ type: "state-change", state: readState() });
      }
    });
  };

  const runWithFinalState = <Result>(operation: () => Result): Result => {
    stateBatchDepth += 1;

    try {
      return operation();
    } finally {
      stateBatchDepth -= 1;

      emitState();
    }
  };

  /** Keep adapter + Quill restore targets aligned across blur/accessory inserts. */
  const rememberSelection = (start: number, end: number): void => {
    lastSelection = { start, end };
    const saved = quill.selection.savedRange;
    // Quill normally keeps savedRange populated; guard so toolbar inserts never
    // throw command_failed when the Selection object is in a transitional state.
    if (saved) {
      saved.index = start;
      saved.length = Math.max(0, end - start);
    }
  };

  /**
   * Keep the caret inside the body scrollport after typing, Enter, and SILENT
   * inserts (toolbar emoji / mention / link / divider). Quill skips scroll for
   * SILENT selection updates, and getBounds() returns null on empty lines
   * (common after Enter) so we fall back to the line blot rect.
   *
   * Double rAF waits for layout after content changes so scrollTop uses the
   * post-insert caret geometry. Coalesced so rapid keystrokes share one pass.
   */
  let ensureVisibleFrame = 0;
  const resolveSelectionBounds = (
    start: number,
    end: number,
  ): { top: number; bottom: number; left: number; right: number } | null => {
    const length = Math.max(0, end - start);
    const bounds = quill.selection.getBounds(start, length);
    if (bounds) {
      return bounds;
    }

    // Empty text nodes (new blank lines) cannot produce a client rect via getBounds.
    // Fall back to line blot getBoundingClientRect() (viewport coordinates).
    try {
      const [line] = quill.getLine(start);
      const node = line?.domNode;
      if (node instanceof HTMLElement) {
        const rect = node.getBoundingClientRect();
        if (Number.isFinite(rect.top) && Number.isFinite(rect.bottom)) {
          return {
            top: rect.top,
            bottom: rect.bottom,
            left: rect.left,
            right: rect.right,
          };
        }
      }
    } catch {
      // ignore — scroll is best-effort
    }

    return null;
  };

  const ensureSelectionVisible = (): void => {
    cancelAnimationFrame(ensureVisibleFrame);
    ensureVisibleFrame = requestAnimationFrame(() => {
      ensureVisibleFrame = requestAnimationFrame(() => {
        const live = quill.getSelection();
        const selection = live
          ? { start: live.index, end: live.index + live.length }
          : lastSelection;
        if (!selection) return;

        const bounds = resolveSelectionBounds(selection.start, selection.end);
        if (bounds) {
          scrollSelectionIntoEditor(bounds);
        }
      });
    });
  };

  const handleTextChange = (): void => {
    emit({ type: "change" });
    scheduleState();
    // Typing / Enter / paste: keep caret in the body scrollport. Selection may
    // still be mid-update on this tick; ensureSelectionVisible re-reads live
    // range after double rAF.
    if (quill.hasFocus()) {
      ensureSelectionVisible();
    }
  };

  const handleSelectionChange = (range: Range | null, _oldRange: Range | null): void => {
    if (range) {
      rememberSelection(range.index, range.index + range.length);
    }

    if (suppressHostSelectionSync === 0) {
      emitSelectionChange(
        range
          ? {
              start: range.index,
              end: range.index + range.length,
            }
          : null,
      );

      emitFocusTransition();
    }

    if (quill.hasFocus()) {
      ensureSelectionVisible();
    }

    emitState();
  };

  /**
   * Typing advances the caret with Emitter.sources.SILENT, which skips
   * selection-change listeners. editor-change still receives those updates:
   * keep lastSelection aligned so blurred emoji inserts land at the real
   * caret, AND forward the caret to the host so Flutter never inserts at a
   * stale position (mention/emoji/toolbar triggers). Adapter-initiated silent
   * operations opt out via runWithSuppressedSelectionSync.
   */
  const handleEditorChange = (eventName: string, range: Range | null): void => {
    if (eventName === "selection-change" && range) {
      const selection = {
        start: range.index,
        end: range.index + range.length,
      };
      lastSelection = selection;
      if (suppressHostSelectionSync === 0) {
        emitSelectionChange(selection);
        // SILENT caret moves (typing / Enter) never hit handleSelectionChange;
        // scroll here so the body scrollport follows the caret.
        if (quill.hasFocus()) {
          ensureSelectionVisible();
        }
      }
    }
  };

  quill.on("text-change", handleTextChange);
  quill.on("selection-change", handleSelectionChange);
  quill.on("editor-change", handleEditorChange);

  const emojiRegistry = options.emojiRegistry;
  const emojiObserver = emojiRegistry ? createEmojiObserver(quill.root, emojiRegistry) : undefined;

  if (emojiRegistry) {
    hydrateEmojiNodes(quill.root, emojiRegistry);
  }

  /**
   * Resolve a range without focusing the editor.
   * Matches Flutter Quill's `skipRequestKeyboard` for emoji: keep the accessory
   * panel open and avoid popping the system IME on each insert.
   */
  const resolveRangeWithoutFocus = (): Range | null => {
    const active = quill.getSelection();

    if (lastSelection) {
      const length = Math.max(0, quill.getLength() - 1);
      const start = Math.min(Math.max(0, lastSelection.start), length);
      const end = Math.min(Math.max(start, lastSelection.end), length);
      const remembered: Range = { index: start, length: end - start };

      if (!active) {
        return remembered;
      }

      const activeEnd = active.index + active.length;
      if (start !== active.index || end !== activeEnd) {
        // Silent typing advances lastSelection via editor-change while getSelection
        // stays stale until an explicit selection-change event fires.
        return remembered;
      }
    }

    if (active) {
      return active;
    }

    return null;
  };

  /**
   * Run a selection-based format command without changing the editor's focus.
   * Quill requires a native range for collapsed inline formats, so a blurred
   * editor gets a silent temporary range while root focus is suppressed.
   */
  const formatPreservingFocus = (operation: (range: Range) => void): void => {
    if (quill.hasFocus()) {
      // Toolbar taps (esp. macOS WKWebView) can leave hasFocus() true while
      // getSelection() is briefly null — never pass null into format ops.
      const range = quill.getSelection(true) ?? resolveRangeWithoutFocus();
      if (!range) {
        return;
      }
      operation(range);
      // Block blot replacement (p → h1/h2/h3) can drop or relocate the native caret
      // in Chrome while quill.hasFocus() stays true — pin the pre-op range back.
      const bound = Math.max(0, quill.getLength() - 1);
      const index = Math.min(range.index, bound);
      const length = Math.min(range.length, Math.max(0, bound - index));
      quill.setSelection(index, length, Quill.sources.SILENT);
      rememberSelection(index, index + length);
      return;
    }

    const range = resolveRangeWithoutFocus();

    if (!range) {
      return;
    }

    const root = quill.root;
    const nativeFocus = root.focus.bind(root);
    root.focus = () => {
      /* formatting from the accessory panel must not take IME focus */
    };

    runWithSuppressedSelectionSync(() => {
      try {
        // Quill's selection restoration can call root.focus() from inside
        // setNativeRange(). Keep the root non-editable for the whole format
        // operation so iOS does not promote the WebView back to an IME host.
        quill.disable();
        quill.editReadOnly(() => {
          quill.setSelection(range.index, range.length, Quill.sources.SILENT);
          operation(range);
        });
        quill.blur();
      } finally {
        try {
          rememberSelection(range.index, range.index + range.length);
          document.getSelection()?.removeAllRanges();
        } finally {
          root.focus = nativeFocus;
          quill.enable();
          if (quill.hasFocus()) {
            quill.blur();
          }
        }
      }
    });
  };

  const resolveInsertRange = (
    selection: { start: number; end: number } | undefined,
  ): { start: number; end: number } | undefined => {
    if (selection) {
      return selection;
    }

    const resolved = resolveRangeWithoutFocus();
    if (!resolved) {
      return undefined;
    }

    return { start: resolved.index, end: resolved.index + resolved.length };
  };

  const insertEmoji = (id: string): void => {
    if (id.trim().length === 0) {
      throw new Error("Emoji id must be a non-empty string.");
    }

    runWithFinalState(() => {
      const range = resolveRangeWithoutFocus();

      if (!range) {
        return;
      }

      const wasFocused = quill.hasFocus();
      const update = new Delta().retain(range.index).delete(range.length).insert({ emoji: { id } });
      const nextIndex = range.index + 1;

      const applyInsert = (): void => {
        quill.updateContents(update, Quill.sources.USER);
        rememberSelection(nextIndex, nextIndex);

        if (wasFocused) {
          quill.setSelection(nextIndex, 0, Quill.sources.SILENT);
        }

        emitSelectionChange({
          start: nextIndex,
          end: nextIndex,
        });

        if (emojiRegistry) {
          hydrateEmojiNodes(quill.root, emojiRegistry);
        }

        ensureSelectionVisible();
      };

      if (wasFocused) {
        applyInsert();
        return;
      }

      // Quill embed/selection restore calls root.focus() via setNativeRange, which
      // pops the host IME. Mirror Flutter Quill's skipRequestKeyboard: keep the
      // editor non-editable and swallow focus for the duration of the insert.
      const root = quill.root;
      const nativeFocus = root.focus.bind(root);
      root.focus = () => {
        /* accessory insert must not take IME focus */
      };

      try {
        quill.disable();
        quill.editReadOnly(applyInsert);
        quill.blur();
      } finally {
        root.focus = nativeFocus;
        quill.enable();
        if (quill.hasFocus()) {
          quill.blur();
        }
      }
    });
  };

  const insertEmbed = (
    value: { mention: MentionInsert } | { channel: ChannelInsert },
    selection: { start: number; end: number } | undefined,
    suffix = "",
  ): void => {
    runWithFinalState(() => {
      const range = resolveInsertRange(selection);

      if (!range) {
        return;
      }

      // Host embeds (mention/channel from Flutter overlays)
      // must never call setSelection / root.focus here. On macOS, Quill can still
      // report hasFocus() while AppKit firstResponder is the Flutter overlay; a
      // setNativeRange focus fight leaves WKWebView dead to later clicks.
      // Remember the caret and let the host refocus after the overlay closes.
      const wasFocused = quill.hasFocus();
      const update = new Delta()
        .retain(range.start)
        .delete(range.end - range.start)
        .insert(value)
        .insert(suffix);
      const nextIndex = range.start + 1 + suffix.length;

      const applyInsert = (): void => {
        quill.updateContents(update, Quill.sources.USER);
        rememberSelection(nextIndex, nextIndex);
        emitSelectionChange({ start: nextIndex, end: nextIndex });
      };

      const root = quill.root;
      const nativeFocus = root.focus.bind(root);
      root.focus = () => {
        /* host embed insert must not take AppKit / IME focus */
      };

      try {
        if (wasFocused) {
          applyInsert();
        } else {
          quill.disable();
          quill.editReadOnly(applyInsert);
          quill.blur();
        }
      } finally {
        root.focus = nativeFocus;
        if (!wasFocused) {
          quill.enable();
          if (quill.hasFocus()) {
            quill.blur();
          }
        } else if (quill.hasFocus()) {
          // Drop any native range Quill restored during updateContents so the
          // host can reclaim firstResponder cleanly after the overlay closes.
          quill.blur();
        }
        // Scroll before host refocus: mention/channel never call setSelection
        // (SILENT scroll path), and post-insert blur clears lastRange.
        ensureSelectionVisible();
      }
    });
  };

  const insertMention = (
    mention: MentionInsert,
    selection?: { start: number; end: number },
  ): void => {
    insertEmbed({ mention }, selection, " ");
  };

  const insertChannel = (
    channel: ChannelInsert,
    selection?: { start: number; end: number },
  ): void => {
    insertEmbed({ channel }, selection, " ");
  };

  const insertBlockMedia = (
    blotName: "image" | "video",
    value: ImageInsert | VideoInsert,
    selection: { start: number; end: number } | undefined,
  ): void => {
    runWithFinalState(() => {
      const range = resolveInsertRange(selection);

      if (!range) {
        return;
      }

      // BlockEmbed media must use insertEmbed — a plain Delta insert can leave
      // the native selection at document start in WebViews. Match Flutter Quill
      // `newLine: true`: caret on the empty line after the media.
      // Media comes from pickers: never steal AppKit / IME focus here; remember
      // the caret and let the host refocus after the picker closes.
      const wasFocused = quill.hasFocus();

      const applyInsert = (): void => {
        if (range.end > range.start) {
          quill.deleteText(range.start, range.end - range.start, Quill.sources.USER);
        }

        quill.insertEmbed(range.start, blotName, value, Quill.sources.USER);

        const nextIndex = Math.min(range.start + 2, Math.max(0, quill.getLength() - 1));
        rememberSelection(nextIndex, nextIndex);
        emitSelectionChange({ start: nextIndex, end: nextIndex });
      };

      const root = quill.root;
      const nativeFocus = root.focus.bind(root);
      root.focus = () => {
        /* host media insert must not take AppKit / IME focus */
      };

      try {
        if (wasFocused) {
          applyInsert();
        } else {
          quill.disable();
          quill.editReadOnly(applyInsert);
          quill.blur();
        }
      } finally {
        root.focus = nativeFocus;
        if (!wasFocused) {
          quill.enable();
          if (quill.hasFocus()) {
            quill.blur();
          }
        } else if (quill.hasFocus()) {
          quill.blur();
        }
        // Media embeds also restore through a SILENT selection after their
        // picker closes, so make the remembered next line visible explicitly.
        ensureSelectionVisible();
      }
    });
  };

  const insertImage = (image: ImageInsert, selection?: { start: number; end: number }): void => {
    insertBlockMedia("image", image, selection);
  };

  const insertVideo = (video: VideoInsert, selection?: { start: number; end: number }): void => {
    insertBlockMedia("video", video, selection);
  };

  const insertLink = (link: LinkInsert, selection?: { start: number; end: number }): void => {
    runWithFinalState(() => {
      const range = resolveInsertRange(selection);

      if (!range) {
        return;
      }

      const update = new Delta()
        .retain(range.start)
        .delete(range.end - range.start)
        .insert(link.text, { link: link.url });

      quill.updateContents(update, Quill.sources.USER);
      const nextIndex = range.start + link.text.length;
      rememberSelection(nextIndex, nextIndex);
      // SILENT skips Quill's built-in scrollSelectionIntoView.
      quill.setSelection(nextIndex, 0, Quill.sources.SILENT);
      emitSelectionChange({ start: nextIndex, end: nextIndex });
      ensureSelectionVisible();
    });
  };

  const insertDivider = (selection?: { start: number; end: number }): void => {
    runWithFinalState(() => {
      const range = resolveInsertRange(selection);

      if (!range) {
        return;
      }

      // BlockEmbed horizontal rules must use insertEmbed — a plain Delta insert
      // can leave the native selection at document start in WebViews.
      if (range.end > range.start) {
        quill.deleteText(range.start, range.end - range.start, Quill.sources.USER);
      }

      quill.insertEmbed(range.start, "divider", "true", Quill.sources.USER);

      // Match Flutter Quill `lineBreak: true`: caret on the empty line after the rule.
      const nextIndex = Math.min(range.start + 2, Math.max(0, quill.getLength() - 1));
      rememberSelection(nextIndex, nextIndex);
      // SILENT skips Quill's built-in scrollSelectionIntoView.
      quill.setSelection(nextIndex, 0, Quill.sources.SILENT);
      emitSelectionChange({ start: nextIndex, end: nextIndex });
      ensureSelectionVisible();
    });
  };

  const execute = (command: EditorCommand): void => {
    switch (command.type) {
      case "toggle-inline-format":
        runWithFinalState(() => {
          formatPreservingFocus((range) => {
            const formats = quill.getFormat(range.index, range.length);
            quill.format(command.format, !formats[command.format], Quill.sources.USER);
          });
        });
        return;

      case "toggle-block-format":
        runWithFinalState(() => {
          formatPreservingFocus((range) => {
            const formats = quill.getFormat(range.index, range.length);
            let value: HeaderLevel | ListType | boolean;

            switch (command.format) {
              case "header":
                value = readHeaderFormat(formats.header) === command.value ? false : command.value;
                break;

              case "list":
                value = readListFormat(formats.list) === command.value ? false : command.value;
                break;

              case "blockquote":
                value = formats.blockquote !== true;
            }

            quill.formatLine(
              range.index,
              Math.max(range.length, 1),
              command.format,
              value,
              Quill.sources.USER,
            );
          });
        });
        return;

      case "insert-emoji":
        insertEmoji(command.id);
        return;

      case "insert-mention":
        insertMention(command.mention, command.selection);
        return;

      case "insert-channel":
        insertChannel(command.channel, command.selection);
        return;

      case "insert-image":
        insertImage(command.image, command.selection);
        return;

      case "insert-video":
        insertVideo(command.video, command.selection);
        return;

      case "insert-link":
        insertLink(command.link, command.selection);
        return;

      case "insert-divider":
        insertDivider(command.selection);
        return;

      case "indent":
        runWithFinalState(() => {
          formatPreservingFocus((range) => {
            const length = Math.max(range.length, 1);
            const formats = quill.getFormat(range.index, length);
            const current = typeof formats.indent === "number" ? formats.indent : 0;
            // Shared selection already at max → no-op (avoids Quill default indent-6+ jump).
            if (current >= MAX_INDENT_LEVEL) {
              return;
            }
            quill.formatLine(range.index, length, "indent", "+1", Quill.sources.USER);
          });
        });
        return;

      case "outdent":
        runWithFinalState(() => {
          formatPreservingFocus((range) => {
            quill.formatLine(
              range.index,
              Math.max(range.length, 1),
              "indent",
              "-1",
              Quill.sources.USER,
            );
          });
        });
        return;

      case "undo":
        runWithFinalState(() => {
          quill.history.undo();
        });
        return;

      case "redo":
        runWithFinalState(() => {
          quill.history.redo();
        });
        return;

      default:
        command satisfies never;
    }
  };

  return {
    getSnapshot() {
      // Convert + normalize must not throw: a single invalid op (e.g. a link
      // Quill rewrote to about:blank, or an unrecognized embed) used to make
      // every get_snapshot / change-event fail with protocol command_failed.
      // converters already drop illegal attributes / unknown embeds.
      try {
        const snapshot = normalizeSnapshot({
          ...snapshotMetadata,
          content: quillDeltaToSnapshot(quill.getContents()).content,
        });
        assertValidSnapshot(snapshot);
        return snapshot;
      } catch {
        // Last-resort recovery: keep metadata, emit a blank document so the
        // host can still open link/send UI instead of hanging on command_failed.
        const fallback = normalizeSnapshot({
          ...snapshotMetadata,
          content: [{ insert: "\n" }],
        });
        assertValidSnapshot(fallback);
        return fallback;
      }
    },

    setSnapshot(snapshot) {
      assertValidSnapshot(snapshot);
      const { content: _content, ...metadata } = snapshot;
      snapshotMetadata = metadata;

      // Snapshot restore must not leak the caret Quill computes during
      // setContents — the host drives selection explicitly afterwards.
      runWithSuppressedSelectionSync(() => {
        quill.setContents(snapshotToQuillDelta(snapshot).ops, "silent");
      });
      quill.history.clear();

      if (emojiRegistry) {
        hydrateEmojiNodes(quill.root, emojiRegistry);
      }

      emit({ type: "change" });
      emitState();
    },

    setTitle(title) {
      snapshotMetadata = { ...snapshotMetadata, title };
      emit({ type: "change" });
    },

    insertEmoji,
    insertMention,
    insertChannel,
    insertImage,
    insertVideo,
    insertLink,
    insertDivider,

    getSelection() {
      return readState().selection;
    },

    getCaretRect(): CaretRect | null {
      const range = resolveRangeWithoutFocus();

      if (!range) {
        return null;
      }

      // selection.getBounds is viewport-relative; quill.getBounds is container-relative.
      const bounds = quill.selection.getBounds(range.index, 0);

      if (!bounds) {
        return null;
      }

      const x = bounds.left;
      const y = bounds.top;
      const width = bounds.width;
      const height = bounds.height;

      if (
        !Number.isFinite(x) ||
        !Number.isFinite(y) ||
        !Number.isFinite(width) ||
        !Number.isFinite(height)
      ) {
        return null;
      }

      return {
        x,
        y,
        width: Math.max(0, width),
        height: Math.max(0, height),
      };
    },

    setSelection(selection) {
      rememberSelection(selection.start, selection.end);
      quill.setSelection(selection.start, selection.end - selection.start, Quill.sources.SILENT);
      const range = quill.getSelection();
      const actualSelection = range
        ? {
            start: range.index,
            end: range.index + range.length,
          }
        : null;

      if (actualSelection) {
        rememberSelection(actualSelection.start, actualSelection.end);
      }

      emitSelectionChange(actualSelection);
      emitFocusTransition();
      emitState();
    },

    getState: readState,

    focus() {
      const targetSelection = lastSelection;
      const live = quill.getSelection();

      runWithFinalState(() => {
        if (!(quill.hasFocus() && live)) {
          runWithSuppressedSelectionSync(() => {
            quill.focus({ preventScroll: true });
          });
        }

        // Plain focus() can collapse the caret (common after toolbar → protocol focus).
        // Restore targetSelection from before native focus clobbered it, else live, else lastSelection.
        const restore =
          targetSelection ??
          (live ? { start: live.index, end: live.index + live.length } : lastSelection);
        if (restore) {
          const bound = Math.max(0, quill.getLength() - 1);
          const start = Math.min(Math.max(0, restore.start), bound);
          const end = Math.min(Math.max(start, restore.end), bound);
          quill.setSelection(start, end - start, Quill.sources.SILENT);
          rememberSelection(start, end);
          emitSelectionChange({ start, end });
        }

        emitFocusTransition();
      });

      // Host refocus after divider/mention/channel: SILENT restore does not scroll.
      ensureSelectionVisible();
    },

    blur() {
      quill.blur();
    },

    execute,

    subscribe(listener) {
      listeners.add(listener);

      return () => {
        listeners.delete(listener);
      };
    },

    destroy() {
      stateEmissionVersion += 1;
      cancelAnimationFrame(ensureVisibleFrame);
      quill.off("text-change", handleTextChange);
      quill.off("selection-change", handleSelectionChange);
      quill.off("editor-change", handleEditorChange);
      quill.scrollRectIntoView = nativeScrollRectIntoView;
      listeners.clear();
      emojiObserver?.disconnect();
      options.element.innerHTML = "";
    },
  };
}

function readHeaderFormat(value: unknown): HeaderLevel | false {
  return value === 1 || value === 2 || value === 3 ? value : false;
}

function readListFormat(value: unknown): ListType | false {
  return value === "ordered" || value === "bullet" ? value : false;
}

function createEmojiObserver(
  root: HTMLElement,
  registry: NonNullable<QuillAdapterOptions["emojiRegistry"]>,
): MutationObserver | undefined {
  const MutationObserverConstructor = root.ownerDocument.defaultView?.MutationObserver;

  if (!MutationObserverConstructor) {
    return undefined;
  }

  const observer = new MutationObserverConstructor(() => {
    hydrateEmojiNodes(root, registry);
  });

  observer.observe(root, {
    childList: true,
    subtree: true,
  });

  return observer;
}
