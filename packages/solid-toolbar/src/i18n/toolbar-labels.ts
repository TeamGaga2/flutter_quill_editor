/**
 * Internal toolbar copy and browser-language resolution for the Solid desktop
 * toolbar. Not part of the package's public API; RichTextToolbar is the only
 * consumer.
 *
 * Contract (product-confirmed):
 * - `zh` and every `zh-*` locale render the Chinese table; all other locales
 *   render English.
 * - The browser language is read once from `navigator.language` at toolbar
 *   mount. There is no runtime switching and no public locale prop.
 */

export interface ToolbarLabels {
  readonly emoji: string;
  readonly mention: string;
  readonly channel: string;
  readonly image: string;
  readonly header: string;
  readonly bold: string;
  readonly italic: string;
  readonly underline: string;
  readonly link: string;
  readonly divider: string;
  readonly outdent: string;
  readonly indent: string;
  readonly bulletList: string;
  readonly orderedList: string;
  readonly blockquote: string;
}

const CHINESE_LABELS: ToolbarLabels = Object.freeze({
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
});

const ENGLISH_LABELS: ToolbarLabels = Object.freeze({
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
});

/**
 * True only for the exact `zh` tag or `zh-*` subtags (case-insensitive).
 * Deliberately not a bare `startsWith("zh")` so non-standard strings like
 * `zhx` are never misclassified as Chinese.
 */
export function isChineseLanguage(language: string | undefined): boolean {
  if (language === undefined) {
    return false;
  }

  const normalized = language.trim().toLowerCase();
  return normalized === "zh" || normalized.startsWith("zh-");
}

/** Pure resolution: the full label table for a language tag. */
export function resolveToolbarLabels(language: string | undefined): ToolbarLabels {
  return isChineseLanguage(language) ? CHINESE_LABELS : ENGLISH_LABELS;
}

/**
 * Browser entry point: reads `navigator.language` once. Falls back to English
 * when the API is unavailable (or the value is not a usable tag).
 */
export function browserToolbarLabels(): ToolbarLabels {
  const language = typeof navigator === "undefined" ? undefined : navigator.language;
  return resolveToolbarLabels(language);
}
