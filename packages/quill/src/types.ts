import type {
  ChannelInsert,
  ImageInsert,
  LinkInsert,
  MentionInsert,
  RichTextAdapter,
  RichTextSelection,
  VideoInsert,
} from "@teamgaga/richtext-core";
import type { EmojiRegistry } from "./emoji/types";

export interface QuillAdapterOptions {
  element: HTMLElement;

  /**
   * The sole element the adapter may scroll to reveal a selection. The adapter
   * never discovers or scrolls ancestors (especially the document viewport).
   * Defaults to `element`.
   */
  scrollContainer?: HTMLElement;

  emojiRegistry?: EmojiRegistry;

  /**
   * Quill blank-state placeholder shown via `data-placeholder` + CSS `::before`.
   * Empty / omitted → no placeholder attribute.
   */
  placeholder?: string;
}

export interface QuillAdapter extends RichTextAdapter {
  /**
   * 在当前选区插入自定义 Emoji。
   */
  insertEmoji(id: string): void;

  insertMention(mention: MentionInsert, selection?: RichTextSelection): void;

  insertChannel(channel: ChannelInsert, selection?: RichTextSelection): void;

  insertImage(image: ImageInsert, selection?: RichTextSelection): void;

  insertVideo(video: VideoInsert, selection?: RichTextSelection): void;

  insertLink(link: LinkInsert, selection?: RichTextSelection): void;

  insertDivider(selection?: RichTextSelection): void;
}
