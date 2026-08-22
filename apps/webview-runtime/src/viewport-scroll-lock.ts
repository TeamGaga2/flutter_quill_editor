interface ViewportScrollPosition {
  windowX: number;
  windowY: number;
  documentX: number;
  documentY: number;
  bodyX: number;
  bodyY: number;
}

export interface ViewportScrollLock {
  focus(element: HTMLElement): void;
  restore(): void;
  destroy(): void;
}

function readPosition(): ViewportScrollPosition {
  return {
    windowX: window.scrollX,
    windowY: window.scrollY,
    documentX: document.documentElement.scrollLeft,
    documentY: document.documentElement.scrollTop,
    bodyX: document.body.scrollLeft,
    bodyY: document.body.scrollTop,
  };
}

function restorePosition(position: ViewportScrollPosition): void {
  if (window.scrollX !== position.windowX || window.scrollY !== position.windowY) {
    try {
      window.scrollTo(position.windowX, position.windowY);
    } catch {
      // Some WebView test doubles expose scroll offsets but not scrollTo.
    }
  }

  if (document.documentElement.scrollLeft !== position.documentX) {
    document.documentElement.scrollLeft = position.documentX;
  }
  if (document.documentElement.scrollTop !== position.documentY) {
    document.documentElement.scrollTop = position.documentY;
  }
  if (document.body.scrollLeft !== position.bodyX) {
    document.body.scrollLeft = position.bodyX;
  }
  if (document.body.scrollTop !== position.bodyY) {
    document.body.scrollTop = position.bodyY;
  }
}

function isViewportScrollTarget(target: EventTarget | null): boolean {
  return (
    target === document ||
    target === document.documentElement ||
    target === document.body ||
    target === window
  );
}

/**
 * Keeps the document viewport fixed while allowing the title textarea and the
 * body editor to scroll themselves. Prevents iOS WKWebView from scrolling or
 * dragging the root layout viewport without fighting visualViewport animations.
 */
export function createViewportScrollLock(): ViewportScrollLock {
  const position = readPosition();
  let destroyed = false;

  const restore = (): void => {
    if (!destroyed) {
      restorePosition(position);
    }
  };

  const onWindowScroll = (): void => {
    if (window.scrollX !== position.windowX || window.scrollY !== position.windowY) {
      restore();
    }
  };

  const onDocumentScroll = (event: Event): void => {
    if (isViewportScrollTarget(event.target)) {
      restore();
    }
  };

  const onTouchMove = (event: TouchEvent): void => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    // Allow inner scrollable elements to scroll normally.
    if (
      target.closest(
        ".tg-richtext-host-editor, .tg-webview-title-input, #tg-link-popover-root, .tg-link-popover",
      )
    ) {
      return;
    }
    // Block rubberband dragging of the root viewport on non-scrollable chrome.
    if (event.cancelable) {
      event.preventDefault();
    }
  };

  window.addEventListener("scroll", onWindowScroll, { passive: true });
  document.addEventListener("scroll", onDocumentScroll, true);
  document.addEventListener("touchmove", onTouchMove, { passive: false });

  return {
    focus(element) {
      restore();
      try {
        element.focus({ preventScroll: true });
      } catch {
        element.focus();
      }
      restore();
    },

    restore,

    destroy() {
      if (destroyed) return;
      destroyed = true;
      window.removeEventListener("scroll", onWindowScroll);
      document.removeEventListener("scroll", onDocumentScroll, true);
      document.removeEventListener("touchmove", onTouchMove);
    },
  };
}
