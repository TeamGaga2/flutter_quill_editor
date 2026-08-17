import { createContext, useContext, type JSX, type ParentProps } from "solid-js";
import type { SolidRichTextController } from "../hooks/useRichTextEditor";

const RichTextContext = createContext<SolidRichTextController>();

export type RichTextProviderProps = ParentProps<{
  editor: SolidRichTextController;
}>;

export function RichTextProvider(props: RichTextProviderProps): JSX.Element {
  return <RichTextContext.Provider value={props.editor}>{props.children}</RichTextContext.Provider>;
}

export function useRichText(): SolidRichTextController {
  const context = useContext(RichTextContext);

  if (!context) {
    throw new Error("useRichText must be used within a RichTextProvider.");
  }

  return context;
}
