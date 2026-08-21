import { EmbedBlot, Scope } from "parchment";

export interface EmojiValue {
  id: string;
}

/**
 * Emoji as a span-wrapped image.
 *
 * The blot node must NOT be an `<img>`: a void element cannot represent the
 * native caret position after the embed on WebKit. It also intentionally uses
 * Parchment's guard-free `EmbedBlot`, rather than Quill's inline `Embed`.
 *
 * Quill's inline `Embed` adds `\uFEFF` caret guards. After a blurred accessory
 * insert, WebKit restores the caret into the right guard. Normal text triggers
 * `Embed.restore()` immediately, but CJK IME batches guard mutations until
 * `compositionend`; the composing text grows while the native caret remains at
 * guard offset 1, so it is painted before the text. The guard-free `EmbedBlot`
 * keeps native composition in the parent text flow. Its wrapper must remain
 * editable: WebKit does not paint a usable caret after a terminal non-editable
 * inline node. The inner `<img>` is already a void leaf.
 */
export class EmojiBlot extends EmbedBlot {
  static blotName = "emoji";

  static tagName = "span";

  static className = "tgg-emoji";

  static scope = Scope.INLINE_BLOT;

  static create(value: EmojiValue) {
    const node = super.create() as HTMLElement;

    node.setAttribute("data-emoji-id", value.id);

    const img = node.ownerDocument.createElement("img");
    img.setAttribute("alt", `:${value.id}:`);
    node.appendChild(img);

    return node;
  }

  static value(node: HTMLElement): EmojiValue {
    return {
      id: node.dataset.emojiId ?? "",
    };
  }
}
