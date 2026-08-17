import { describe, expect, it, vi } from "vite-plus/test";

import { expectSnapshotEqual, loadDeltaFixture, MockEditorAdapter } from "../src/index.ts";

describe("loadDeltaFixture", () => {
  it("loads the complete production fixture", () => {
    const fixture = loadDeltaFixture();

    expect(fixture.title).toBeTypeOf("string");
    expect(fixture.content).toHaveLength(65);
    expect(fixture.content.at(-1)?.insert).toBe("\n");
  });

  it("returns an independent copy", () => {
    const first = loadDeltaFixture();
    const second = loadDeltaFixture();

    first.content.length = 0;

    expect(second.content.length).toBeGreaterThan(0);
  });
});

describe("expectSnapshotEqual", () => {
  it("compares normalized snapshots", () => {
    expect(() =>
      expectSnapshotEqual(
        { content: [{ insert: "hello", attributes: {} }, { insert: "\n" }] },
        { content: [{ insert: "hello" }, { insert: "\n" }] },
      ),
    ).not.toThrow();
  });
});

describe("MockEditorAdapter", () => {
  it("stores isolated snapshots, selections, state, and commands", () => {
    const source = { content: [{ insert: "hello\n" }] };
    const adapter = new MockEditorAdapter({ snapshot: source });

    source.content.length = 0;
    adapter.setSelection({ start: 1, end: 2 });
    adapter.execute({ type: "toggle-inline-format", format: "bold" });

    expect(adapter.getSnapshot().content).toEqual([{ insert: "hello\n" }]);
    expect(adapter.getSelection()).toEqual({ start: 1, end: 2 });
    expect(adapter.commands).toEqual([{ type: "toggle-inline-format", format: "bold" }]);
  });

  it("restores the last selection after blur and focus", () => {
    const adapter = new MockEditorAdapter();
    adapter.setSelection({ start: 1, end: 2 });

    adapter.blur();
    expect(adapter.getSelection()).toBeNull();

    adapter.focus();
    expect(adapter.getSelection()).toEqual({ start: 1, end: 2 });
    expect(adapter.getState()).toMatchObject({
      focused: true,
      selection: { start: 1, end: 2 },
    });
  });

  it("emits events and unsubscribes listeners", () => {
    const adapter = new MockEditorAdapter();
    const listener = vi.fn();
    const unsubscribe = adapter.subscribe(listener);

    adapter.emit({ type: "change" });
    unsubscribe();
    adapter.emit({ type: "blur" });

    expect(listener).toHaveBeenCalledOnce();
    expect(listener).toHaveBeenCalledWith({ type: "change" });
  });
});
