import {
  createRichTextHost,
  type CreateRichTextHostOptions,
  type HostControlOperation,
  type HostTransport,
} from "@teamgaga/richtext-host-web";
import type { RichTextEditor } from "@teamgaga/richtext-core";
import {
  encodeProtocolMessage,
  PROTOCOL_VERSION,
  type EditorEventMessage,
} from "@teamgaga/richtext-protocol";
import {
  createSolidAdapterFactory,
  LinkPopoverHost,
  setMediaMaxSize,
  setMediaUriResolver,
  type LinkPopoverController,
} from "@teamgaga/richtext-solid";
import { createSignal, type Accessor, type JSX } from "solid-js";
import { render } from "solid-js/web";
/* Quill core first; solid editor.css overrides list positioning for CJK IME. */
import "quill/dist/quill.core.css";
import "@teamgaga/richtext-solid/style.css";
import "./style.css";
import { resolveEmojiRegistry } from "./emoji-registry";
import type { RuntimeConfig } from "./runtime-config";
import { createTitleInput, type TitleInputHandle } from "./title-input";
import {
  applyMediaHostControl,
  clearMediaRegistrations,
  resolveRegisteredMediaUri,
} from "./media-registry";
import { observeQuoteGroupBoundaries } from "./quote-boundaries";

export interface MountEditorOptions {
  config: RuntimeConfig;
  transport: HostTransport;
  /** Optional host-control handler (MessagePort plane). */
  onHostControl?: (operation: HostControlOperation) => void;
}

export interface MountedEditor {
  destroy(): void;
  wakeEditingSession(options?: { keepTitle?: boolean }): void;
  applyHostControl(operation: HostControlOperation): void;
}

function showFatalError(app: HTMLElement, message: string): void {
  app.replaceChildren();
  const container = document.createElement("div");
  container.className = "tg-webview-error";
  container.setAttribute("role", "alert");

  const title = document.createElement("strong");
  title.textContent = "Rich text host failed to start";
  const detail = document.createElement("span");
  detail.textContent = message;
  container.append(title, detail);
  app.append(container);
}

function prepareShell(
  app: HTMLElement,
  config: RuntimeConfig,
  titleFocusHandlers: {
    onFocus: () => void;
    onBlur: () => void;
    onEnter: () => void;
  },
): {
  editorRoot: HTMLElement;
  titleInput?: TitleInputHandle;
  titleWrap?: HTMLElement;
} {
  app.replaceChildren();
  app.classList.add("tg-webview-root");
  // Platform class from runtime config (ADR 0002): toolbarMode owns the
  // platform — desktop surfaces run In-Web Desktop Chrome, mobile is
  // editor-only. Independent of title visibility.
  app.classList.remove("tg-webview-layout-desktop", "tg-webview-layout-mobile");
  app.classList.add(
    config.toolbarMode === "desktop" ? "tg-webview-layout-desktop" : "tg-webview-layout-mobile",
  );

  const root = document.documentElement;
  root.classList.remove("tg-theme-dark", "tg-theme-light");
  root.classList.add(config.theme === "dark" ? "tg-theme-dark" : "tg-theme-light");
  if (config.theme) {
    app.dataset.theme = config.theme;
  }
  if (config.locale) {
    app.lang = config.locale;
  }

  if (import.meta.env.DEV) {
    const hint = document.createElement("div");
    hint.className = "tg-webview-dev-hint";
    hint.innerHTML =
      "<strong>Dev editor</strong> — click the white area below and type. " +
      "Console should log <code>→ outbound change</code> / <code>state_change</code>. " +
      `toolbarMode=<code>${config.toolbarMode}</code>. ` +
      `showTitleInput=<code>${Boolean(config.showTitleInput)}</code>. ` +
      "This banner is development-only.";
    app.append(hint);
  }

  let titleInput: TitleInputHandle | undefined;
  let titleWrap: HTMLElement | undefined;

  if (config.showTitleInput) {
    titleWrap = document.createElement("div");
    titleWrap.className = "tg-webview-title-wrap";
    titleInput = createTitleInput({
      placeholder: config.titlePlaceholder ?? "Enter a title",
      onFocus: titleFocusHandlers.onFocus,
      onBlur: titleFocusHandlers.onBlur,
      onEnter: titleFocusHandlers.onEnter,
    });
    titleWrap.append(titleInput.element);
    // Do not append to app here — HostApp mounts title between chrome and body
    // so order stays: toolbar → title → editor.
  }

  const editorRoot = document.createElement("div");
  editorRoot.id = "editor-root";
  editorRoot.className = "tg-webview-editor-root";
  if (config.toolbarMode === "desktop") {
    editorRoot.classList.add("tg-webview-editor-root--desktop");
  }
  if (config.showTitleInput) {
    editorRoot.classList.add("tg-webview-editor-root--with-title");
  }
  editorRoot.setAttribute("aria-label", "Rich text editor surface");
  app.append(editorRoot);
  return { editorRoot, titleInput, titleWrap };
}

