import type { HostTransport } from "../bridge/transport";
import { createHostError, type RichTextHostError } from "../errors";

export interface OutboundQueue {
  enqueue(message: string): void;
  close(): void;
}

export function createOutboundQueue(
  transport: HostTransport,
  onError: (error: RichTextHostError) => void,
): OutboundQueue {
  const pending: string[] = [];
  let closed = false;
  let draining = false;
  let inFlight: Promise<void> | undefined;

  const reportSendError = (error: unknown): void => {
    onError(
      createHostError(
        "send",
        "send_failed",
        error instanceof Error && error.message.trim().length > 0
          ? "Transport send failed."
          : "Transport send failed.",
      ),
    );
  };

  const pump = (): void => {
    if (draining || closed) {
      return;
    }

    const next = pending.shift();
    if (next === undefined) {
      return;
    }

    draining = true;

    try {
      const result = transport.send(next);

      if (result === undefined) {
        draining = false;
        pump();
        return;
      }

      const flight = Promise.resolve(result).then(
        () => undefined,
        (error: unknown) => {
          reportSendError(error);
        },
      );

      inFlight = flight;
      void flight.finally(() => {
        if (inFlight === flight) {
          inFlight = undefined;
        }
        draining = false;
        if (!closed) {
          pump();
        }
      });
    } catch (error) {
      reportSendError(error);
      draining = false;
      if (!closed) {
        pump();
      }
    }
  };

  return {
    enqueue(message) {
      if (closed) {
        return;
      }

      pending.push(message);
      pump();
    },

    close() {
      if (closed) {
        return;
      }

      closed = true;
      pending.length = 0;
      // In-flight send is absorbed; late resolve/reject must not re-enter pump.
    },
  };
}
