import type { RichTextHost } from "../types";

const activeRoots = new WeakMap<HTMLElement, RichTextHost>();

export function claimRoot(root: HTMLElement, host: RichTextHost): void {
  if (activeRoots.has(root)) {
    throw new Error("A RichTextHost is already mounted on this root.");
  }

  activeRoots.set(root, host);
}

export function releaseRoot(root: HTMLElement, host: RichTextHost): void {
  if (activeRoots.get(root) === host) {
    activeRoots.delete(root);
  }
}

export function getActiveHost(root: HTMLElement): RichTextHost | undefined {
  return activeRoots.get(root);
}
