import { BlockEmbed } from "quill/blots/block";

/**
 * Horizontal rule as a block embed.
 *
 * Must not use Quill's inline {@link Embed}: `<hr>` is a void block-level tag, so
 * nesting it in a `<p>` (and attaching FEFF guards as children) breaks native
 * selection/focus in real WebViews.
 */
export class DividerBlot extends BlockEmbed {
  static blotName = "divider";

  static tagName = "hr";

  static className = "tgg-divider";

  static create() {
    return super.create();
  }

  static value() {
    return "true";
  }
}
