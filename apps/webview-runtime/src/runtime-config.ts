import type { InsertAction } from "@teamgaga/richtext-solid-toolbar";

/**
 * Runtime config injected by the Flutter shell (or URL query in dev).
 *
 * Priority: `window.__TG_RICHTEXT_CONFIG__` > URL query (dev only) > defaults.
 * Mobile production default is editor-only (`toolbarMode: 'none'`).
 */

export type ToolbarMode = "none" | "desktop";

/** Mirrors Flutter `kImImageCachedSize` (240 mobile / 320 desktop). */
export type MediaMaxSize = 240 | 320;

export interface RuntimeConfig {
  toolbarMode: ToolbarMode;
  mediaMaxSize: MediaMaxSize;
  /** Visible insert actions for desktop toolbar. When omitted or empty, no insert buttons render. */
  visibleInsertActions?: InsertAction[];
  /** When true, render a title textarea above the Quill body (Flutter PC shell). */
  showTitleInput?: boolean;
  /** When false, hide the toolbar close button (defaults to true). */
  showCloseButton?: boolean;
  /** Placeholder for the title field (from Flutter l10n). */
  titlePlaceholder?: string;
  /**
   * Body editor blank-state placeholder (from Flutter l10n).
   * Applied as Quill `placeholder` → `data-placeholder` for CSS `::before`.
   */
  placeholder?: string;
  /** Optional theme token stub for future host theming. */
  theme?: string;
  /** Optional locale stub for future host copy. */
  locale?: string;
  /** Optional shell background CSS color from the Flutter host. */
  shellBackgroundColor?: string;
  /** Structured emoji definitions (Flutter Web RuntimeConfig; ADR-0007). */
  emojiDefinitions?: Array<{ id: string; src: string; animated?: boolean }>;
}

export type InjectedRuntimeConfig = Partial<RuntimeConfig>;

declare global {
  interface Window {
    __TG_RICHTEXT_CONFIG__?: InjectedRuntimeConfig;
  }
}

const DEFAULT_CONFIG: RuntimeConfig = {
  toolbarMode: "none",
  mediaMaxSize: 240,
};

const ALLOWED_INSERT_ACTIONS = new Set<InsertAction>(["emoji", "mention", "channel", "image"]);

function isInsertAction(value: unknown): value is InsertAction {
  return typeof value === "string" && ALLOWED_INSERT_ACTIONS.has(value as InsertAction);
}

function parseInsertActionsList(raw: unknown): InsertAction[] | undefined {
  if (!Array.isArray(raw) || raw.length === 0) return undefined;
  const set = new Set<InsertAction>();
  const actions: InsertAction[] = [];
  for (const item of raw) {
    if (isInsertAction(item) && !set.has(item)) {
      set.add(item);
      actions.push(item);
    }
  }
  return actions.length > 0 ? actions : undefined;
}

function isToolbarMode(value: unknown): value is ToolbarMode {
  return value === "none" || value === "desktop";
}

function isMediaMaxSize(value: unknown): value is MediaMaxSize {
  return value === 240 || value === 320;
}

