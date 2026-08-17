import Embed from "quill/blots/embed";

export interface ChannelValue {
  id: string;

  displayText: string;
}

export class ChannelBlot extends Embed {
  static blotName = "channel";

  static tagName = "span";

  static className = "tgg-channel";

  static create(value: ChannelValue) {
    const node = super.create() as HTMLElement;

    node.setAttribute("data-id", value.id);

    node.setAttribute("data-display", value.displayText);

    node.textContent = `#${value.displayText}`;

    return node;
  }

  static value(node: HTMLElement): ChannelValue {
    return {
      id: node.dataset.id ?? "",

      displayText: node.dataset.display ?? "",
    };
  }
}
