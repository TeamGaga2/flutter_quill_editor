/**
 * Viewport-aware layout for bottom-placed toolbar tooltips.
 *
 * Mirrors Ant Design Tooltip "Auto Shift" for a single `bottom` placement:
 * - Prefer content centered on the trigger.
 * - When the bubble would leave the viewport, shift it back in and move the
 *   arrow so it still aims at the trigger center.
 * - When the trigger itself is too far off-screen (`limitShift`), stop clamping
 *   to the viewport so the bubble scrolls out with the trigger.
 */

export type RectLike = {
  left: number;
  top: number;
  width: number;
  height: number;
};

export type TooltipLayoutInput = {
  trigger: RectLike;
  contentSize: { width: number; height: number };
  viewport: { width: number; height: number };
  /** Gap kept between bubble and viewport edge. Default 8. */
  padding?: number;
  /** Min distance from bubble side to arrow center (rounded corners). Default 12. */
  arrowPadding?: number;
};

export type TooltipLayout = {
  /** Horizontal offset after centering on the trigger (positive = right). */
  shiftX: number;
  /** Arrow center X relative to the content box left edge, in px. */
  arrowX: number;
};

const DEFAULT_PADDING = 8;
const DEFAULT_ARROW_PADDING = 12;

export function computeBottomTooltipLayout(input: TooltipLayoutInput): TooltipLayout {
  const padding = input.padding ?? DEFAULT_PADDING;
  const arrowPadding = input.arrowPadding ?? DEFAULT_ARROW_PADDING;
  const contentWidth = Math.max(0, input.contentSize.width);
  const triggerCenterX = input.trigger.left + input.trigger.width / 2;
  const idealLeft = triggerCenterX - contentWidth / 2;

  let left = idealLeft;
  const minLeft = padding;
  const maxLeft = input.viewport.width - padding - contentWidth;

  // Viewport shift: keep as much of the bubble on-screen as possible.
  if (contentWidth <= input.viewport.width - 2 * padding) {
    if (left < minLeft) left = minLeft;
    if (left > maxLeft) left = maxLeft;
  } else if (input.viewport.width > 0) {
    // Wider than the usable viewport — pin to the leading padding edge.
    left = minLeft;
  }

  // limitShift: do not shift so far that the arrow cannot aim at the trigger.
  // When the trigger is off-screen, this undoes viewport clamping so the
  // bubble leaves with the trigger ("滚出屏幕").
  const half = contentWidth / 2;
  const arrowMin = Math.min(arrowPadding, half);
  const arrowMax = Math.max(contentWidth - arrowPadding, half);
  const limitMin = triggerCenterX - arrowMax;
  const limitMax = triggerCenterX - arrowMin;
  if (left < limitMin) left = limitMin;
  if (left > limitMax) left = limitMax;

  const shiftX = left - idealLeft;
  const arrowX = clamp(triggerCenterX - left, arrowMin, arrowMax);

  return { shiftX, arrowX };
}

function clamp(value: number, min: number, max: number): number {
  if (value < min) return min;
  if (value > max) return max;
  return value;
}
