import { createEffect, createSignal, onCleanup, type JSX } from "solid-js";
import { render } from "solid-js/web";
import type { ChannelInsert, MentionInsert } from "@teamgaga/richtext-core";
import {
  createRichTextEditor,
  LinkPopoverHost,
  type LinkPopoverController,
  RichTextEditor,
  RichTextProvider,
  useRichText,
} from "@teamgaga/richtext-solid";
import { RichTextToolbar } from "@teamgaga/richtext-solid-toolbar";
import { MockInsertPicker } from "./components/MockInsertPicker";
import { createPlaygroundEmojiRegistry } from "./data/emojis";
import "../../webview-runtime/src/theme.css";
import "../../webview-runtime/src/style.css";
import "@teamgaga/richtext-solid/style.css";
import "./style.css";

type ThemeMode = "light" | "dark" | "system";

const THEME_STORAGE_KEY = "tg-playground-theme";

function getInitialTheme(): ThemeMode {
  if (typeof window === "undefined") return "system";
  const saved = localStorage.getItem(THEME_STORAGE_KEY);
  if (saved === "light" || saved === "dark" || saved === "system") {
    return saved;
  }
  return "system";
}

function ThemeSwitcher(props: {
  theme: () => ThemeMode;
  onThemeChange: (mode: ThemeMode) => void;
}): JSX.Element {
  return (
    <div class="theme-switcher" role="radiogroup" aria-label="Theme mode">
      <button
        type="button"
        class="theme-btn"
        classList={{ "is-active": props.theme() === "light" }}
        onClick={() => props.onThemeChange("light")}
        title="Light mode"
        aria-label="Light mode"
      >
        <svg
          width="15"
          height="15"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <circle cx="12" cy="12" r="5" />
          <line x1="12" y1="1" x2="12" y2="3" />
          <line x1="12" y1="21" x2="12" y2="23" />
          <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
          <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
          <line x1="1" y1="12" x2="3" y2="12" />
          <line x1="21" y1="12" x2="23" y2="12" />
          <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
          <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
        </svg>
        <span>Light</span>
      </button>
      <button
        type="button"
        class="theme-btn"
        classList={{ "is-active": props.theme() === "dark" }}
        onClick={() => props.onThemeChange("dark")}
        title="Dark mode"
        aria-label="Dark mode"
      >
        <svg
          width="15"
          height="15"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
        </svg>
        <span>Dark</span>
      </button>
      <button
        type="button"
        class="theme-btn"
        classList={{ "is-active": props.theme() === "system" }}
        onClick={() => props.onThemeChange("system")}
        title="System mode"
        aria-label="System mode"
      >
        <svg
          width="15"
          height="15"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
          <line x1="8" y1="21" x2="16" y2="21" />
          <line x1="12" y1="17" x2="12" y2="21" />
        </svg>
        <span>System</span>
      </button>
    </div>
  );
}

function SnapshotDebug(): JSX.Element {
  const controller = useRichText();
  let output: HTMLPreElement | undefined;

  createEffect(() => {
    const editor = controller.editor();

    if (!editor || !output) {
      return;
    }

    const update = (): void => {
      output!.textContent = JSON.stringify(editor.getSnapshot(), null, 2);
    };

    update();
    onCleanup(editor.on("change", update));
  });

  return (
    <pre
      class="snapshot"
      ref={(element) => {
        output = element;
      }}
      aria-label="Rich text snapshot"
    />
  );
}

