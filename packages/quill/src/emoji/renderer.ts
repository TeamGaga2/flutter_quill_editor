import type { EmojiRegistry } from "./types";

/**
 * Resolve registered emoji image URLs for rendered emoji embeds.
 *
 * Emoji blots are `span.tgg-emoji[data-emoji-id]` wrapping an inner `<img>`
 * (see EmojiBlot). The outer span owns identity (`data-emoji-id`,
 * `data-emoji-missing`) while hydration fills the inner img's `src` / `alt`.
 */
export function hydrateEmojiNodes(root: ParentNode, registry: EmojiRegistry): void {
  root.querySelectorAll<HTMLElement>("span.tgg-emoji[data-emoji-id]").forEach((node) => {
    const id = node.dataset.emojiId;

    if (!id) {
      return;
    }

    const img = node.querySelector<HTMLImageElement>("img");
    const definition = registry.get(id);

    if (!definition || !img) {
      if (img) {
        img.removeAttribute("src");
      }
      node.dataset.emojiMissing = "true";
      return;
    }

    if (img.getAttribute("src") !== definition.src) {
      img.setAttribute("src", definition.src);
    }

    const alt = `:${id}:`;

    if (img.getAttribute("alt") !== alt) {
      img.setAttribute("alt", alt);
    }

    delete node.dataset.emojiMissing;
  });
}
