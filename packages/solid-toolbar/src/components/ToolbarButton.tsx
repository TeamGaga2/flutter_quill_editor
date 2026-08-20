import type { JSX, ParentProps } from "solid-js";
import { Tooltip } from "./Tooltip";

export type ToolbarButtonProps = ParentProps<{
  label: string;
  /**
   * Localized tooltip copy. When set, the button is wrapped in the custom
   * Tooltip and the native `title` is omitted; callers without it keep the
   * legacy `title` behavior.
   */
  tooltip?: string;
  active?: boolean;
  disabled?: boolean;
  class?: string;
  onPress(): void;
}>;

export function ToolbarButton(props: ToolbarButtonProps): JSX.Element {
  const button = (
    <button
      type="button"
      class={["tg-toolbar-icon-btn", props.class].filter(Boolean).join(" ")}
      aria-label={props.label}
      title={props.tooltip === undefined ? props.label : undefined}
      aria-pressed={props.active === undefined ? undefined : props.active}
      data-active={props.active ? "" : undefined}
      disabled={props.disabled}
      tabIndex={-1}
      onClick={() => {
        props.onPress();
      }}
    >
      {props.children}
    </button>
  );

  if (props.tooltip === undefined) {
    return button;
  }

  return <Tooltip message={props.tooltip}>{button}</Tooltip>;
}