async function resolveDesktopChrome(
  config: RuntimeConfig,
  openLinkForm: () => void,
  hostRef: { current: ReturnType<typeof createRichTextHost> | null },
  titleFocused: Accessor<boolean>,
): Promise<CreateRichTextHostOptions["renderChrome"]> {
  if (config.toolbarMode !== "desktop") {
    return undefined;
  }

  const { RichTextToolbar } = await import("@teamgaga/richtext-solid-toolbar");

  return (): JSX.Element => (
    <RichTextToolbar
      class="tg-webview-toolbar"
      aria-label="Rich text formatting"
      onOpenLinkForm={openLinkForm}
      onRequestClose={() => hostRef.current?.requestClose()}
      showCloseButton={config.showCloseButton}
      titleFocused={titleFocused}
    />
  );
}

/**
 * Mounts the editor into `#app` using an already-configured transport.
 * Shared by the native WebView entry and the Flutter Web iframe entry.
 */
export async function mountEditor(options: MountEditorOptions): Promise<MountedEditor> {
  const app = document.querySelector<HTMLDivElement>("#app");
  if (!app) {
    throw new Error("webview-runtime root #app was not found.");
  }

  const { config, transport } = options;
  setMediaMaxSize(config.mediaMaxSize);
  setMediaUriResolver((uri) => resolveRegisteredMediaUri(uri));

  let editorRef: RichTextEditor | null = null;
  let linkPopoverController: LinkPopoverController | undefined;

  const [titleFocused, setTitleFocused] = createSignal(false);
  const publishTitleEvent = (type: "title_focus" | "title_blur"): void => {
    const event: EditorEventMessage = {
      version: PROTOCOL_VERSION,
      kind: "event",
      type,
      payload: {},
    };
    void transport.send(encodeProtocolMessage(event));
  };
  const { editorRoot, titleInput, titleWrap } = prepareShell(app, config, {
    onFocus: () => {
      setTitleFocused(true);
      publishTitleEvent("title_focus");
      lastEditingField = "title";
    },
    onBlur: () => {
      setTitleFocused(false);
      publishTitleEvent("title_blur");
    },
    onEnter: () => {
      lastEditingField = "body";
      editorRef?.focus();
    },
  });

  const linkPopoverRoot = document.createElement("div");
  linkPopoverRoot.id = "tg-link-popover-root";
  app.append(linkPopoverRoot);

  const disposePopover = render(
    () => (
      <LinkPopoverHost
        editor={() => editorRef ?? undefined}
        locale={() => config.locale}
        isMobile={() => config.toolbarMode !== "desktop"}
        onControllerReady={(c) => {
          linkPopoverController = c;
        }}
      />
    ),
    linkPopoverRoot,
  );

  const hostRef: { current: ReturnType<typeof createRichTextHost> | null } = { current: null };
  const renderChrome = await resolveDesktopChrome(
    config,
    () => linkPopoverController?.open(),
    hostRef,
    titleFocused,
  );
  const emojiRegistry = resolveEmojiRegistry(config.emojiDefinitions);
  // Body placeholder must reach Quill at construction — CSS ::before reads
  // data-placeholder. Flutter Web iframe has no MutationObserver bootstrap
  // (native path still syncs as a belt-and-suspenders).
  const adapterFactory = createSolidAdapterFactory({
    ...(emojiRegistry ? { emojiRegistry } : {}),
    placeholder: config.placeholder ?? "Enter text",
  });

  let editingSessionCold = false;
  /** Host overlay open (Flutter Menu / link dialog) — suppress wake reclaim. */
  let interactionBlocked = false;
  let nativeEditorFocus: (() => void) | null = null;
  /** Unwrapped adapter focus — body focus helpers call this, never the wrapper. */
  let boundAdapterFocus: (() => void) | null = null;
  let destroyed = false;
  /** Field the user is editing — restore target when WebView2 drops DOM focus. */
  let lastEditingField: "title" | "body" | null = null;
  let focusKeeperFrame = 0;
  let windowFocused = true;
  let quoteGroupObserver: MutationObserver | undefined;

  /**
   * AppKit / WKWebView only needs a blur→focus kick after the window was
   * actually backgrounded. Doing it on a live caret leaves a stale native
   * caret overlay (ghost caret that does not blink or scroll).
   */
  const needsNativeFocusRestart = (): boolean => editingSessionCold || !windowFocused;

  const markEditingSessionCold = (): void => {
    editingSessionCold = true;
  };

  const blurEditorSurface = (): void => {
    lastEditingField = null;
    try {
      editorRef?.blur();
    } catch {
      // ignore
    }
    const titleEl = titleInput?.element;
    if (titleEl && document.activeElement === titleEl) {
      try {
        titleEl.blur();
      } catch {
        // ignore
      }
    }
    const active = document.activeElement;
    if (active instanceof HTMLElement && editorRoot.contains(active)) {
      try {
        active.blur();
      } catch {
        // ignore
      }
    }
  };

  const setEditorFocusBlocked = (blocked: boolean): void => {
    const editor = editorRef;
    if (!editor) return;
    if (blocked) {
      if (nativeEditorFocus) return;
      nativeEditorFocus = editor.focus.bind(editor);
      editor.focus = () => {
        /* host overlay owns keyboard — protocol focus must not reclaim */
      };
      return;
    }
    if (!nativeEditorFocus) return;
    editor.focus = nativeEditorFocus;
    nativeEditorFocus = null;
  };

  const focusTitleElement = (restartNativeFocus = needsNativeFocusRestart()): void => {
    const titleEl = titleInput?.element;
    if (!titleEl) return;
    if (document.activeElement === titleEl) {
      if (!restartNativeFocus) return;
      titleEl.blur();
    }
    try {
      titleEl.focus({ preventScroll: true });
    } catch {
      titleEl.focus();
    }
  };

  const focusBodyElement = (restartNativeFocus = needsNativeFocusRestart()): void => {
    if (interactionBlocked) return;
    const editable = editorRoot.querySelector<HTMLElement>(".ql-editor");
    if (editable && document.activeElement === editable) {
      // Live caret — a same-turn blur+focus leaks a WKWebView caret overlay.
      if (!restartNativeFocus) return;
      editable.blur();
    }
    if (boundAdapterFocus) {
      boundAdapterFocus();
      return;
    }
    if (!editable) return;
    try {
      editable.focus({ preventScroll: true });
    } catch {
      editable.focus();
    }
  };

  const wakeEditingSession = (wakeOptions?: { keepTitle?: boolean }): void => {
    // Flutter owns focus while an overlay is up (link TextFields, menus).
    // Auto-reclaiming `.ql-editor` here steals the caret from host inputs.
    if (interactionBlocked || linkPopoverController?.isOpen()) {
      return;
    }

    const titleEl = titleInput?.element;
    const keepTitle =
      wakeOptions?.keepTitle === true ||
      lastEditingField === "title" ||
      (titleEl != null && document.activeElement === titleEl);

    // Capture before clearing: double-rAF body focus must still know whether
    // this wake is a real app-switch (blur→focus) or a live-session no-op.
    const restartNativeFocus = needsNativeFocusRestart();

    // Host explicitly wakes the session — the window is definitely active.
    windowFocused = true;
    editingSessionCold = false;

    if (keepTitle) {
      focusTitleElement(restartNativeFocus);
      return;
    }

    // Focus body only.
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        focusBodyElement(restartNativeFocus);
      });
    });
  };

  (
    window as Window & {
      __TG_RICHTEXT_WAKE_EDITING_SESSION__?: (keepTitle?: boolean) => void;
    }
  ).__TG_RICHTEXT_WAKE_EDITING_SESSION__ = (keepTitle) => {
    wakeEditingSession({ keepTitle: Boolean(keepTitle) });
  };

  const onBlur = (): void => {
    windowFocused = false;
    markEditingSessionCold();
  };
  const onVisibility = (): void => {
    if (document.visibilityState === "hidden") {
      markEditingSessionCold();
      return;
    }
    if (document.visibilityState === "visible") {
      wakeEditingSession();
    }
  };
  const onFocus = (): void => {
    windowFocused = true;
    if (interactionBlocked) {
      return;
    }
    if (editingSessionCold) {
      wakeEditingSession();
    }
  };

  window.addEventListener("blur", onBlur);
  document.addEventListener("visibilitychange", onVisibility);
  window.addEventListener("focus", onFocus);

  const onPointerDown = (event: PointerEvent): void => {
    if (interactionBlocked) return;

    // Pointer intent outranks focus events: WebView2 sometimes swallows the
    // focus move a click should have made, and the keeper below must restore
    // the field the user aimed at rather than the one they left.
    const target = event.target;
    if (
      target instanceof Element &&
      (target.closest("#tg-link-popover-root") ||
        target.closest(".tg-link-popover") ||
        target.closest(".tg-link-popover-scrim"))
    ) {
      windowFocused = true;
      editingSessionCold = false;
      return;
    }
    const titleEl = titleInput?.element;
    const inToolbar = target instanceof Element && target.closest(".tg-webview-toolbar") !== null;
    if (titleEl && target instanceof Node && (target === titleEl || titleEl.contains(target))) {
      lastEditingField = "title";
    } else if (!inToolbar) {
      lastEditingField = "body";
    }

    // A physical pointer-down proves the window is active. Reset the flag
    // so the onFocusOut keeper is no longer blocked. macOS WKWebView may
    // never fire window.onFocus after an app-switch, leaving windowFocused
    // stuck at false and the caret dead. This is the primary fix.
    windowFocused = true;

    // Clear cold and let the click itself place the caret. Focusing or
    // preventDefault-ing here ate the first caret placement on Windows
    // WebView2 (the title↔body two-click bug).
    editingSessionCold = false;
  };
  editorRoot.addEventListener("pointerdown", onPointerDown, true);

  // Windows WebView2 runs as a composition texture: every pointer event Flutter
  // routes into it re-runs the native focus path, which resets
  // `document.activeElement` to `<body>` and kills the caret. That happens below
  // the DOM, so `preventDefault` on toolbar buttons cannot stop it. Track the
  // field the user is editing and put focus back whenever it lands on nothing.
  const onFocusIn = (event: FocusEvent): void => {
    const target = event.target;
    if (
      target instanceof Element &&
      (target.closest("#tg-link-popover-root") ||
        target.closest(".tg-link-popover") ||
        target.closest(".tg-link-popover-scrim"))
    ) {
      return;
    }
    const titleEl = titleInput?.element;
    if (titleEl && target === titleEl) {
      editingSessionCold = false;
      lastEditingField = "title";
      return;
    }
    if (target instanceof Element && target.closest(".ql-editor")) {
      editingSessionCold = false;
      lastEditingField = "body";
    }
  };

  const onFocusOut = (): void => {
    if (
      destroyed ||
      interactionBlocked ||
      lastEditingField === null ||
      linkPopoverController?.isOpen()
    ) {
      return;
    }
    // focusout runs before the next target is focused — settle on a frame so a
    // genuine title↔body handoff is not mistaken for a dropped caret.
    cancelAnimationFrame(focusKeeperFrame);
    focusKeeperFrame = requestAnimationFrame(() => {
      if (destroyed || interactionBlocked || !windowFocused || linkPopoverController?.isOpen()) {
        return;
      }
      const field = lastEditingField;
      if (field === null) return;
      const active = document.activeElement;
      const focusLanded =
        active !== null && active !== document.body && active !== document.documentElement;
      if (focusLanded) return;

      if (field === "title") {
        focusTitleElement();
        return;
      }
      focusBodyElement();
    });
  };

  document.addEventListener("focusin", onFocusIn);
  document.addEventListener("focusout", onFocusOut);

  const applyHostControl = (operation: HostControlOperation): void => {
    switch (operation.type) {
      case "updatePresentation": {
        if (operation.theme) {
          const root = document.documentElement;
          root.classList.remove("tg-theme-dark", "tg-theme-light");
          root.classList.add(operation.theme === "dark" ? "tg-theme-dark" : "tg-theme-light");
          app.dataset.theme = operation.theme;
        }
        if (typeof operation.titlePlaceholder === "string" && titleInput) {
          titleInput.element.placeholder = operation.titlePlaceholder;
        }
        if (typeof operation.placeholder === "string") {
          const bodyEditor = editorRoot.querySelector<HTMLElement>(".ql-editor");
          if (bodyEditor) {
            if (operation.placeholder.length > 0) {
              bodyEditor.setAttribute("data-placeholder", operation.placeholder);
            } else {
              bodyEditor.removeAttribute("data-placeholder");
            }
          }
        }
        if (typeof operation.shellBackgroundColor === "string") {
          app.style.background = operation.shellBackgroundColor;
        }
        break;
      }
      case "setInteractionBlocked":
        editorRoot.style.pointerEvents = operation.blocked ? "none" : "";
        interactionBlocked = operation.blocked;
        setEditorFocusBlocked(operation.blocked);
        if (operation.blocked) {
          // Release DOM focus so Flutter overlay TextFields (link dialog)
          // can keep the caret. pointer-events:none alone does not blur.
          // Clear cold flag so a residual window focus does not wake body.
          editingSessionCold = false;
          blurEditorSurface();
        }
        break;
      case "wakeEditingSession":
        wakeEditingSession({ keepTitle: operation.keepTitle });
        break;
      case "registerMedia":
      case "revokeMedia":
        applyMediaHostControl(operation);
        break;
      case "dispose":
        destroy();
        break;
      case "initializeAck":
        break;
    }
    options.onHostControl?.(operation);
  };

  const host = createRichTextHost({
    root: editorRoot,
    transport,
    renderChrome,
    headerElement: titleWrap,
    adapterFactory,
    uiController: {
      openLinkForm: () => linkPopoverController?.open(),
      isLinkPopoverOpen: () => Boolean(linkPopoverController?.isOpen()),
      focusLinkPopover: () => {
        const urlInput = document.getElementById("tg-link-url-input") as HTMLInputElement | null;
        const textInput = document.getElementById("tg-link-text-input") as HTMLInputElement | null;
        if (document.activeElement === textInput) {
          textInput?.focus();
        } else if (urlInput) {
          try {
            urlInput.focus({ preventScroll: true });
          } catch {
            urlInput.focus();
          }
          urlInput.select();
        }
      },
    },
    onEditorReady: (editor: RichTextEditor) => {
      editorRef = editor;
      quoteGroupObserver?.disconnect();
      const editable = editorRoot.querySelector<HTMLElement>(".ql-editor");
      if (editable) {
        quoteGroupObserver = observeQuoteGroupBoundaries(editable);
      }
      // Host-requested blur (link dialog, accessory panels) is deliberate:
      // drop the restore target so the focus keeper does not fight it.
      const nativeBlur = editor.blur.bind(editor);
      editor.blur = () => {
        lastEditingField = null;
        nativeBlur();
      };

      boundAdapterFocus = editor.focus.bind(editor);
      editor.focus = () => {
        if (lastEditingField === "title") {
          focusTitleElement();
          return;
        }
        focusBodyElement();
      };

      // Host may have blocked interaction before the adapter mounted.
      if (interactionBlocked) {
        setEditorFocusBlocked(true);
      }
      titleInput?.bindEditor(editor);
    },
    onError: (error) => {
      if (import.meta.env.DEV) {
        console.error(`[richtext-host] ${error.phase}:${error.code}`, error.message);
      }
    },
  });
  hostRef.current = host;

  const onGlobalKeyDown = (event: KeyboardEvent): void => {
    const isCmdOrCtrl = event.metaKey || event.ctrlKey;
    if (
      isCmdOrCtrl &&
      (event.key === "k" || event.key === "K") &&
      !event.shiftKey &&
      !event.altKey
    ) {
      if (destroyed || interactionBlocked) return;
      const active = document.activeElement;
      const inEditor =
        active && (active.classList.contains("ql-editor") || editorRoot.contains(active));
      if (inEditor || editorRef?.getState().focused) {
        event.preventDefault();
        event.stopPropagation();
        linkPopoverController?.open();
      }
    }
  };
  window.addEventListener("keydown", onGlobalKeyDown, true);

  void host.ready
    .then(() => {
      if (destroyed) return;
      // Wait two frames so a host set_snapshot / focus that arrives on ready
      // can land first. Only autofocus when nothing has taken the caret —
      // never blur a live editor (WKWebView ghost caret).
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          if (destroyed || interactionBlocked) return;
          const editable = editorRoot.querySelector<HTMLElement>(".ql-editor");
          if (!editable || document.activeElement === editable) return;
          try {
            editable.focus({ preventScroll: true });
          } catch {
            editable.focus();
          }
        });
      });
    })
    .catch((error: unknown) => {
      if (destroyed) return;
      const message = error instanceof Error ? error.message : "Host ready promise rejected.";
      showFatalError(app, message);
    });

  function destroy(): void {
    if (destroyed) return;
    destroyed = true;
    boundAdapterFocus = null;
    window.removeEventListener("keydown", onGlobalKeyDown, true);
    window.removeEventListener("blur", onBlur);
    document.removeEventListener("visibilitychange", onVisibility);
    window.removeEventListener("focus", onFocus);
    editorRoot.removeEventListener("pointerdown", onPointerDown, true);
    document.removeEventListener("focusin", onFocusIn);
    document.removeEventListener("focusout", onFocusOut);
    quoteGroupObserver?.disconnect();
    cancelAnimationFrame(focusKeeperFrame);
    delete (
      window as Window & {
        __TG_RICHTEXT_WAKE_EDITING_SESSION__?: (keepTitle?: boolean) => void;
      }
    ).__TG_RICHTEXT_WAKE_EDITING_SESSION__;
    disposePopover();
    linkPopoverRoot.remove();
    host.destroy();
    transport.destroy();
    clearMediaRegistrations();
    setMediaUriResolver(null);
  }

  return {
    destroy,
    wakeEditingSession,
    applyHostControl,
  };
}
