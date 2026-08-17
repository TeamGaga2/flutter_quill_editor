/**
 * Emoji definitions for the WebView host.
 *
 * Production: Flutter injects `window.__TG_RICHTEXT_EMOJI_DEFINITIONS__` and
 * serves PNG files from the local runtime HTTP server (e.g. `/images/emoji/ok.png`).
 * Dev: optional query `?emojiBase=/path/` or leave unset (emoji nodes stay without src).
 */

export interface RuntimeEmojiDefinition {
  id: string;
  src: string;
  animated?: boolean;
}

export interface RuntimeEmojiRegistry {
  get(id: string): RuntimeEmojiDefinition | undefined;
}

declare global {
  interface Window {
    __TG_RICHTEXT_EMOJI_DEFINITIONS__?: RuntimeEmojiDefinition[];
  }
}

export function resolveEmojiRegistry(
  configDefinitions?: RuntimeEmojiDefinition[],
): RuntimeEmojiRegistry | undefined {
  if (Array.isArray(configDefinitions) && configDefinitions.length > 0) {
    return createRegistry(configDefinitions);
  }

  const injected = window.__TG_RICHTEXT_EMOJI_DEFINITIONS__;
  if (Array.isArray(injected) && injected.length > 0) {
    return createRegistry(injected);
  }

  if (import.meta.env.DEV) {
    const params = new URLSearchParams(window.location.search);
    const base = params.get("emojiBase");
    if (base) {
      // Dev harness only: load ids from a comma-separated list if provided.
      const ids = (params.get("emojiIds") ?? "ok,thumbs_up,heart").split(",").filter(Boolean);
      const normalizedBase = base.endsWith("/") ? base : `${base}/`;
      return createRegistry(
        ids.map((id) => ({
          id: id.trim(),
          src: `${normalizedBase}${id.trim()}.png`,
        })),
      );
    }
  }

  return undefined;
}

function createRegistry(definitions: RuntimeEmojiDefinition[]): RuntimeEmojiRegistry {
  const byId = new Map<string, RuntimeEmojiDefinition>();
  for (const def of definitions) {
    if (def?.id && def.src) {
      byId.set(def.id, def);
    }
  }
  return {
    get(id) {
      return byId.get(id);
    },
  };
}
