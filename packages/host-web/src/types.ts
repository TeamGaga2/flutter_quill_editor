import type { JSX } from "solid-js";
import type { RichTextEditor } from "@teamgaga/richtext-core";
import type { RichTextAdapterFactory } from "@teamgaga/richtext-solid";
import type { HostTransport } from "./bridge/transport";
import type { RichTextHostError } from "./errors";

export interface CreateRichTextHostOptions {
  root: HTMLElement;
  transport: HostTransport;
  maxPendingCommands?: number;
  onError?: (error: RichTextHostError) => void;
  /**
   * Optional chrome rendered inside the host `RichTextProvider` (e.g. desktop toolbar).
   * Host never imports toolbar packages — callers supply the element factory.
   */
  renderChrome?: () => JSX.Element;
  /**
   * Optional DOM header (e.g. title wrap) between chrome and the editor body so
   * layout is toolbar → title → body under In-Web Desktop Chrome.
   */
  headerElement?: HTMLElement;
  /**
   * Optional adapter factory (e.g. Solid adapter with emoji registry).
   * When omitted, HostApp uses the default Solid/Quill adapter.
   */
  adapterFactory?: RichTextAdapterFactory;
  /** Called when the core editor is mounted and ready for shell wiring (e.g. title input). */
  onEditorReady?: (editor: RichTextEditor) => void;
}

export interface RichTextHost {
  readonly ready: Promise<void>;
  /**
   * Emit a Web→Flutter `request_link` event so the host can open its link dialog.
   * When `selection` is omitted, uses the editor's current selection (if any).
   * Pass `null` to omit selection from the payload.
   */
  requestLink(selection?: { start: number; end: number } | null): void;
  /** Emit a Web→Flutter `request_close` event when the host is ready. */
  requestClose(): void;
  destroy(): void;
}

export type HostLifecycleState = "mounting" | "draining" | "ready" | "destroyed" | "failed";

export const DEFAULT_MAX_PENDING_COMMANDS = 64;
