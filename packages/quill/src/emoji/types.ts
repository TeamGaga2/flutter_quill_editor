export interface EmojiDefinition {
  id: string;

  src: string;

  animated?: boolean;
}

export interface EmojiRegistry {
  get(id: string): EmojiDefinition | undefined;
}
