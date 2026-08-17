import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, rmSync } from "node:fs";
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
const githubApi = (process.env.GITHUB_API_URL || "https://api.github.com").replace(/\/$/, "");

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

function repository() {
  const value = process.env.GITHUB_REPOSITORY?.trim();
  if (!value || !/^[^/]+\/[^/]+$/.test(value)) {
    throw new Error("GITHUB_REPOSITORY must be in owner/name form");
  }
  return value;
}

function endpoint(path) {
  return `${githubApi}/repos/${repository()}${path}`;
}

function isGitHubOrigin(url) {
  const origin = new URL(url).origin;
  return origin === new URL(githubApi).origin || origin === "https://uploads.github.com";
}

async function request(url, options = {}, expectedStatuses = null) {
  const token = required("GITHUB_TOKEN");
  const method = options.method || "GET";
  let current = new URL(url);
  for (let redirects = 0; ; redirects++) {
    const headers = {
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      ...options.headers,
    };
    if (isGitHubOrigin(current)) headers.Authorization = `Bearer ${token}`;
    const response = await fetch(current, { ...options, headers, redirect: "manual" });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      if (method !== "GET" && method !== "HEAD") {
        throw new Error(`GitHub unexpectedly redirected ${method} ${current.pathname}`);
      }
      if (redirects >= 5) throw new Error("GitHub request exceeded the redirect limit");
      const location = response.headers.get("location");
      if (!location) throw new Error("GitHub redirect did not include a location");
      current = new URL(location, current);
      if (current.protocol !== "https:") throw new Error("GitHub redirect must use HTTPS");
      continue;
    }
    const accepted = expectedStatuses || (response.ok ? [response.status] : []);
    if (!accepted.includes(response.status)) {
      throw new Error(`GitHub request failed (${response.status}) for ${current.pathname}`);
    }
    return response;
  }
}

async function releaseByTag(tag) {
  for (let page = 1; page <= 10; page++) {
    const response = await request(endpoint(`/releases?per_page=100&page=${page}`));
    const releases = await response.json();
    if (!Array.isArray(releases)) throw new Error("GitHub releases response is not an array");
    const match = releases.find((release) => release?.tag_name === tag);
    if (match) return match;
    if (releases.length < 100) return null;
  }
  throw new Error("GitHub runtime Release pagination exceeded the safety limit");
}

async function assetBytes(asset) {
  const response = await request(asset.url, {
    headers: { Accept: "application/octet-stream" },
  });
  return new Uint8Array(await response.arrayBuffer());
}

async function verifyReleaseAssets(release, expected) {
  const assets = new Map((release.assets || []).map((asset) => [asset.name, asset]));
  for (const [name, bytes] of expected) {
    const asset = assets.get(name);
    if (!asset) throw new Error(`GitHub Release is missing asset: ${name}`);
    const actual = createHash("sha256")
      .update(await assetBytes(asset))
      .digest("hex");
    const digest = createHash("sha256").update(bytes).digest("hex");
    if (actual !== digest) throw new Error(`existing GitHub Release asset differs: ${name}`);
  }
}

async function verifyExistingRelease(release, tag, sourceCommit, expected) {
  if (release.tag_name !== tag) throw new Error("existing GitHub Release has an unexpected tag");
  if (release.target_commitish && release.target_commitish !== sourceCommit) {
    throw new Error("existing GitHub Release points to a different commit");
  }
  await verifyReleaseAssets(release, expected);
}

async function uploadAsset(uploadUrl, name, bytes, contentType) {
  const url = new URL(uploadUrl.replace(/\{.*\}$/, ""));
  url.searchParams.set("name", name);
  const response = await request(url, {
    method: "POST",
    headers: {
      "Content-Type": contentType,
      "Content-Length": String(bytes.length),
    },
    body: bytes,
  });
  const asset = await response.json();
  if (asset.name !== name) throw new Error(`GitHub uploaded an unexpected asset: ${name}`);
  return asset;
}

async function ensureAsset(release, name, bytes, contentType) {
  const existing = (release.assets || []).find((asset) => asset.name === name);
  if (existing) {
    const actual = createHash("sha256")
      .update(await assetBytes(existing))
      .digest("hex");
    const expected = createHash("sha256").update(bytes).digest("hex");
    if (actual !== expected) throw new Error(`existing GitHub Release asset differs: ${name}`);
    return;
  }
  const asset = await uploadAsset(release.upload_url, name, bytes, contentType);
  release.assets = [...(release.assets || []), asset];
}

async function main() {
  const branch = required("TG_SOURCE_BRANCH");
  if (branch !== "dev") throw new Error(`runtime Release publishing is not enabled for ${branch}`);
  const sourceCommit = required("TG_SOURCE_COMMIT").toLowerCase();
  const pipelineId = integerEnv("TG_PIPELINE_ID");
  const pipelineIid = integerEnv("TG_PIPELINE_IID");
  const runtimeVersion = validateRuntimeDist(distDir);
  if (runtimeVersion.sourceCommit !== sourceCommit) {
    throw new Error("runtime-version.json sourceCommit does not match TG_SOURCE_COMMIT");
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

  const existing = await releaseByTag(tag);
  let release = existing;
  const expected = [
    [ARCHIVE_NAME, archiveBytes],
    ["runtime-release.json", metadataBytes],
    [`${ARCHIVE_NAME}.sha256`, shaBytes],
  ];
  if (release) {
    await verifyExistingRelease(release, tag, sourceCommit, release.draft ? [] : expected);
  } else {
    const releaseResponse = await request(endpoint("/releases"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: `WebView runtime ${branch} #${pipelineIid}`,
        tag_name: tag,
        target_commitish: sourceCommit,
        draft: true,
        prerelease: false,
        body: `branch=${branch}\nsourceCommit=${sourceCommit}\npipelineId=${pipelineId}\npipelineIid=${pipelineIid}\narchiveSha256=${archiveSha256}`,
      }),
    });
    release = await releaseResponse.json();
  }
  if (release.tag_name !== tag) throw new Error("GitHub created a release with an unexpected tag");
  if (release.draft !== true) {
    console.log(`runtime release already published ${tag} (${archiveSha256})`);
    return;
  }
  if (typeof release.upload_url !== "string")
    throw new Error("GitHub release did not include an upload URL");
  await ensureAsset(release, ARCHIVE_NAME, archiveBytes, "application/gzip");
  await ensureAsset(release, "runtime-release.json", metadataBytes, "application/json");
  await ensureAsset(release, `${ARCHIVE_NAME}.sha256`, shaBytes, "text/plain; charset=utf-8");
  await verifyReleaseAssets(release, expected);
  const publishedResponse = await request(endpoint(`/releases/${release.id}`), {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ draft: false }),
  });
  const published = await publishedResponse.json();
  if (published.draft !== false) throw new Error("GitHub Release could not be published");
  console.log(`published runtime release ${tag} (${archiveSha256})`);
}

main().catch((error) => {
  console.error(`runtime release failed: ${error.message}`);
  process.exitCode = 1;
});
