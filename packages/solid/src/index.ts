import "./styles/editor.css";

export { RichTextEditor } from "./components";
export { RichTextProvider, useRichText } from "./context/RichTextContext";
export {
  createRichTextEditor,
  EMPTY_EDITOR_STATE,
  useEditorState,
  useRichTextEditor,
} from "./hooks";

export type { RichTextEditorProps } from "./components";
export type { RichTextProviderProps } from "./context/RichTextContext";
export type { SolidRichTextController, UseRichTextEditorOptions } from "./hooks";
export {
  createSolidAdapterFactory,
  type RichTextAdapterFactory,
  type SolidAdapterOptions,
} from "./adapters/solidAdapter";

export {
  LinkPopover,
  LinkPopoverHost,
  useLinkPopover,
  extractLinkContext,
  isValidUrl,
  resolveLinkPopoverLabels,
  ZH_LABELS,
  EN_LABELS,
  HI_LABELS,
} from "./link-popover";
export type {
  ExtractedLinkContext,
  LinkFormState,
  LinkPopoverAnchor,
  LinkPopoverController,
  LinkPopoverHostProps,
  LinkPopoverLabels,
  LinkPopoverPlacement,
  LinkPopoverProps,
  UseLinkPopoverOptions,
} from "./link-popover";

export { setMediaMaxSize, getMediaMaxSize, setMediaUriResolver } from "@teamgaga/richtext-quill";
export type { MediaMaxSize, MediaUriResolver } from "@teamgaga/richtext-quill";
