import type { RichTextSelection } from "@teamgaga/richtext-core";

export type LinkPopoverPlacement =
  | "bottom-start"
  | "bottom"
  | "bottom-end"
  | "top-start"
  | "top"
  | "top-end"
  | "modal";

export interface LinkPopoverAnchor {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface LinkPopoverLabels {
  title: string;
  urlLabel: string;
  urlPlaceholder: string;
  textLabel: string;
  textPlaceholder: string;
  cancel: string;
  ok: string;
}

export interface LinkFormState {
  isOpen: boolean;
  url: string;
  text: string;
  range: RichTextSelection | null;
  anchor: LinkPopoverAnchor | null;
  isEditingExisting: boolean;
  isMobileModal: boolean;
}

export interface LinkPopoverController {
  readonly state: () => LinkFormState;
  readonly isOpen: () => boolean;
  readonly url: () => string;
  readonly text: () => string;
  readonly range: () => RichTextSelection | null;
  readonly anchor: () => LinkPopoverAnchor | null;
  readonly isEditingExisting: () => boolean;
  readonly isMobileModal: () => boolean;
  readonly labels: () => LinkPopoverLabels;
  readonly canSubmit: () => boolean;
  open: () => void;
  close: () => void;
  setUrl: (url: string) => void;
  setText: (text: string) => void;
  submit: () => void;
}
