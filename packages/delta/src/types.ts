export const RICH_TEXT_SCHEMA_VERSION = 1 as const;

export type RichTextSize = "medium";

export type RichTextTheme = "yellow" | "purple" | "pink" | "red" | "blue" | "green";

export type MentionSign = "!" | "&";

export type InlineAttributes = {
  bold?: true;
  italic?: true;
  underline?: true;
  strike?: true;
  link?: string;
};

export type BlockAttributes = {
  header?: 1 | 2 | 3;
  list?: "ordered" | "bullet";
  indent?: 1 | 2 | 3 | 4 | 5;
  blockquote?: true;
};

export type MentionAttributes = {
  sign: MentionSign;
  displayText: string;
};

export type ChannelAttributes = {
  displayText: string;
};

export type ImageAttributes = {
  width: string;
  height: string;
  mimeType: string;
  fileSize: number;
};

export type VideoAttributes = ImageAttributes & {
  poster?: string;
  duration?: number;
};

export type MentionEmbed = {
  mention: string;
};

export type ChannelEmbed = {
  channel: string;
};

export type EmojiEmbed = {
  emoji: string;
};

export type DividerEmbed = {
  divider: "true";
};

export type ImageEmbed = {
  image: string;
};

export type VideoEmbed = {
  video: string;
};

export type RichTextEmbed =
  | MentionEmbed
  | ChannelEmbed
  | EmojiEmbed
  | DividerEmbed
  | ImageEmbed
  | VideoEmbed;

export type TextDeltaOperation = {
  insert: string;
  attributes?: InlineAttributes | BlockAttributes;
};

export type MentionDeltaOperation = {
  insert: MentionEmbed;
  attributes: MentionAttributes;
};

export type ChannelDeltaOperation = {
  insert: ChannelEmbed;
  attributes: ChannelAttributes;
};

export type EmojiDeltaOperation = {
  insert: EmojiEmbed;
};

export type DividerDeltaOperation = {
  insert: DividerEmbed;
};

export type ImageDeltaOperation = {
  insert: ImageEmbed;
  attributes: ImageAttributes;
};

export type VideoDeltaOperation = {
  insert: VideoEmbed;
  attributes: VideoAttributes;
};

export type DeltaOperation =
  | TextDeltaOperation
  | MentionDeltaOperation
  | ChannelDeltaOperation
  | EmojiDeltaOperation
  | DividerDeltaOperation
  | ImageDeltaOperation
  | VideoDeltaOperation;

export type RichTextSnapshotV1 = {
  title?: string;
  content: DeltaOperation[];
  size?: RichTextSize;
  theme?: RichTextTheme;
};