function App(): JSX.Element {
  const editor = createRichTextEditor({
    emojiRegistry: createPlaygroundEmojiRegistry(),
  });
  let linkController: LinkPopoverController | undefined;
  const [themeMode, setThemeMode] = createSignal<ThemeMode>(getInitialTheme());
  const [pickerState, setPickerState] = createSignal<{
    isOpen: boolean;
    type: "mention" | "channel" | "emoji" | null;
    selection: { start: number; end: number } | null;
  }>({
    isOpen: false,
    type: null,
    selection: null,
  });

  const handleOpenEmojiPicker = (selection: { start: number; end: number } | null): void => {
    setPickerState({
      isOpen: true,
      type: "emoji",
      selection,
    });
  };

  const handleOpenMentionPicker = (selection: { start: number; end: number } | null): void => {
    setPickerState({
      isOpen: true,
      type: "mention",
      selection,
    });
  };

  const handleOpenChannelPicker = (selection: { start: number; end: number } | null): void => {
    setPickerState({
      isOpen: true,
      type: "channel",
      selection,
    });
  };

  const handleClosePicker = (): void => {
    setPickerState({
      isOpen: false,
      type: null,
      selection: null,
    });
  };

  const handleSelectEmoji = (emojiId: string): void => {
    const currentEditor = editor.editor();
    if (currentEditor) {
      currentEditor.commands.insertEmoji(emojiId);
      currentEditor.focus();
    }
    handleClosePicker();
  };

  const handleSelectMention = (mention: MentionInsert): void => {
    const currentEditor = editor.editor();
    const sel = pickerState().selection;
    if (currentEditor) {
      currentEditor.commands.insertMention(mention, sel ?? undefined);
      currentEditor.focus();
    }
    handleClosePicker();
  };

  const handleSelectChannel = (channel: ChannelInsert): void => {
    const currentEditor = editor.editor();
    const sel = pickerState().selection;
    if (currentEditor) {
      currentEditor.commands.insertChannel(channel, sel ?? undefined);
      currentEditor.focus();
    }
    handleClosePicker();
  };

  createEffect(() => {
    const mode = themeMode();
    localStorage.setItem(THEME_STORAGE_KEY, mode);

    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");

    const applyTheme = (): void => {
      const isDark = mode === "dark" || (mode === "system" && mediaQuery.matches);
      const root = document.documentElement;

      root.classList.remove("tg-theme-dark", "tg-theme-light", "dark");
      if (isDark) {
        root.classList.add("tg-theme-dark", "dark");
        root.dataset.theme = "dark";
        root.style.colorScheme = "dark";
      } else {
        root.classList.add("tg-theme-light");
        root.dataset.theme = "light";
        root.style.colorScheme = "light";
      }
    };

    applyTheme();

    mediaQuery.addEventListener("change", applyTheme);
    onCleanup(() => {
      mediaQuery.removeEventListener("change", applyTheme);
    });
  });

  return (
    <main class="page">
      <header class="page-header">
        <div class="page-header__content">
          <p class="eyebrow">@teamgaga/richtext-solid-toolbar</p>
          <h1>RichText Toolbar Playground</h1>
          <p>Select text or place the caret in a line, then use the Core-driven toolbar.</p>
        </div>
        <ThemeSwitcher theme={themeMode} onThemeChange={setThemeMode} />
      </header>

      <RichTextProvider editor={editor}>
        <section class="editor-shell tg-webview-editor-root tg-webview-editor-root--desktop">
          <RichTextToolbar
            class="toolbar tg-webview-toolbar"
            aria-label="Rich text formatting"
            visibleInsertActions={["emoji", "mention", "channel", "image"]}
            onRequestEmoji={handleOpenEmojiPicker}
            onRequestMention={handleOpenMentionPicker}
            onRequestChannel={handleOpenChannelPicker}
            onRequestImage={(selection) => console.log("request_image", selection)}
            onOpenLinkForm={() => linkController?.open()}
          />
          <RichTextEditor class="editor" aria-label="Rich text editor" />
          <LinkPopoverHost
            editor={() => editor.editor()}
            onControllerReady={(controller) => {
              linkController = controller;
            }}
          />
          <MockInsertPicker
            isOpen={pickerState().isOpen}
            type={pickerState().type}
            onClose={handleClosePicker}
            onSelectMention={handleSelectMention}
            onSelectChannel={handleSelectChannel}
            onSelectEmoji={handleSelectEmoji}
          />
        </section>

        <section class="snapshot-section">
          <h2>Snapshot</h2>
          <SnapshotDebug />
        </section>
      </RichTextProvider>
    </main>
  );
}

const root = document.querySelector<HTMLDivElement>("#app");

if (!root) {
  throw new Error("Playground root was not found.");
}

render(() => <App />, root);
