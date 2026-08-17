import type { EmojiDefinition, EmojiRegistry } from "./types";

export function createEmojiRegistry(definitions: readonly EmojiDefinition[]): EmojiRegistry {
  const definitionsById = new Map(definitions.map((definition) => [definition.id, definition]));

  return {
    get(id) {
      return definitionsById.get(id);
    },
  };
}
