import { createRuntimeTransport } from "./transport-factory";
import { resolveRuntimeConfig } from "./runtime-config";
import { mountEditor } from "./mount-editor";

/**
 * Native WebView entry: inject-based transport + immediate mount.
 * Flutter Web uses `iframe-bootstrap.ts` instead.
 */
async function bootstrap(): Promise<void> {
  const config = resolveRuntimeConfig();
  const transport = createRuntimeTransport();
  await mountEditor({ config, transport });
}

void bootstrap().catch((error: unknown) => {
  const app = document.querySelector<HTMLDivElement>("#app");
  const message = error instanceof Error ? error.message : "Unknown bootstrap failure.";
  if (!app) {
    console.error(message);
    return;
  }
  app.replaceChildren();
  const container = document.createElement("div");
  container.className = "tg-webview-error";
  container.setAttribute("role", "alert");
  const title = document.createElement("strong");
  title.textContent = "Rich text host failed to start";
  const detail = document.createElement("span");
  detail.textContent = message;
  container.append(title, detail);
  app.append(container);
});
