import type { LinkPopoverLabels } from "./types";

export const ZH_LABELS: LinkPopoverLabels = Object.freeze({
  title: "添加链接",
  urlLabel: "链接",
  urlPlaceholder: "粘贴或输入链接地址",
  textLabel: "文本",
  textPlaceholder: "输入文本",
  cancel: "取消",
  ok: "确定",
});

export const EN_LABELS: LinkPopoverLabels = Object.freeze({
  title: "Add link",
  urlLabel: "Link",
  urlPlaceholder: "Paste or enter a link address",
  textLabel: "Text",
  textPlaceholder: "Enter text",
  cancel: "Cancel",
  ok: "OK",
});

export const HI_LABELS: LinkPopoverLabels = Object.freeze({
  title: "लिंक जोड़ें",
  urlLabel: "लिंक",
  urlPlaceholder: "लिंक पता चिपकाएँ या दर्ज करें",
  textLabel: "पाठ",
  textPlaceholder: "पाठ दर्ज करें",
  cancel: "रद्द करें",
  ok: "ठीक है",
});

export function resolveLinkPopoverLabels(locale?: string): LinkPopoverLabels {
  if (!locale && typeof navigator !== "undefined") {
    locale = navigator.language;
  }
  if (!locale) {
    return EN_LABELS;
  }

  const normalized = locale.trim().toLowerCase();
  if (normalized === "zh" || normalized.startsWith("zh-")) {
    return ZH_LABELS;
  }
  if (normalized === "hi" || normalized.startsWith("hi-")) {
    return HI_LABELS;
  }
  return EN_LABELS;
}
