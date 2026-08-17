import { mergeProps, splitProps, type Component, type JSX } from "solid-js";

type NativeSvgProps = JSX.SvgSVGAttributes<SVGSVGElement>;

export interface IconProps extends Omit<NativeSvgProps, "children"> {
  /**
   * 同时控制 width 和 height。
   *
   * 如果显式传入 width 或 height，
   * 对应属性会覆盖 size。
   */
  size?: number | string;

  /**
   * 图标的无障碍标题。
   *
   * 不传时，图标会被视为纯装饰图标。
   */
  title?: string;
}

interface IconBaseProps extends IconProps {
  children: JSX.Element;
}

export const IconBase: Component<IconBaseProps> = (rawProps) => {
  const props = mergeProps(
    {
      size: 20,
      viewBox: "0 0 24 24",
      fill: "none",
      xmlns: "http://www.w3.org/2000/svg",
    },
    rawProps,
  );

  const [local, svgProps] = splitProps(props, ["size", "width", "height", "title", "children"]);

  const hasTitle = () => Boolean(local.title);

  return (
    <svg
      width={local.width ?? local.size}
      height={local.height ?? local.size}
      role={hasTitle() ? "img" : undefined}
      aria-hidden={hasTitle() ? undefined : true}
      {...svgProps}
    >
      {local.title && <title>{local.title}</title>}
      {local.children}
    </svg>
  );
};
