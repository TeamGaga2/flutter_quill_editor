import type { RichTextEditor as CoreRichTextEditor } from "@teamgaga/richtext-core";
import {
  encodeProtocolMessage,
  type EditorCommandMessage,
  type EditorResponseMessage,
} from "@teamgaga/richtext-protocol";
import { createEditorNotReadyResponse, processInboundMessage } from "../bridge/inbound-message";
import type { HostTransport } from "../bridge/transport";
import { dispatchEditorCommand } from "../dispatcher/command-dispatcher";
import { createHostError, toDestroyError, toMountError, type RichTextHostError } from "../errors";
import {
  bindEditorEventBridge,
  createProtocolReadyEvent,
  createProtocolRequestChannelEvent,
  createProtocolRequestCloseEvent,
  createProtocolRequestEmojiEvent,
  createProtocolRequestImageEvent,
  createProtocolRequestMentionEvent,
  type EditorEventBridge,
} from "../events/editor-event-bridge";
import {
  DEFAULT_MAX_PENDING_COMMANDS,
  type CreateRichTextHostOptions,
  type HostLifecycleState,
  type RichTextHost,
} from "../types";
import { mountHostApp, type MountedHostApp } from "../ui/mount-host-app";
import { createOutboundQueue, type OutboundQueue } from "./outbound-queue";
import { claimRoot, releaseRoot } from "./root-registry";

/** Internal mount options used by tests for adapter injection. */
/** @deprecated Use CreateRichTextHostOptions — adapterFactory is public. */
export type CreateRichTextHostInternalOptions = CreateRichTextHostOptions;

export function createRichTextHost(options: CreateRichTextHostOptions): RichTextHost {
  return createRichTextHostInternal(options);
}

