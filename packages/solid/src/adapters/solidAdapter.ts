import type { RichTextAdapter } from "@teamgaga/richtext-core";
import { createQuillAdapter, type QuillAdapterOptions } from "@teamgaga/richtext-quill";

export type RichTextAdapterFactory = (element: HTMLElement) => RichTextAdapter;
export type SolidAdapterOptions = Omit<QuillAdapterOptions, "element">;

export function createSolidAdapterFactory(
  options: SolidAdapterOptions = {},
): RichTextAdapterFactory {
  return (element) =>
    createQuillAdapter({
      ...options,
      element,
    });
}
