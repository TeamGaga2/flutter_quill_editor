export const INLINE_FORMATS = ["bold", "italic", "underline", "strike", "link"] as const;

export const BLOCK_FORMATS = ["header", "list", "indent", "blockquote"] as const;

export const EMBED_FORMATS = ["mention", "channel", "emoji", "divider", "image", "video"] as const;

export const RICH_TEXT_FORMATS = [...INLINE_FORMATS, ...BLOCK_FORMATS, ...EMBED_FORMATS] as const;

export type InlineFormat = (typeof INLINE_FORMATS)[number];

export type BlockFormat = (typeof BLOCK_FORMATS)[number];

export type EmbedFormat = (typeof EMBED_FORMATS)[number];

export type RichTextFormat = (typeof RICH_TEXT_FORMATS)[number];
