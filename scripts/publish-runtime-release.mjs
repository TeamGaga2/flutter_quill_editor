import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  ARCHIVE_NAME,
  createArchive,
  makeReleaseMetadata,
  releaseTag,
  validateRuntimeDist,
} from "./runtime-release.mjs";

const root = resolve(new URL("..", import.meta.url).pathname);
const distDir = resolve(root, "apps/webview-runtime/dist");
const outputDir = resolve(root, ".runtime-release");

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function integerEnv(name) {
  const value = Number(required(name));
  if (!Number.isInteger(value) || value <= 0) throw new Error(`${name} must be a positive integer`);
  return value;
}

function apiUrl() {
  const value = process.env.CI_API_V4_URL?.trim() || process.env.TG_RICHTEXT_GITLAB_API?.trim();
  if (!value) throw new Error("CI_API_V4_URL or TG_RICHTEXT_GITLAB_API is required");
  return value.replace(/\/$/, "");
}

function projectId() {
  return encodeURIComponent(required("CI_PROJECT_ID").replace(/^\/+|\/+$/g, ""));
}

async function request(url, options = {}, expectedStatuses = null) {
  const gitlabOrigin = new URL(apiUrl()).origin;
  const method = options.method || "GET";
  let current = new URL(url);
  for (let redirects = 0; ; redirects++) {
    const headers = { ...options.headers };
    if (current.origin === gitlabOrigin) headers["JOB-TOKEN"] = required("CI_JOB_TOKEN");
    const response = await fetch(current, { ...options, headers, redirect: "manual" });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      if (redirects >= 5) throw new Error("GitLab request exceeded the redirect limit");
      if (method !== "GET" && method !== "HEAD") {
        throw new Error(`GitLab unexpectedly redirected ${method} ${current.pathname}`);
      }
      const location = response.headers.get("location");
      if (!location) throw new Error("GitLab redirect did not include a location");
      current = new URL(location, current);
      if (current.protocol !== "https:") throw new Error("GitLab redirect must use HTTPS");
      continue;
    }
    const accepted =
      expectedStatuses ||
      (response.status >= 200 && response.status < 300 ? [response.status] : []);
    if (!accepted.includes(response.status)) {
      throw new Error(`GitLab request failed (${response.status}) for ${current.pathname}`);
    }
    return response;
  }
}

function packageUrl(api, project, tag, name) {
  return `${api}/projects/${project}/packages/generic/webview-runtime/${encodeURIComponent(tag)}/${encodeURIComponent(name)}`;
}

async function uploadAndVerify(url, bytes, contentType) {
  const existing = await request(url, {}, [200, 404]);
  if (existing.status === 200) {
    const existingBytes = new Uint8Array(await existing.arrayBuffer());
    const expected = createHash("sha256").update(bytes).digest("hex");
    const actual = createHash("sha256").update(existingBytes).digest("hex");
    if (expected !== actual)
      throw new Error(`existing package content differs for ${url.split("/").pop()}`);
    return;
  }
  await request(url, {
    method: "PUT",
    headers: { "Content-Type": contentType, "Content-Length": String(bytes.length) },
    body: bytes,
  });
  const downloaded = new Uint8Array(await (await request(url, {}, [200])).arrayBuffer());
  const expected = createHash("sha256").update(bytes).digest("hex");
  const actual = createHash("sha256").update(downloaded).digest("hex");
  if (expected !== actual)
    throw new Error(`uploaded package verification failed for ${url.split("/").pop()}`);
}

async function verifyExistingRelease({
  api,
  project,
  tag,
  sourceCommit,
  archiveUrl,
  metadataUrl,
  shaUrl,
}) {
  const releaseUrl = `${api}/projects/${project}/releases/${encodeURIComponent(tag)}`;
  const response = await request(releaseUrl, {}, [200, 404]);
  if (response.status === 404) return false;
  const release = await response.json();
  if (release.tag_name !== tag) throw new Error("existing GitLab Release has an unexpected tag");
  const links = new Map((release.assets?.links || []).map((link) => [link.name, link.url]));
  for (const [name, url] of [
    [ARCHIVE_NAME, archiveUrl],
    ["runtime-release.json", metadataUrl],
    [`${ARCHIVE_NAME}.sha256`, shaUrl],
  ]) {
    if (links.get(name) !== url) throw new Error(`existing GitLab Release asset differs: ${name}`);
  }
  const tagResponse = await request(
    `${api}/projects/${project}/repository/tags/${encodeURIComponent(tag)}`,
  );
  const tagData = await tagResponse.json();
  const actualCommit = tagData.commit?.id || tagData.target;
  if (actualCommit !== sourceCommit)
    throw new Error("existing GitLab Release tag points to a different commit");
  return true;
}

