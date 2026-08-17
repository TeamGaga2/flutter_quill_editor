const QUOTE_GROUP_START_CLASS = "tgg-quote-group-start";
const QUOTE_GROUP_END_CLASS = "tgg-quote-group-end";

function isBlockquote(element: Element | null): element is HTMLQuoteElement {
  return element?.tagName === "BLOCKQUOTE";
}

export function syncQuoteGroupBoundaries(editor: HTMLElement): void {
  const children = [...editor.children];

  for (const [index, child] of children.entries()) {
    if (!isBlockquote(child)) {
      child.classList.remove(QUOTE_GROUP_START_CLASS, QUOTE_GROUP_END_CLASS);
      continue;
    }

    child.classList.toggle(QUOTE_GROUP_START_CLASS, !isBlockquote(children[index - 1] ?? null));
    child.classList.toggle(QUOTE_GROUP_END_CLASS, !isBlockquote(children[index + 1] ?? null));
  }
}

export function observeQuoteGroupBoundaries(editor: HTMLElement): MutationObserver | undefined {
  syncQuoteGroupBoundaries(editor);

  const MutationObserverConstructor = editor.ownerDocument.defaultView?.MutationObserver;
  if (!MutationObserverConstructor) {
    return undefined;
  }

  const observer = new MutationObserverConstructor(() => syncQuoteGroupBoundaries(editor));
  observer.observe(editor, { childList: true });
  return observer;
}
