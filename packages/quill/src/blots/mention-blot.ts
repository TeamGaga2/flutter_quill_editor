import Embed from "quill/blots/embed";

interface MentionValue {
  id: string;

  sign: "!" | "&";

  displayText: string;
}

export class MentionBlot extends Embed {
  static blotName = "mention";

  static tagName = "span";

  static className = "tgg-mention";

  static create(value: MentionValue) {
    const node = super.create() as HTMLElement;

    node.setAttribute("data-id", value.id);

    node.setAttribute("data-sign", value.sign);

    node.setAttribute("data-display", value.displayText);

    node.textContent = `@${value.displayText}`;

    return node;
  }

  static value(node: HTMLElement): MentionValue {
    return {
      id: node.dataset.id ?? "",

      sign: node.dataset.sign === "&" ? "&" : "!",

      displayText: node.dataset.display ?? "",
    };
  }
}