export function createRichTextHostInternal(options: CreateRichTextHostOptions): RichTextHost {
  if (!(options.root instanceof HTMLElement)) {
    throw new Error("createRichTextHost requires an HTMLElement root.");
  }

  if (
    options.transport === null ||
    typeof options.transport !== "object" ||
    typeof options.transport.send !== "function" ||
    typeof options.transport.subscribe !== "function" ||
    typeof options.transport.destroy !== "function"
  ) {
    throw new Error("createRichTextHost requires a HostTransport.");
  }

  const maxPending =
    options.maxPendingCommands === undefined
      ? DEFAULT_MAX_PENDING_COMMANDS
      : options.maxPendingCommands;

  if (!Number.isInteger(maxPending) || maxPending < 1) {
    throw new Error("maxPendingCommands must be a positive integer.");
  }

  const root = options.root;
  const transport: HostTransport = options.transport;
  const onErrorOption = options.onError;

  let state: HostLifecycleState = "mounting";
  let generation = 0;
  const generationAtStart = generation;
  let editor: CoreRichTextEditor | undefined;
  let eventBridge: EditorEventBridge | undefined;
  let mountedApp: MountedHostApp | undefined;
  let unsubscribeTransport: (() => void) | undefined;
  let readySettled = false;
  let resolveReady!: () => void;
  let rejectReady!: (error: Error) => void;

  const pendingCommands: EditorCommandMessage[] = [];
  const cleanupStack: Array<() => void> = [];

  const ready = new Promise<void>((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });
  // Absorb rejection when nobody awaits (e.g. sync destroy before await).
  ready.catch(() => undefined);

  const reportError = (error: RichTextHostError): void => {
    if (!onErrorOption) {
      return;
    }

    try {
      onErrorOption(error);
    } catch {
      // onError must never block lifecycle
    }
  };

  const host: RichTextHost = {
    ready,
    requestClose() {
      if (state !== "ready" || !editor) {
        return;
      }

      try {
        enqueueEncoded(encodeProtocolMessage(createProtocolRequestCloseEvent()));
      } catch {
        reportError(
          createHostError("event", "encode_failed", "Failed to encode request_close event."),
        );
      }
    },
    requestEmoji(selection) {
      if (state !== "ready" || !editor) {
        return;
      }

      try {
        enqueueEncoded(encodeProtocolMessage(createProtocolRequestEmojiEvent(selection)));
      } catch {
        reportError(
          createHostError("event", "encode_failed", "Failed to encode request_emoji event."),
        );
      }
    },
    requestMention(selection) {
      if (state !== "ready" || !editor) {
        return;
      }

      try {
        enqueueEncoded(encodeProtocolMessage(createProtocolRequestMentionEvent(selection)));
      } catch {
        reportError(
          createHostError("event", "encode_failed", "Failed to encode request_mention event."),
        );
      }
    },
    requestChannel(selection) {
      if (state !== "ready" || !editor) {
        return;
      }

      try {
        enqueueEncoded(encodeProtocolMessage(createProtocolRequestChannelEvent(selection)));
      } catch {
        reportError(
          createHostError("event", "encode_failed", "Failed to encode request_channel event."),
        );
      }
    },
    requestImage(selection) {
      if (state !== "ready" || !editor) {
        return;
      }

      try {
        enqueueEncoded(encodeProtocolMessage(createProtocolRequestImageEvent(selection)));
      } catch {
        reportError(
          createHostError("event", "encode_failed", "Failed to encode request_image event."),
        );
      }
    },
    destroy() {
      if (state === "destroyed" || state === "failed") {
        return;
      }

      failOrDestroy("destroyed", createHostError("destroy", "destroyed", "Host was destroyed."));
    },
  };

  // Registry claim is the first ownership step and must be released in finally.
  try {
    claimRoot(root, host);
  } catch (error) {
    throw error instanceof Error ? error : new Error("Failed to claim host root.");
  }

  const outbound: OutboundQueue = createOutboundQueue(transport, reportError);

  const enqueueEncoded = (message: string): void => {
    if (state === "destroyed" || state === "failed") {
      return;
    }
    outbound.enqueue(message);
  };

  const enqueueResponse = (response: EditorResponseMessage): void => {
    try {
      enqueueEncoded(encodeProtocolMessage(response));
    } catch {
      reportError(
        createHostError("dispatch", "encode_failed", "Failed to encode command response."),
      );
    }
  };

  const runCommand = (command: EditorCommandMessage): void => {
    if (!editor || state === "destroyed" || state === "failed") {
      return;
    }

    try {
      const response = dispatchEditorCommand(editor, command, options.uiController);
      enqueueResponse(response);
    } catch {
      reportError(createHostError("dispatch", "command_failed", "Editor command dispatch failed."));
      enqueueResponse({
        version: command.version,
        kind: "response",
        id: command.id,
        ok: false,
        error: {
          code: "command_failed",
          message: "Editor command failed.",
        },
      });
    }
  };

  const handleInbound = (raw: unknown): void => {
    if (state === "destroyed" || state === "failed") {
      return;
    }

    const result = processInboundMessage(raw);

    switch (result.kind) {
      case "ignored":
        reportError(result.error);
        return;

      case "validation_failure":
        reportError(result.error);
        // Only reply while host is accepting work (not destroyed).
        if (state === "mounting" || state === "draining" || state === "ready") {
          enqueueResponse(result.response);
        }
        return;

      case "command": {
        if (state === "ready") {
          runCommand(result.command);
          return;
        }

        // mounting / draining share the same FIFO
        if (pendingCommands.length >= maxPending) {
          enqueueResponse(createEditorNotReadyResponse(result.command.id));
          return;
        }

        pendingCommands.push(result.command);
        return;
      }
    }
  };

  const failOrDestroy = (nextState: "destroyed" | "failed", reason: RichTextHostError): void => {
    if (state === "destroyed" || state === "failed") {
      return;
    }

    state = nextState;
    generation += 1;
    pendingCommands.length = 0;
    outbound.close();

    if (!readySettled) {
      readySettled = true;
      rejectReady(new Error(reason.message));
    }

    runCleanup(reason);
  };

  const runCleanup = (reason: RichTextHostError): void => {
    // 1. state already marked
    // 2. cancel transport subscription
    try {
      unsubscribeTransport?.();
    } catch (error) {
      reportError(toDestroyError(error));
    }
    unsubscribeTransport = undefined;

    // 3. pending FIFO already cleared; outbound already closed
    // 4. remove Core event listeners
    try {
      eventBridge?.dispose();
    } catch (error) {
      reportError(toDestroyError(error));
    }
    eventBridge = undefined;
    editor = undefined;

    // 5. dispose Solid root
    try {
      mountedApp?.dispose();
    } catch (error) {
      reportError(toDestroyError(error));
    }
    mountedApp = undefined;

    // 6. destroy transport
    try {
      transport.destroy();
    } catch (error) {
      reportError(toDestroyError(error));
    }

    // Run any extra cleanup entries
    while (cleanupStack.length > 0) {
      const step = cleanupStack.pop();
      try {
        step?.();
      } catch (error) {
        reportError(toDestroyError(error));
      }
    }

    // Report the terminal reason for mount failures (destroy is intentional).
    if (reason.phase === "mount") {
      reportError(reason);
    }

    // 7. always release registry
    try {
      releaseRoot(root, host);
    } catch {
      // best-effort
    }
  };

  try {
    // Subscribe AFTER outbound/FIFO/handler exist so sync delivery is safe.
    unsubscribeTransport = transport.subscribe(handleInbound);

    mountedApp = mountHostApp(root, {
      adapterFactory: options.adapterFactory,
      renderChrome: options.renderChrome,
      headerElement: options.headerElement,
    });

    void mountedApp.editorReady.then(
      (readyEditor) => {
        // Late resolve guard
        if (generation !== generationAtStart || state !== "mounting") {
          return;
        }

        editor = readyEditor;

        try {
          eventBridge = bindEditorEventBridge(readyEditor, enqueueEncoded, reportError);
          options.onEditorReady?.(readyEditor);

          try {
            enqueueEncoded(encodeProtocolMessage(createProtocolReadyEvent()));
          } catch {
            throw new Error("Failed to encode ready event.");
          }

          state = "draining";

          // Drain until FIFO is truly empty; new commands during drain append to tail.
          while (pendingCommands.length > 0) {
            if (state !== "draining") {
              return;
            }

            const next = pendingCommands.shift();
            if (!next) {
              break;
            }

            runCommand(next);
          }

          if (state !== "draining") {
            return;
          }

          state = "ready";
          if (!readySettled) {
            readySettled = true;
            resolveReady();
          }
        } catch (error) {
          failOrDestroy("failed", toMountError(error));
        }
      },
      (error: unknown) => {
        if (generation !== generationAtStart || state !== "mounting") {
          return;
        }

        failOrDestroy("failed", toMountError(error));
      },
    );
  } catch (error) {
    failOrDestroy("failed", toMountError(error));
  }

  return host;
}
