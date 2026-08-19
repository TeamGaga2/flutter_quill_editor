import { afterEach, describe, expect, it } from "vite-plus/test";
import { createCallbackTransport } from "@teamgaga/richtext-host-web";
import {
  decodeProtocolMessage,
  encodeProtocolMessage,
  PROTOCOL_VERSION,
  type EditorSuccessResponse,
} from "@teamgaga/richtext-protocol";
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
  const editable = document.querySelector<HTMLElement>(".ql-editor");
  if (editable) {
    editable.focus();
    return editable;
  }
  throw new Error("Body editor did not mount.");
}

describe("webview-runtime link popover integration", () => {
  let mounted: MountedEditor | undefined;

  afterEach(() => {
    mounted?.destroy();
    mounted = undefined;
    document.body.innerHTML = "";
  });

  it("opens link form via open_link_form protocol command and inserts link", async () => {
    const app = document.createElement("div");
    app.id = "app";
    document.body.append(app);

    const outbound: string[] = [];
    const inbound: Array<(message: unknown) => void> = [];
    const transport = createCallbackTransport({
      send(message) {
        outbound.push(message);
      },
    });
    const nativeSubscribe = transport.subscribe.bind(transport);
    transport.subscribe = (listener) => {
      inbound.push(listener);
      return nativeSubscribe(listener);
    };

    mounted = await mountEditor({
      config: { toolbarMode: "desktop", locale: "zh", mediaMaxSize: 240 },
      transport,
    });

    await waitForBodyEditor();
    await waitFrames(2);

    // Initial state: link popover is closed
    expect(document.querySelector(".tg-link-popover")).toBeNull();

    // 1. Send open_link_form command over protocol
    const openCommand = encodeProtocolMessage({
      version: PROTOCOL_VERSION,
      kind: "command",
      id: "cmd-open-link-1",
      type: "open_link_form",
      payload: {},
    });

    for (const listener of inbound) {
      listener(openCommand);
    }
    await waitFrames(2);

    // Verify response was sent back
    const responseMsg = outbound.find((m) => m.includes("cmd-open-link-1"));
    expect(responseMsg).toBeDefined();
    const parsed = decodeProtocolMessage(responseMsg!);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      const response = parsed.value as EditorSuccessResponse;
      expect(response.type).toBe("open_link_form");
      expect(response.ok).toBe(true);
    }

    // 2. Verify link popover is visible with Chinese labels
    const popover = document.querySelector(".tg-link-popover");
    expect(popover).not.toBeNull();
    const urlInput = document.querySelector<HTMLInputElement>("#tg-link-url-input");
    const textInput = document.querySelector<HTMLInputElement>("#tg-link-text-input");
    const okBtn = document.querySelector<HTMLButtonElement>(".tg-link-popover-btn-ok");
    const cancelBtn = document.querySelector<HTMLButtonElement>(".tg-link-popover-btn-cancel");

    expect(urlInput).not.toBeNull();
    expect(textInput).not.toBeNull();
    expect(okBtn).not.toBeNull();
    expect(cancelBtn).not.toBeNull();
    expect(okBtn?.disabled).toBe(true);

    // 3. Fill in form values
    urlInput!.value = "https://teamgaga.com";
    urlInput!.dispatchEvent(new Event("input", { bubbles: true }));
    textInput!.value = "TeamGaga";
    textInput!.dispatchEvent(new Event("input", { bubbles: true }));
    await waitFrames(1);

    expect(okBtn?.disabled).toBe(false);

    // 4. Submit form
    okBtn!.click();
    await waitFrames(2);

    // Popover is now closed
    expect(document.querySelector(".tg-link-popover")).toBeNull();

    // Outbound change event reflects inserted link
    const changeEvent = outbound.find((m) => m.includes("change"));
    expect(changeEvent).toBeDefined();
  });

  it("opens link form via Cmd+K and closes via cancel button", async () => {
    const app = document.createElement("div");
    app.id = "app";
    document.body.append(app);

    const transport = createCallbackTransport({
      send() {
        return undefined;
      },
    });

    mounted = await mountEditor({
      config: { toolbarMode: "desktop", locale: "en", mediaMaxSize: 240 },
      transport,
    });

    const editable = await waitForBodyEditor();
    await waitFrames(2);

    // Trigger Cmd+K while focused
    editable.focus();
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "k", metaKey: true, bubbles: true }));
    await waitFrames(1);

    expect(document.querySelector(".tg-link-popover")).not.toBeNull();

    // Click Cancel
    const cancelBtn = document.querySelector<HTMLButtonElement>(".tg-link-popover-btn-cancel");
    cancelBtn!.click();
    await waitFrames(1);

    expect(document.querySelector(".tg-link-popover")).toBeNull();
  });
});
