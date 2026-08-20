import {
  createEffect,
  createSignal,
  onCleanup,
  Show,
  type Accessor,
  type JSX,
  type ParentProps,
} from "solid-js";
import { computeBottomTooltipLayout } from "./tooltip-layout";

export type TooltipProps = ParentProps<{
  /** Localized text shown below the trigger. */
  message: string;
  /**
   * While true, the tooltip never shows — used to keep it away from content
   * that appears below the trigger while it is open (e.g. the header menu).
   */
  hidden?: boolean | Accessor<boolean>;
}>;

/**
 * Minimal internal tooltip for the desktop toolbar.
 *
 * Owns show/hide state (hover, focus-within, pointer-down suppression) and
 * Ant Design–style edge shift for the bottom placement: when the bubble would
 * leave the viewport it shifts and moves the arrow; when the trigger is far
 * off-screen the bubble scrolls out with it. Events bind on the wrapper so a
 * disabled trigger still opens through its non-disabled container; content
 * never captures pointer events.
 *
 * DOM:
 *   span.tg-toolbar-tooltip
 *   ├── trigger (existing button / menu)
 *   └── span.tg-toolbar-tooltip__content[role=tooltip] (when open)
 */
export function Tooltip(props: TooltipProps): JSX.Element {
  const [hovered, setHovered] = createSignal(false);
  const [focused, setFocused] = createSignal(false);
  const [suppressed, setSuppressed] = createSignal(false);
  const [rootEl, setRootEl] = createSignal<HTMLSpanElement | undefined>();
  const [contentEl, setContentEl] = createSignal<HTMLSpanElement | undefined>();
  const [contentStyle, setContentStyle] = createSignal<JSX.CSSProperties>({});

  const hidden = (): boolean => {
    const value = props.hidden;
    return typeof value === "function" ? value() : Boolean(value);
  };
  const open = (): boolean => !suppressed() && !hidden() && (hovered() || focused());

  createEffect(() => {
    const root = rootEl();
    const content = contentEl();
    if (!open() || !root || !content) return;

    const applyLayout = (): void => {
      const trigger = root.getBoundingClientRect();
      // offsetWidth is transform-independent, so we can recompute without
      // clearing the previous shift (avoids a one-frame flicker).
      const layout = computeBottomTooltipLayout({
        trigger,
        contentSize: { width: content.offsetWidth, height: content.offsetHeight },
        viewport: { width: window.innerWidth, height: window.innerHeight },
      });
      const contentWidth = content.offsetWidth;
      const triggerCenterX = trigger.left + trigger.width / 2;
      const left = triggerCenterX - contentWidth / 2 + layout.shiftX;
      const top = trigger.bottom + 6;

      setContentStyle({
        position: "fixed",
        top: `${Math.round(top)}px`,
        left: `${Math.round(left)}px`,
        transform: "none",
        "margin-left": "0px",
        "--tg-tooltip-shift-x": `${layout.shiftX}px`,
        "--tg-tooltip-arrow-x": `${layout.arrowX}px`,
        "z-index": "1000",
      });
    };

    applyLayout();
    // Second pass after paint covers font/layout settling in the first frame.
    const frame = requestAnimationFrame(applyLayout);
    window.addEventListener("resize", applyLayout);
    // Capture scroll from nested overflow containers (editor shell, etc.).
    window.addEventListener("scroll", applyLayout, true);
    onCleanup(() => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", applyLayout);
      window.removeEventListener("scroll", applyLayout, true);
    });
  });

  return (
    <span
      ref={setRootEl}
      class="tg-toolbar-tooltip"
      on:pointerenter={() => {
        setHovered(true);
        setSuppressed(false);
      }}
      on:pointerleave={() => {
        setHovered(false);
      }}
      on:focusin={() => {
        setFocused(true);
      }}
      on:focusout={() => {
        setFocused(false);
      }}
      on:pointerdown={() => {
        // Close for the current interaction (e.g. before the header menu
        // opens) and stay closed until the pointer genuinely re-enters.
        setHovered(false);
        setSuppressed(true);
      }}
    >
      {props.children}
      <Show when={open()}>
        <span
          ref={setContentEl}
          class="tg-toolbar-tooltip__content"
          style={contentStyle()}
          role="tooltip"
        >
          {props.message}
        </span>
      </Show>
    </span>
  );
}
