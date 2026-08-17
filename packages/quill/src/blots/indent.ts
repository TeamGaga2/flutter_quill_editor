import Quill from "quill";
import { ClassAttributor, Scope } from "parchment";

/** Matches flutter_quill `indentSelection` max level (`indent.value < 5`). */
export const MAX_INDENT_LEVEL = 5;

/**
 * Quill's default indent whitelist is 1–8. Cap at 5 so toolbar indent, Tab, and
 * `formatLine('+1')` all stop at the same Flutter ceiling — further indent is a
 * no-op (keeps the current level, no style jump to Quill's default 3em steps).
 */
class IndentAttributor extends ClassAttributor {
  add(node: HTMLElement, value: string | number): boolean {
    let normalizedValue = 0;
    if (value === "+1" || value === "-1") {
      const indent = this.value(node) || 0;
      normalizedValue = value === "+1" ? indent + 1 : indent - 1;
    } else if (typeof value === "number") {
      normalizedValue = value;
    } else if (typeof value === "string") {
      normalizedValue = Number.parseInt(value, 10) || 0;
    }

    if (normalizedValue <= 0) {
      this.remove(node);
      return true;
    }

    if (normalizedValue > MAX_INDENT_LEVEL) {
      return false;
    }

    return super.add(node, String(normalizedValue));
  }

  canAdd(node: HTMLElement, value: string): boolean {
    return super.canAdd(node, value) || super.canAdd(node, Number.parseInt(value, 10));
  }

  value(node: HTMLElement): number | undefined {
    return Number.parseInt(super.value(node), 10) || undefined;
  }
}

export const IndentClass = new IndentAttributor("indent", "ql-indent", {
  scope: Scope.BLOCK,
  // String whitelist matches `super.add(..., String(level))` / class `ql-indent-N`.
  whitelist: ["1", "2", "3", "4", "5"],
});

export function registerIndentFormat(): void {
  Quill.register(IndentClass, true);
}
