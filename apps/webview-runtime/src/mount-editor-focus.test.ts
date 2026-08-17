import { afterEach, describe, expect, it } from "vite-plus/test";
import { createCallbackTransport } from "@teamgaga/richtext-host-web";
import { encodeProtocolMessage, PROTOCOL_VERSION } from "@teamgaga/richtext-protocol";
import { mountEditor, type MountedEditor } from "./mount-editor";

function waitFrames(count: number): Promise<void> {
  return new Promise((resolve) => {
    const step = (left: number): void => {
      if (left <= 0) {
        resolve();
        return;
      }
      requestAnimationFrame(() => step(left - 1));
    };
    step(count);
  });
}

async function waitForBodyEditor(): Promise<HTMLElement> {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const editable = document.querySelector<HTMLElement>(".ql-editor");
    if (editable && document.activeElement === editable) {
      return editable;
    }
    await waitFrames(1);
  }
  throw new Error("Body editor did not become the active element.");
}

function encodeFocusCommand(): string {
  return encodeProtocolMessage({
    version: PROTOCOL_VERSION,
    kind: "command",
    id: "init-focus",
    type: "focus",
    payload: {},
  });
}

describe("webview-runtime init focus", () => {
  let mounted: MountedEditor | undefined;

  afterEach(() => {
    mounted?.destroy();
    mounted = undefined;
    document.body.innerHTML = "";
  });

  it("does not blur an already-focused body when the host sends focus after ready", async () => {
    const app = document.createElement("div");
    app.id = "app";
    document.body.append(app);

    const inbound: Array<(message: unknown) => void> = [];
    const transport = createCallbackTransport({
      send() {
        return undefined;
      },
    });
    const nativeSubscribe = transport.subscribe.bind(transport);
    transport.subscribe = (listener) => {
      inbound.push(listener);
      return nativeSubscribe(listener);
    };

    mounted = await mountEditor({
      config: { toolbarMode: "none", mediaMaxSize: 240 },
      transport,
    });

    const editable = await waitForBodyEditor();
    let blurCount = 0;
    editable.addEventListener("blur", () => {
      blurCount += 1;
    });

    for (const listener of inbound) {
      listener(encodeFocusCommand());
    }
    await waitFrames(2);

    expect(blurCount).toBe(0);
    expect(document.activeElement).toBe(editable);
  });

  it("does not blur an already-focused body when the host wakes a live session", async () => {
    const app = document.createElement("div");
    app.id = "app";
    document.body.append(app);

    const transport = createCallbackTransport({
      send() {
        return undefined;
      },
    });

    mounted = await mountEditor({
      config: { toolbarMode: "none", mediaMaxSize: 240 },
      transport,
    });

    const editable = await waitForBodyEditor();
    let blurCount = 0;
    editable.addEventListener("blur", () => {
      blurCount += 1;
    });

    mounted.wakeEditingSession();
    await waitFrames(4);

    expect(blurCount).toBe(0);
    expect(document.activeElement).toBe(editable);
  });

  it("restarts native focus when the host sends focus after the window is backgrounded", async () => {
    const app = document.createElement("div");
    app.id = "app";
    document.body.append(app);

    const inbound: Array<(message: unknown) => void> = [];
    const transport = createCallbackTransport({
      send() {
        return undefined;
      },
    });
    const nativeSubscribe = transport.subscribe.bind(transport);
    transport.subscribe = (listener) => {
      inbound.push(listener);
      return nativeSubscribe(listener);
    };

    mounted = await mountEditor({
      config: { toolbarMode: "none", mediaMaxSize: 240 },
      transport,
    });

    const editable = await waitForBodyEditor();
    let blurCount = 0;
    editable.addEventListener("blur", () => {
      blurCount += 1;
    });

    window.dispatchEvent(new Event("blur"));
    for (const listener of inbound) {
      listener(encodeFocusCommand());
    }
    await waitFrames(2);

    expect(blurCount).toBeGreaterThan(0);
    expect(document.activeElement).toBe(editable);
  });

  it("restarts native focus after the window is backgrounded", async () => {
    const app = document.createElement("div");
    app.id = "app";
    document.body.append(app);

    const transport = createCallbackTransport({
      send() {
        return undefined;
      },
    });

    mounted = await mountEditor({
      config: { toolbarMode: "none", mediaMaxSize: 240 },
      transport,
    });

    const editable = await waitForBodyEditor();
    let blurCount = 0;
    editable.addEventListener("blur", () => {
      blurCount += 1;
    });

    window.dispatchEvent(new Event("blur"));
    mounted.wakeEditingSession();
    await waitFrames(4);

    expect(blurCount).toBeGreaterThan(0);
    expect(document.activeElement).toBe(editable);
  });
});
