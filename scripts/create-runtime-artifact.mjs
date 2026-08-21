import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { createRuntimeArtifact } from "./runtime-release.mjs";

const root = resolve(new URL("..", import.meta.url).pathname);
const distDir = resolve(process.env.TG_RUNTIME_DIST || resolve(root, "apps/webview-runtime/dist"));
const outputDir = resolve(process.env.TG_ARTIFACT_DIR || resolve(root, "runtime-artifact"));
const expectedSourceCommit = process.env.TG_SOURCE_COMMIT?.trim() || null;

if (expectedSourceCommit) {
  const checkoutCommit = execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: root,
    encoding: "utf8",
  }).trim();
  if (checkoutCommit !== expectedSourceCommit) {
    throw new Error("checkout HEAD does not match TG_SOURCE_COMMIT");
  }
}

const artifact = createRuntimeArtifact({ distDir, outputDir, sourceCommit: expectedSourceCommit });
console.log(
  `runtime artifact created: sourceCommit=${artifact.metadata.sourceCommit} ` +
    `archiveSha256=${artifact.archiveSha256} contentSha256=${artifact.contentSha256}`,
);
