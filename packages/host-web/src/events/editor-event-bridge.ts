import type { RichTextEditor, RichTextSelection, Unsubscribe } from "@teamgaga/richtext-core";
import {
  encodeProtocolMessage,
  PROTOCOL_VERSION,
  type EditorEventMessage,
  type ProtocolEditorState,
  type ProtocolSelection,
  type RequestCloseEvent,
  type RequestLinkEvent,
} from "@teamgaga/richtext-protocol";
import { createHostError, type RichTextHostError } from "../errors";

export interface EditorEventBridge {
  dispose(): void;
}

export function bindEditorEventBridge(
  editor: RichTextEditor,
  enqueue: (encoded: string) => void,
  onError: (error: RichTextHostError) => void,
): EditorEventBridge {
  const unsubscribers: Unsubscribe[] = [];

  const publish = (event: EditorEventMessage): void => {
    try {
      enqueue(encodeProtocolMessage(event));
    } catch {
      onError(createHostError("event", "encode_failed", "Failed to encode editor event."));
    }
  };

  unsubscribers.push(
    editor.on("change", () => {
      try {
        const snapshot = editor.getSnapshot();
        publish({
          version: PROTOCOL_VERSION,
          kind: "event",
          type: "change",
          payload: { snapshot },
        });
      } catch {
        onError(createHostError("event", "event_failed", "Failed to publish change event."));
      }
    }),
  );

  unsubscribers.push(
    editor.on("selection-change", (event) => {
      try {
        publish({
          version: PROTOCOL_VERSION,
          kind: "event",
          type: "selection_change",
          payload: { selection: event.selection },
        });
      } catch {
        onError(
          createHostError("event", "event_failed", "Failed to publish selection_change event."),
        );
      }
    }),
  );

  unsubscribers.push(
    editor.on("focus", () => {
      publish({
        version: PROTOCOL_VERSION,
        kind: "event",
        type: "focus",
        payload: {},
      });
    }),
  );

  unsubscribers.push(
    editor.on("blur", () => {
      publish({
        version: PROTOCOL_VERSION,
        kind: "event",
        type: "blur",
        payload: {},
      });
    }),
  );

  unsubscribers.push(
    editor.on("state-change", (event) => {
      try {
        const state: ProtocolEditorState = {
          focused: event.state.focused,
          selection: event.state.selection,
          canUndo: event.state.canUndo,
          canRedo: event.state.canRedo,
          formats: {
            bold: event.state.formats.bold,
            italic: event.state.formats.italic,
            underline: event.state.formats.underline,
            strike: event.state.formats.strike,
            header: event.state.formats.header,
            list: event.state.formats.list,
            blockquote: event.state.formats.blockquote,
          },
        };

        publish({
          version: PROTOCOL_VERSION,
          kind: "event",
          type: "state_change",
          payload: { state },
        });
      } catch {
        onError(createHostError("event", "event_failed", "Failed to publish state_change event."));
      }
    }),
  );

  // Core "ready" is intentionally NOT subscribed — Host lifecycle owns Protocol ready.

  return {
    dispose() {
      for (const unsubscribe of unsubscribers) {
        try {
          unsubscribe();
        } catch {
          // best-effort
        }
      }
      unsubscribers.length = 0;
    },
  };
}

export function createProtocolReadyEvent(): EditorEventMessage {
  return {
    version: PROTOCOL_VERSION,
    kind: "event",
    type: "ready",
    payload: { protocol_version: PROTOCOL_VERSION },
  };
}

/**
 * Web→Flutter UI intent: ask the host native shell to open its link dialog.
 * Desktop Solid toolbar (or other chrome) can call this via `RichTextHost.requestLink`.
 */
export function createProtocolRequestLinkEvent(
  selection?: ProtocolSelection | RichTextSelection | null,
): RequestLinkEvent {
  if (selection == null) {
    return {
      version: PROTOCOL_VERSION,
      kind: "event",
      type: "request_link",
      payload: {},
    };
  }

  return {
    version: PROTOCOL_VERSION,
    kind: "event",
    type: "request_link",
    payload: {
      selection: {
        start: selection.start,
        end: selection.end,
      },
    },
  };
}

/** Web→Flutter UI intent: ask the host native shell to close the editor. */
export function createProtocolRequestCloseEvent(): RequestCloseEvent {
  return {
    version: PROTOCOL_VERSION,
    kind: "event",
    type: "request_close",
    payload: {},
  };
}
