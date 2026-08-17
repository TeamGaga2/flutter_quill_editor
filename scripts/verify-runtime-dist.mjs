import { resolve } from "node:path";
import { validateRuntimeDist } from "./runtime-release.mjs";

const distDir = process.argv[2] || resolve("apps/webview-runtime/dist");
const manifest = validateRuntimeDist(distDir);
console.log(
  `runtime dist verified: protocol=${manifest.protocolVersion} hostEnvelope=${manifest.hostEnvelopeVersion} ` +
    `sourceCommit=${manifest.sourceCommit} webEntry=${manifest.webEntry}`,
);
