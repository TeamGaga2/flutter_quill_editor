/**
 * Post-build: rename dist/iframe.html → iframe.<sha256>.html and rewrite
 * runtime-version.json webEntry / webEntrySha256 to match (ADR-0010).
 */
import { createHash } from "node:crypto";
import {
  readFileSync,
  renameSync,
  writeFileSync,
  existsSync,
  readdirSync,
  unlinkSync,
} from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const distDir = resolve(root, "dist");
const iframePath = resolve(distDir, "iframe.html");
const manifestPath = resolve(distDir, "runtime-version.json");

if (!existsSync(iframePath)) {
  throw new Error("finalize-iframe-entry: dist/iframe.html is missing");
}
if (!existsSync(manifestPath)) {
  throw new Error("finalize-iframe-entry: dist/runtime-version.json is missing");
}

// Drop obsolete content-addressed iframe entries from prior builds.
for (const name of readdirSync(distDir)) {
  if (/^iframe\.[a-f0-9]+\.html$/i.test(name)) {
    unlinkSync(resolve(distDir, name));
  }
}

const html = readFileSync(iframePath, "utf8");
const sha256 = createHash("sha256").update(html).digest("hex");
const shortHash = sha256.slice(0, 16);
const webEntry = `iframe.${shortHash}.html`;
const webEntryPath = resolve(distDir, webEntry);

renameSync(iframePath, webEntryPath);

const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
manifest.webEntry = webEntry;
manifest.webEntrySha256 = sha256;
writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

console.log(`finalize-iframe-entry: wrote ${webEntry} (sha256=${sha256.slice(0, 12)}…)`);
