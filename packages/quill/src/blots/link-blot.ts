import Link from "quill/formats/link";

/**
 * TeamGaga link format.
 *
 * Quill's default link whitelist is `http|https|mailto|tel|sms` and any other
 * scheme is rewritten to `about:blank`. Our protocol also allows mini-program
 * schemes (`mp:`, `mps:`). Once href becomes `about:blank`,
 * `getSnapshot()` fails `isAllowedLink` and every host command that reads the
 * document (`get_snapshot`, change events, send) returns `command_failed`.
 *
 * We:
 * - extend the protocol whitelist with `mp` / `mps`
 * - keep the canonical URL on `data-tg-href` so formats() survives any href
 *   sanitization the browser applies for custom schemes
 */
export class TgLinkBlot extends Link {
  static blotName = "link";

  static tagName = "A";

  static PROTOCOL_WHITELIST: string[] = ["http", "https", "mailto", "tel", "sms", "mp", "mps"];

  static create(value: string): HTMLElement {
    const node = super.create(value) as HTMLAnchorElement;
    const href = this.sanitize(value);
    node.setAttribute("href", href);
    // Always persist the original so formats() can recover mp/mps even when a
    // host WebView rewrites custom-scheme hrefs.
    node.setAttribute("data-tg-href", value);
    node.setAttribute("rel", "noopener noreferrer");
    node.setAttribute("target", "_blank");
    return node;
  }

  static formats(domNode: HTMLElement): string | null {
    return domNode.getAttribute("data-tg-href") ?? domNode.getAttribute("href");
  }

  static sanitize(url: string): string {
    const trimmed = url.trim();
    if (!trimmed) {
      return this.SANITIZED_URL;
    }

    // Prefer URL parsing so custom schemes (mp/mps) are not mangled by
    // `<a href>` assignment the way they are in some WebView / happy-dom hosts.
    try {
      const parsed = new URL(trimmed);
      const protocol = parsed.protocol.replace(/:$/, "");
      if (this.PROTOCOL_WHITELIST.includes(protocol)) {
        return trimmed;
      }
    } catch {
      // fall through to Quill's relative-friendly sanitize
    }

    return super.sanitize(trimmed);
  }

  format(name: string, value: unknown): void {
    if (name !== this.statics.blotName || !value) {
      super.format(name, value);
      if (!value) {
        this.domNode.removeAttribute("data-tg-href");
      }
      return;
    }

    if (typeof value !== "string") {
      super.format(name, value);
      return;
    }

    const ctor = this.constructor as typeof TgLinkBlot;
    this.domNode.setAttribute("href", ctor.sanitize(value));
    this.domNode.setAttribute("data-tg-href", value);
  }
}
