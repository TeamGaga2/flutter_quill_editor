import { createEffect, createMemo, on, onCleanup, Show, type JSX } from "solid-js";
import type { LinkPopoverController } from "./types";

export interface LinkPopoverProps {
  controller: LinkPopoverController;
}

export function LinkPopover(props: LinkPopoverProps): JSX.Element {
  let urlInputRef: HTMLInputElement | undefined;

  const isOpen = () => props.controller.isOpen();
  const url = () => props.controller.url();
  const text = () => props.controller.text();
  const labels = () => props.controller.labels();
  const anchor = () => props.controller.anchor();
  const isMobileModal = () => props.controller.isMobileModal();

  createEffect(
    on(
      isOpen,
      (open, prevOpen) => {
        if (open && !prevOpen) {
          const focusInput = (): void => {
            if (urlInputRef && document.activeElement !== urlInputRef) {
              try {
                urlInputRef.focus({ preventScroll: true });
              } catch {
                urlInputRef.focus();
              }
              urlInputRef.select();
            }
          };

          // Synchronous focus attempt in current turn for mobile IME activation
          focusInput();
          // Fallback on next animation frame
          requestAnimationFrame(focusInput);

          const handleGlobalKeyDown = (e: KeyboardEvent): void => {
            if (e.key === "Escape") {
              e.preventDefault();
              props.controller.close();
            }
          };

          window.addEventListener("keydown", handleGlobalKeyDown, true);
          onCleanup(() => {
            window.removeEventListener("keydown", handleGlobalKeyDown, true);
          });
        }
      },
      { defer: true },
    ),
  );

  const positionStyle = createMemo<JSX.CSSProperties>(() => {
    if (isMobileModal()) {
      return {};
    }

    const currentAnchor = anchor();
    const popoverWidth = 360;
    const popoverHeight = 230;
    const viewportWidth = typeof window !== "undefined" ? window.innerWidth : 800;
    const viewportHeight = typeof window !== "undefined" ? window.innerHeight : 600;

    let left = (viewportWidth - popoverWidth) / 2;
    let top = 60;

    if (currentAnchor) {
      // Place below caret / selection by default
      left = currentAnchor.x;
      top = currentAnchor.y + currentAnchor.height + 8;

      // Adjust horizontal overflow
      if (left + popoverWidth > viewportWidth - 16) {
        left = viewportWidth - popoverWidth - 16;
      }
      if (left < 16) {
        left = 16;
      }

      // Adjust vertical overflow
      if (top + popoverHeight > viewportHeight - 16) {
        // Place above anchor if not enough space below
        const aboveTop = currentAnchor.y - popoverHeight - 8;
        if (aboveTop >= 16) {
          top = aboveTop;
        } else {
          top = Math.max(16, viewportHeight - popoverHeight - 16);
        }
      }
    }

    return {
      position: "fixed",
      left: `${Math.round(left)}px`,
      top: `${Math.round(top)}px`,
      "z-index": "1000",
    };
  });

  const handleKeyDown = (e: KeyboardEvent): void => {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      props.controller.close();
    } else if (e.key === "Enter" && !e.shiftKey) {
      if (props.controller.canSubmit()) {
        e.preventDefault();
        e.stopPropagation();
        props.controller.submit();
      }
    }
  };

  return (
    <Show when={isOpen()}>
      <div
        class="tg-link-popover-scrim"
        classList={{ "tg-link-popover-scrim--modal": isMobileModal() }}
        onClick={() => props.controller.close()}
      >
        <div
          class="tg-link-popover"
          classList={{ "tg-link-popover-modal": isMobileModal() }}
          style={positionStyle()}
          role="dialog"
          aria-modal="true"
          aria-label={labels().title}
          onClick={(e) => e.stopPropagation()}
          onKeyDown={handleKeyDown}
        >
          <Show when={isMobileModal()}>
            <div class="tg-link-popover-modal-title">{labels().title}</div>
          </Show>

          <form
            class="tg-link-popover-form"
            onSubmit={(e) => {
              e.preventDefault();
              props.controller.submit();
            }}
          >
            <div class="tg-link-popover-field">
              <input
                id="tg-link-url-input"
                class="tg-link-popover-input"
                type="text"
                autofocus
                aria-label={labels().urlPlaceholder}
                placeholder={labels().urlPlaceholder}
                value={url()}
                onInput={(e) => props.controller.setUrl(e.currentTarget.value)}
                ref={(el) => {
                  urlInputRef = el;
                  if (isOpen()) {
                    try {
                      el.focus({ preventScroll: true });
                    } catch {
                      el.focus();
                    }
                    el.select();
                  }
                }}
              />
            </div>

            <div class="tg-link-popover-field">
              <input
                id="tg-link-text-input"
                class="tg-link-popover-input"
                type="text"
                aria-label={labels().textPlaceholder}
                placeholder={labels().textPlaceholder}
                value={text()}
                onInput={(e) => props.controller.setText(e.currentTarget.value)}
              />
            </div>

            <div class="tg-link-popover-actions">
              <button
                type="button"
                class="tg-link-popover-btn-cancel"
                onClick={() => props.controller.close()}
              >
                {labels().cancel}
              </button>
              <button
                type="submit"
                class="tg-link-popover-btn-ok"
                disabled={!props.controller.canSubmit()}
              >
                {labels().ok}
              </button>
            </div>
          </form>
        </div>
      </div>
    </Show>
  );
}
