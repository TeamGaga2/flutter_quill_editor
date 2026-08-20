import { execSync } from "node:child_process";
import { createHash } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite-plus";
import solid from "vite-plugin-solid";

/** Keep in sync with `@teamgaga/richtext-protocol` PROTOCOL_VERSION. */
const PROTOCOL_VERSION = 2;
/** Keep in sync with `@teamgaga/richtext-host-web` HOST_ENVELOPE_VERSION. */
const HOST_ENVELOPE_VERSION = 1;

const rootDir = dirname(fileURLToPath(import.meta.url));

function resolveBuildId(builtAt: string): string {
  return process.env.TG_BUILD_ID?.trim() || builtAt;
}

function resolveBuildAt(): string {
  return process.env.TG_BUILD_AT?.trim() || new Date().toISOString();
}

function resolveSourceCommit(): string | null {
  const envCommit = process.env.TG_SOURCE_COMMIT?.trim();
  if (envCommit) return envCommit;
  try {
    const gitCommit = execSync("git rev-parse HEAD", {
      cwd: rootDir,
      stdio: ["ignore", "pipe", "ignore"],
      encoding: "utf8",
    }).trim();
    return gitCommit || null;
  } catch {
    return null;
  }
}

/**
 * Relative base so Flutter can load dist via file / asset URLs
 * (e.g. `file:///.../index.html` or WebView asset path) without absolute `/assets/...` breakage.
 */
export default defineConfig(() => {
  const builtAt = resolveBuildAt();
  const buildId = resolveBuildId(builtAt);

  return {
    base: "./",
    test: {
      environment: "happy-dom",
    },
    define: {
      __TG_RUNTIME_BUILD_ID__: JSON.stringify(buildId),
    },
    build: {
      rollupOptions: {
        input: {
          main: resolve(rootDir, "index.html"),
          iframe: resolve(rootDir, "iframe.html"),
        },
      },
    },
    plugins: [
      solid(),
      {
        name: "tg-runtime-version",
        apply: "build",
        generateBundle(_options, bundle) {
          // Provisional manifest — finalize-iframe-entry.mjs rewrites webEntry*
          // after hashing / renaming the emitted iframe HTML.
          const iframeAsset = Object.values(bundle).find(
            (item) => item.type === "asset" && item.fileName === "iframe.html",
          );
          let iframeSource = "";
          if (iframeAsset && iframeAsset.type === "asset") {
            if (typeof iframeAsset.source === "string") {
              iframeSource = iframeAsset.source;
            } else if (iframeAsset.source instanceof Uint8Array) {
              iframeSource = Buffer.from(iframeAsset.source).toString("utf8");
            }
          }
          const provisionalHash = iframeSource
            ? createHash("sha256").update(iframeSource).digest("hex")
            : "pending";

          this.emitFile({
            type: "asset",
            fileName: "runtime-version.json",
            source: `${JSON.stringify(
              {
                protocolVersion: PROTOCOL_VERSION,
                hostEnvelopeVersion: HOST_ENVELOPE_VERSION,
                buildId,
                builtAt,
                package: "webview-runtime",
                sourceCommit: resolveSourceCommit(),
                webEntry: "iframe.html",
                webEntrySha256: provisionalHash,
              },
              null,
              2,
            )}\n`,
          });
        },
      },
    ],
  };
});
