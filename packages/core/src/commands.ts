export type ToggleInlineFormat = "bold" | "italic" | "underline" | "strike";
export type HeaderLevel = 1 | 2 | 3;
export type ListType = "ordered" | "bullet";

export interface MentionInsert {
  id: string;
  sign: "!" | "&";
  displayText: string;
}

export interface ChannelInsert {
  id: string;
  displayText: string;
}

export interface ImageInsert {
  src: string;
  width: string;
  height: string;
  mimeType: string;
  fileSize: number;
}

export interface VideoInsert extends ImageInsert {
  poster?: string;
  duration?: number;
}

export interface LinkInsert {
  url: string;
  text: string;
}

export type EditorCommand =
  | {
      type: "toggle-inline-format";
      format: ToggleInlineFormat;
    }
  | {
      type: "toggle-block-format";
      format: "header";
      value: HeaderLevel;
    }
  | {
      type: "toggle-block-format";
      format: "list";
      value: ListType;
    }
  | {
      type: "toggle-block-format";
      format: "blockquote";
    }
  | {
      type: "insert-emoji";
      id: string;
    }
  | {
      type: "insert-mention";
      mention: MentionInsert;
      selection?: { start: number; end: number };
    }
  | {
      type: "insert-channel";
      channel: ChannelInsert;
      selection?: { start: number; end: number };
    }
  | {
      type: "insert-image";
      image: ImageInsert;
      selection?: { start: number; end: number };
    }
  | {
      type: "insert-video";
      video: VideoInsert;
      selection?: { start: number; end: number };
    }
  | {
      type: "insert-link";
      link: LinkInsert;
      selection?: { start: number; end: number };
    }
  | {
      type: "insert-divider";
      selection?: { start: number; end: number };
    }
  | {
      type: "indent";
    }
  | {
      type: "outdent";
    }
  | {
      type: "undo";
    }
  | {
      type: "redo";
    };

/** Caret bounds in CSS pixels relative to the WebView viewport. */
export interface CaretRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface EditorCommands {
  toggleBold(): void;
  toggleItalic(): void;
  toggleUnderline(): void;
  toggleStrike(): void;
  toggleHeader(level: HeaderLevel): void;
  toggleList(type: ListType): void;
  toggleBlockquote(): void;
  indent(): void;
  outdent(): void;
  insertEmoji(id: string): void;
  insertMention(mention: MentionInsert, selection?: { start: number; end: number }): void;
  insertChannel(channel: ChannelInsert, selection?: { start: number; end: number }): void;
  insertImage(image: ImageInsert, selection?: { start: number; end: number }): void;
  insertVideo(video: VideoInsert, selection?: { start: number; end: number }): void;
  insertLink(link: LinkInsert, selection?: { start: number; end: number }): void;
  insertDivider(selection?: { start: number; end: number }): void;
}

export interface EditorHistory {
  undo(): void;
  redo(): void;
}