function readEmojiDefinitions(raw: unknown): RuntimeConfig["emojiDefinitions"] {
  if (!Array.isArray(raw) || raw.length === 0) return undefined;
  const defs: NonNullable<RuntimeConfig["emojiDefinitions"]> = [];
  for (const item of raw) {
    if (item === null || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    if (typeof record.id !== "string" || typeof record.src !== "string") continue;
    if (!record.id || !record.src) continue;
    defs.push({
      id: record.id,
      src: record.src,
      ...(typeof record.animated === "boolean" ? { animated: record.animated } : {}),
    });
  }
  return defs.length > 0 ? defs : undefined;
}

function readInjectedConfig(): InjectedRuntimeConfig {
  const raw = window.__TG_RICHTEXT_CONFIG__;
  if (raw === null || typeof raw !== "object") {
    return {};
  }

  const next: InjectedRuntimeConfig = {};

  if (isToolbarMode(raw.toolbarMode)) {
    next.toolbarMode = raw.toolbarMode;
  }

  if (isMediaMaxSize(raw.mediaMaxSize)) {
    next.mediaMaxSize = raw.mediaMaxSize;
  }

  if (typeof raw.showTitleInput === "boolean") {
    next.showTitleInput = raw.showTitleInput;
  }

  if (typeof raw.showCloseButton === "boolean") {
    next.showCloseButton = raw.showCloseButton;
  }

  if (typeof raw.titlePlaceholder === "string" && raw.titlePlaceholder.length > 0) {
    next.titlePlaceholder = raw.titlePlaceholder;
  }

  if (typeof raw.placeholder === "string" && raw.placeholder.length > 0) {
    next.placeholder = raw.placeholder;
  }

  if (typeof raw.theme === "string" && raw.theme.length > 0) {
    next.theme = raw.theme;
  }

  if (typeof raw.locale === "string" && raw.locale.length > 0) {
    next.locale = raw.locale;
  }

  if (typeof raw.shellBackgroundColor === "string" && raw.shellBackgroundColor.length > 0) {
    next.shellBackgroundColor = raw.shellBackgroundColor;
  }

  const emojiDefinitions = readEmojiDefinitions(raw.emojiDefinitions);
  if (emojiDefinitions) {
    next.emojiDefinitions = emojiDefinitions;
  }

  const visibleInsertActions = parseInsertActionsList(raw.visibleInsertActions);
  if (visibleInsertActions) {
    next.visibleInsertActions = visibleInsertActions;
  }

  return next;
}

/** Dev-only URL query: `?toolbarMode=desktop&theme=dark&locale=en&mediaMaxSize=320&showTitleInput=1&showCloseButton=0&visibleInsertActions=emoji,mention,channel,image`. */
function readDevQueryConfig(): InjectedRuntimeConfig {
  if (!import.meta.env.DEV) {
    return {};
  }

  const params = new URLSearchParams(window.location.search);
  const next: InjectedRuntimeConfig = {};

  const toolbarMode = params.get("toolbarMode") ?? params.get("toolbar");
  if (isToolbarMode(toolbarMode)) {
    next.toolbarMode = toolbarMode;
  }

  const mediaMaxSizeRaw = params.get("mediaMaxSize");
  if (mediaMaxSizeRaw !== null) {
    const parsed = Number(mediaMaxSizeRaw);
    if (isMediaMaxSize(parsed)) {
      next.mediaMaxSize = parsed;
    }
  }

  const showTitleInput = params.get("showTitleInput");
  if (showTitleInput === "1" || showTitleInput === "true") {
    next.showTitleInput = true;
  }

  const showCloseButton = params.get("showCloseButton");
  if (showCloseButton === "0" || showCloseButton === "false") {
    next.showCloseButton = false;
  } else if (showCloseButton === "1" || showCloseButton === "true") {
    next.showCloseButton = true;
  }

  const titlePlaceholder = params.get("titlePlaceholder");
  if (titlePlaceholder) {
    next.titlePlaceholder = titlePlaceholder;
  }

  const placeholder = params.get("placeholder");
  if (placeholder) {
    next.placeholder = placeholder;
  }

  const theme = params.get("theme");
  if (theme) {
    next.theme = theme;
  }

  const locale = params.get("locale");
  if (locale) {
    next.locale = locale;
  }

  const insertActionsRaw = params.get("visibleInsertActions") ?? params.get("insertActions");
  if (insertActionsRaw !== null) {
    const split = insertActionsRaw
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    const parsed = parseInsertActionsList(split);
    if (parsed) {
      next.visibleInsertActions = parsed;
    }
  }

  return next;
}

export function resolveRuntimeConfig(): RuntimeConfig {
  const injected = readInjectedConfig();
  const query = readDevQueryConfig();

  return {
    toolbarMode: injected.toolbarMode ?? query.toolbarMode ?? DEFAULT_CONFIG.toolbarMode,
    mediaMaxSize: injected.mediaMaxSize ?? query.mediaMaxSize ?? DEFAULT_CONFIG.mediaMaxSize,
    visibleInsertActions: injected.visibleInsertActions ?? query.visibleInsertActions,
    showTitleInput: injected.showTitleInput ?? query.showTitleInput,
    showCloseButton: injected.showCloseButton ?? query.showCloseButton,
    titlePlaceholder: injected.titlePlaceholder ?? query.titlePlaceholder,
    // Match Flutter native bootstrap default when host omits the field
    // (DEV browser / partial inject). Prefer explicit host l10n when present.
    placeholder: injected.placeholder ?? query.placeholder ?? "Enter text",
    theme: injected.theme ?? query.theme,
    locale: injected.locale ?? query.locale,
    shellBackgroundColor: injected.shellBackgroundColor,
    emojiDefinitions: injected.emojiDefinitions,
  };
}