async function main() {
  const branch = required("CI_COMMIT_BRANCH");
  const sourceCommit = required("CI_COMMIT_SHA").toLowerCase();
  const pipelineId = integerEnv("CI_PIPELINE_ID");
  const pipelineIid = integerEnv("CI_PIPELINE_IID");
  const runtimeVersion = validateRuntimeDist(distDir);
  if (runtimeVersion.sourceCommit !== sourceCommit) {
    throw new Error("runtime-version.json sourceCommit does not match CI_COMMIT_SHA");
  }

  rmSync(outputDir, { recursive: true, force: true });
  mkdirSync(outputDir, { recursive: true });
  const archivePath = resolve(outputDir, ARCHIVE_NAME);
  createArchive(distDir, archivePath);
  const archiveBytes = readFileSync(archivePath);
  const archiveSha256 = createHash("sha256").update(archiveBytes).digest("hex");
  const tag = releaseTag({ branch, pipelineIid });
  const metadata = makeReleaseMetadata({
    branch,
    sourceCommit,
    pipelineId,
    pipelineIid,
    tag,
    archiveSha256,
    runtimeVersion,
  });
  const metadataBytes = Buffer.from(`${JSON.stringify(metadata, null, 2)}\n`, "utf8");
  const shaBytes = Buffer.from(`${archiveSha256}  ${ARCHIVE_NAME}\n`, "utf8");
  const metadataPath = resolve(outputDir, "runtime-release.json");
  const shaPath = resolve(outputDir, `${ARCHIVE_NAME}.sha256`);
  writeFileSync(metadataPath, metadataBytes);
  writeFileSync(shaPath, shaBytes);

  const api = apiUrl();
  const project = projectId();
  const archiveUrl = packageUrl(api, project, tag, ARCHIVE_NAME);
  const metadataUrl = packageUrl(api, project, tag, "runtime-release.json");
  const shaUrl = packageUrl(api, project, tag, `${ARCHIVE_NAME}.sha256`);
  await uploadAndVerify(archiveUrl, archiveBytes, "application/gzip");
  await uploadAndVerify(metadataUrl, metadataBytes, "application/json");
  await uploadAndVerify(shaUrl, shaBytes, "text/plain; charset=utf-8");

  if (
    await verifyExistingRelease({
      api,
      project,
      tag,
      sourceCommit,
      archiveUrl,
      metadataUrl,
      shaUrl,
    })
  ) {
    console.log(`runtime release already published ${tag} (${archiveSha256})`);
    return;
  }
  const releaseResponse = await request(`${api}/projects/${project}/releases`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: `WebView runtime ${branch} #${pipelineIid}`,
      tag_name: tag,
      ref: sourceCommit,
      description: `branch=${branch}\nsourceCommit=${sourceCommit}\npipelineId=${pipelineId}\npipelineIid=${pipelineIid}\narchiveSha256=${archiveSha256}`,
      assets: {
        links: [
          { name: ARCHIVE_NAME, url: archiveUrl, link_type: "package" },
          { name: "runtime-release.json", url: metadataUrl, link_type: "package" },
          { name: `${ARCHIVE_NAME}.sha256`, url: shaUrl, link_type: "package" },
        ],
      },
    }),
  });
  const release = await releaseResponse.json();
  if (release.tag_name !== tag) throw new Error("GitLab created a release with an unexpected tag");
  console.log(`published runtime release ${tag} (${archiveSha256})`);
}

main().catch((error) => {
  console.error(`runtime release failed: ${error.message}`);
  process.exitCode = 1;
});
