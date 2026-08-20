import {
  createEffect,
  createSignal,
  For,
  onCleanup,
  Show,
  type Component,
  type JSX,
} from "solid-js";
import { Dynamic } from "solid-js/web";
import type { HeaderLevel } from "@teamgaga/richtext-core";
import { IconBody, IconCheck, IconDown, IconH1, IconH2, IconH3 } from "./icons/ToolbarIcons";
import { Tooltip } from "./Tooltip";

export type HeaderStyleValue = "body" | HeaderLevel;

const HEADER_OPTIONS: ReadonlyArray<{
  value: HeaderStyleValue;
  label: string;
  Icon: Component<{ size?: number | string }>;
}> = [
  { value: 1, label: "H1", Icon: IconH1 },
  { value: 2, label: "H2", Icon: IconH2 },
  { value: 3, label: "H3", Icon: IconH3 },
  { value: "body", label: "Body", Icon: IconBody },
];

export type HeaderStyleMenuProps = {
  value: HeaderStyleValue;
  /**
   * Localized trigger label. When set, the trigger shows a custom Tooltip and
   * omits the native `title`; without it the legacy "Header" label/title is
   * kept.
   */
  label?: string;
  disabled?: boolean;
  onSelect(value: HeaderStyleValue): void;
};

function optionFor(value: HeaderStyleValue) {
  return HEADER_OPTIONS.find((option) => option.value === value) ?? HEADER_OPTIONS[3]!;
}

/**
 * Header/body picker that does not steal editor selection.
 *
 * Native `<select>` focuses itself on open and drops the contenteditable caret
 * (reproduced on macOS Chrome). Mirror {@link ToolbarButton}: preventDefault on
 * pointer/mouse down, then apply the format without taking focus.
 *
 * The Tooltip wraps only the trigger button — never the dropdown list — and is
 * suppressed while the menu is open, so hovering a list option can neither
 * re-open the tooltip nor leave its arrow pointing at the trigger instead of
 * the hovered option.
 */
export function HeaderStyleMenu(props: HeaderStyleMenuProps): JSX.Element {
  const [open, setOpen] = createSignal(false);
  const [rootEl, setRootEl] = createSignal<HTMLDivElement | undefined>();

  const close = (): void => {
    setOpen(false);
  };

  createEffect(() => {
    if (!open()) return;

    const onPointerDown = (event: PointerEvent): void => {
      const target = event.target;
      const root = rootEl();
      if (!(target instanceof Node) || !root?.contains(target)) {
        close();
      }
    };
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        close();
      }
    };

    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKeyDown);
    onCleanup(() => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKeyDown);
    });
  });

  const trigger = (
    <button
      type="button"
      class="tg-toolbar-icon-btn"
      aria-label={props.label ?? "Header"}
      title={props.label === undefined ? "Header" : undefined}
      aria-haspopup="listbox"
      aria-expanded={open()}
      data-value={String(props.value)}
      data-open={open() ? "" : undefined}
      disabled={props.disabled}
      tabIndex={-1}
      onClick={() => {
        if (props.disabled) return;
        setOpen((wasOpen) => !wasOpen);
      }}
    >
      <Dynamic component={optionFor(props.value).Icon} size={20} />
      <IconDown size={20} class="tg-toolbar-header-menu__chevron" />
    </button>
  );

  return (
    <div class="tg-toolbar-header-menu" ref={setRootEl}>
      {props.label === undefined ? (
        trigger
      ) : (
        <Tooltip message={props.label} hidden={open}>
          {trigger}
        </Tooltip>
      )}
      <Show when={open()}>
        <div class="tg-toolbar-header-menu__list" role="listbox" aria-label="Header styles">
          <For each={[...HEADER_OPTIONS]}>
            {(option) => (
              <button
                type="button"
                role="option"
                aria-label={option.label}
                aria-selected={props.value === option.value}
                data-active={props.value === option.value ? "" : undefined}
                tabIndex={-1}
                onClick={() => {
                  props.onSelect(option.value);
                  close();
                }}
              >
                <Dynamic component={option.Icon} size={20} />
                <span class="tg-toolbar-header-menu__check">
                  <Show when={props.value === option.value}>
                    <IconCheck width={12} height={20} />
                  </Show>
                </span>
              </button>
            )}
          </For>
        </div>
      </Show>
    </div>
  );
}
