/**
 * Post-build: inject the canonical transport bootstrap into dist/index.html.
 *
 * Why: the production Flutter shell re-injects the bootstrap via
 * `runJavaScript` on page start/finish, but a classic inline script in
 * index.html is kept as a race-safety backstop so `__TG_RICHTEXT_CONFIG__`
 * and `__TG_RICHTEXT_CREATE_TRANSPORT__` exist before the module entry boots.
 *
 * Source of truth: scripts/flutter-inject-template.js (the IIFE body).
 * Flutter keeps its own copy in lockstep:
 *   teamgaga-client/app/lib/richtext_webview/bridge/webview_flutter_transport.dart
 *
 * Idempotent: skips when the marker is already present, so re-running the
 * build never double-injects.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const templatePath = resolve(root, "scripts/flutter-inject-template.js");
const htmlPath = resolve(root, "dist/index.html");

const template = readFileSync(templatePath, "utf8");
const start = template.indexOf("(function injectTeamGagaRichTextBridge()");
const endMarker = "})();";
const end = template.lastIndexOf(endMarker) + endMarker.length;
if (start < 0 || end <= start) {
  throw new Error("inject-bootstrap: IIFE body not found in scripts/flutter-inject-template.js");
}
const iife = template.slice(start, end);
if (iife.includes("__TG_RICHTEXT_THEME__")) {
  throw new Error(
    "inject-bootstrap: template contains unresolved __TG_RICHTEXT_THEME__ placeholder",
  );
}

const html = readFileSync(htmlPath, "utf8");
const titleTag = "<title>TeamGaga Rich Text</title>";
if (!html.includes(titleTag)) {
  throw new Error("inject-bootstrap: <title> not found in dist/index.html");
}

const marker = `${titleTag}\n    <script>\n`;
if (html.includes(marker)) {
  console.log("inject-bootstrap: bootstrap already present, skipping");
} else {
  writeFileSync(htmlPath, html.replace(titleTag, `${marker}${iife}\n    </script>`));
  console.log("inject-bootstrap: injected transport bootstrap into dist/index.html");
}
