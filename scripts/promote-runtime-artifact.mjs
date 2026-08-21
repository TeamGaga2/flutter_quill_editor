import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  ARCHIVE_NAME,
  ARTIFACT_METADATA_NAME,
  runtimeArtifactTag,
  validateRuntimeArtifact,
} from "./runtime-release.mjs";

const root = resolve(new URL("..", import.meta.url).pathname);
const DEFAULT_ARTIFACT_DIR = resolve(root, "runtime-artifact");
const OFFICIAL_REDIRECT_ORIGINS = new Set([
  "https://github.com",
  "https://objects.githubusercontent.com",
  "https://release-assets.githubusercontent.com",
]);
export const DEFAULT_RUNTIME_REPOSITORY = "TeamGaga2/flutter_quill_editor";

export class GitHubRequestError extends Error {
  constructor({ status, method, url }) {
    super(`GitHub request failed (${status}) for ${method} ${url}`);
    this.name = "GitHubRequestError";
    this.status = status;
    this.method = method;
    this.url = url;
  }
}

function required(value, name) {
  const result = value?.trim();
  if (!result) throw new Error(`${name} is required`);
  return result;
}

function repositoryName(value, allowedRepositories) {
  const repository = required(value, "GITHUB_REPOSITORY");
  if (!/^[^/]+\/[^/]+$/.test(repository)) {
    throw new Error("GITHUB_REPOSITORY must be in owner/name form");
  }
  if (!allowedRepositories.has(repository)) {
    throw new Error(`GITHUB_REPOSITORY is not allowlisted: ${repository}`);
  }
  return repository;
}

function apiBase(value) {
  const input = required(value, "GITHUB_API_URL").replace(/\/$/, "");
  const parsed = new URL(input);
  if (parsed.protocol !== "https:") {
    throw new Error("GITHUB_API_URL must use HTTPS");
  }
  return { base: input, origin: parsed.origin };
}

function assertAllowedOrigin(url, apiOrigin) {
  const origin = url.origin;
  if (
    origin !== apiOrigin &&
    origin !== "https://uploads.github.com" &&
    !OFFICIAL_REDIRECT_ORIGINS.has(origin)
  ) {
    throw new Error(`GitHub request has an untrusted origin: ${origin}`);
  }
}

function hasCredentials(url) {
  return url.username.length > 0 || url.password.length > 0;
}

function endpoint(base, repository, path) {
  return `${base}/repos/${repository}${path}`;
}

function bytesEqual(left, right) {
  return Buffer.from(left).equals(Buffer.from(right));
}

function exactCommit(value, label) {
  if (typeof value !== "string" || !/^[0-9a-f]{40}$/i.test(value)) {
    throw new Error(`${label} must be a full commit SHA`);
  }
  return value.toLowerCase();
}

export function createRuntimeArtifactPublisher({
  fetchImpl = globalThis.fetch,
  apiUrl = "https://api.github.com",
  repository,
  token,
  allowedRepositories = [DEFAULT_RUNTIME_REPOSITORY],
  logger = console,
} = {}) {
  if (typeof fetchImpl !== "function") throw new Error("fetch implementation is required");
  const { base, origin: apiOrigin } = apiBase(apiUrl);
  const repositoryValue = repositoryName(repository, new Set(allowedRepositories));
  const tokenValue = required(token, "GITHUB_TOKEN");

  async function request(url, options = {}, expectedStatuses = null) {
    const method = options.method || "GET";
    const initial = new URL(url);
    let current = initial;
    // A credential may follow same-origin redirects, but once a request has
    // crossed to an official asset host it must never be re-attached when a
    // redirect happens to return to the API origin.  This prevents a signed
    // GitHub asset URL (or a test double) from becoming a token exfiltration
    // hop.
    let crossedOrigin = false;
    for (let redirects = 0; ; redirects += 1) {
      assertAllowedOrigin(current, apiOrigin);
      if (hasCredentials(current))
        throw new Error("GitHub request URL must not contain credentials");
      const headers = Object.fromEntries(
        Object.entries(options.headers || {}).filter(
          ([name]) => name.toLowerCase() !== "authorization",
        ),
      );
      const shouldAttachToken =
        !crossedOrigin &&
        ((initial.origin === apiOrigin && current.origin === apiOrigin) ||
          (initial.origin === "https://uploads.github.com" &&
            current.origin === "https://uploads.github.com"));
      if (shouldAttachToken) headers.Authorization = `Bearer ${tokenValue}`;
      const response = await fetchImpl(current, {
        ...options,
        headers,
        redirect: "manual",
      });
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        if (method !== "GET" && method !== "HEAD") {
          throw new Error(`GitHub unexpectedly redirected ${method} ${current.pathname}`);
        }
        if (redirects >= 5) throw new Error("GitHub request exceeded the redirect limit");
        const location = response.headers.get("location");
        if (!location) throw new Error("GitHub redirect did not include a location");
        const next = new URL(location, current);
        if (next.protocol !== "https:") throw new Error("GitHub redirect must use HTTPS");
        assertAllowedOrigin(next, apiOrigin);
        if (next.origin !== initial.origin) crossedOrigin = true;
        current = next;
        continue;
      }
      const accepted = expectedStatuses || (response.ok ? [response.status] : []);
      if (!accepted.includes(response.status)) {
        throw new GitHubRequestError({ status: response.status, method, url: current.toString() });
      }
      return response;
    }
  }

  async function releaseByTag(tag) {
    const response = await request(
      endpoint(base, repositoryValue, `/releases/tags/${encodeURIComponent(tag)}`),
      {},
      [200, 404],
    );
    if (response.status === 404) return null;
    const release = await response.json();
    if (release?.tag_name !== tag) throw new Error("GitHub returned an unexpected tag");
    return release;
  }

  async function tagTargetCommit(tag) {
    const response = await request(
      endpoint(base, repositoryValue, `/git/ref/tags/${encodeURIComponent(tag)}`),
      {},
      [200, 404],
    );
    if (response.status === 404) return null;
    const ref = await response.json();
    if (ref?.ref !== `refs/tags/${tag}` || typeof ref.object?.sha !== "string") {
      throw new Error("GitHub returned an invalid exact artifact tag ref");
    }
    if (ref.object.type === "commit") return exactCommit(ref.object.sha, "tag commit");
    if (ref.object.type !== "tag")
      throw new Error("runtime artifact tag does not point to a commit");

    const annotatedSha = exactCommit(ref.object.sha, "annotated tag object");
    const tagResponse = await request(endpoint(base, repositoryValue, `/git/tags/${annotatedSha}`));
    const annotated = await tagResponse.json();
    if (annotated?.object?.type !== "commit" || typeof annotated.object.sha !== "string") {
      throw new Error("runtime artifact annotated tag does not point to a commit");
    }
    return exactCommit(annotated.object.sha, "annotated tag commit");
  }

  async function assetBytes(asset) {
    if (!asset || typeof asset.url !== "string") {
      throw new Error("GitHub Release asset URL is invalid");
    }
    const response = await request(asset.url, {
      headers: { Accept: "application/octet-stream" },
    });
    return Buffer.from(await response.arrayBuffer());
  }

  function assetMap(release) {
    const assets = new Map();
    if (!Array.isArray(release?.assets)) throw new Error("GitHub Release assets are invalid");
    for (const asset of release.assets) {
      if (typeof asset?.name !== "string" || assets.has(asset.name)) {
        throw new Error("GitHub Release contains duplicate or invalid asset names");
      }
      assets.set(asset.name, asset);
    }
    return assets;
  }

  function assertExpectedAssetNames(release, expected) {
    const assets = assetMap(release);
    const expectedNames = new Set(expected.map(([name]) => name));
    if ([...assets.keys()].some((name) => !expectedNames.has(name))) {
      throw new Error("GitHub Release contains an unexpected runtime artifact asset");
    }
  }

  async function verifyReleaseAssets(release, expected) {
    const assets = assetMap(release);
    const expectedNames = new Set(expected.map(([name]) => name));
    if (
      assets.size !== expectedNames.size ||
      [...assets.keys()].some((name) => !expectedNames.has(name))
    ) {
      throw new Error("GitHub Release must contain exactly the three runtime artifact assets");
    }
    for (const [name, bytes] of expected) {
      const asset = assets.get(name);
      if (!asset) throw new Error(`GitHub Release is missing asset: ${name}`);
      if (!bytesEqual(await assetBytes(asset), bytes)) {
        throw new Error(`existing GitHub Release asset differs: ${name}`);
      }
    }
  }

  async function uploadAsset(uploadUrl, name, bytes, contentType) {
    const url = new URL(uploadUrl.replace(/\{.*\}$/, ""));
    if (url.origin !== apiOrigin && url.origin !== "https://uploads.github.com") {
      throw new Error(`GitHub upload URL has an untrusted origin: ${url.origin}`);
    }
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
    if (asset?.name !== name) throw new Error(`GitHub uploaded an unexpected asset: ${name}`);
    return asset;
  }

  async function ensureAsset(release, name, bytes, contentType) {
    const existing = assetMap(release).get(name);
    if (existing) {
      if (!bytesEqual(await assetBytes(existing), bytes)) {
        throw new Error(`existing GitHub Release asset differs: ${name}`);
      }
      return;
    }
    if (release.draft !== true) {
      throw new Error(`published GitHub Release is missing asset: ${name}`);
    }
    const asset = await uploadAsset(release.upload_url, name, bytes, contentType);
    release.assets = [...release.assets, asset];
  }

  async function assertReleaseIdentity(release, tag, sourceCommit) {
    if (release?.tag_name !== tag) throw new Error("GitHub Release has an unexpected tag");
    if (
      release.target_commitish &&
      (typeof release.target_commitish !== "string" ||
        release.target_commitish.toLowerCase() !== sourceCommit)
    ) {
      throw new Error("GitHub Release points to a different commit");
    }
    const tagCommit = await tagTargetCommit(tag);
    if (tagCommit !== sourceCommit) {
      throw new Error("GitHub artifact tag does not point to sourceCommit");
    }
  }

  async function createDraftRelease(tag, metadata) {
    try {
      const response = await request(endpoint(base, repositoryValue, "/releases"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: `WebView runtime artifact ${metadata.sourceCommit}`,
          tag_name: tag,
          target_commitish: metadata.sourceCommit,
          draft: true,
          prerelease: false,
          body:
            `sourceCommit=${metadata.sourceCommit}\n` +
            `buildId=${metadata.buildId}\n` +
            `archiveSha256=${metadata.archiveSha256}\n` +
            `contentSha256=${metadata.contentSha256}\n` +
            `protocolVersion=${metadata.protocolVersion}\n` +
            `hostEnvelopeVersion=${metadata.hostEnvelopeVersion}`,
        }),
      });
      return await response.json();
    } catch (error) {
      if (!(error instanceof GitHubRequestError) || error.status !== 422) throw error;
      const raced = await releaseByTag(tag);
      if (!raced) throw error;
      logger.log(`runtime artifact promotion observed a concurrent Release for ${tag}`);
      return raced;
    }
  }

  async function promote({ sourceCommit, artifactDir }) {
    const normalizedSourceCommit = required(sourceCommit, "TG_SOURCE_COMMIT");
    const tag = runtimeArtifactTag(normalizedSourceCommit);
    const directory = artifactDir || DEFAULT_ARTIFACT_DIR;
    const metadata = validateRuntimeArtifact(directory, normalizedSourceCommit);
    const expected = [
      [ARCHIVE_NAME, readFileSync(resolve(directory, ARCHIVE_NAME))],
      [ARTIFACT_METADATA_NAME, readFileSync(resolve(directory, ARTIFACT_METADATA_NAME))],
      [`${ARCHIVE_NAME}.sha256`, readFileSync(resolve(directory, `${ARCHIVE_NAME}.sha256`))],
    ];

    const initialTagCommit = await tagTargetCommit(tag);
    if (initialTagCommit && initialTagCommit !== normalizedSourceCommit) {
      throw new Error("existing artifact tag points to a different commit");
    }
    let release = await releaseByTag(tag);
    if (!release) release = await createDraftRelease(tag, metadata);
    await assertReleaseIdentity(release, tag, normalizedSourceCommit);
    if (release.draft !== true) {
      await verifyReleaseAssets(release, expected);
      logger.log(`runtime artifact already published ${tag} (${metadata.archiveSha256})`);
      return { tag, metadata, alreadyPublished: true };
    }
    if (typeof release.upload_url !== "string") {
      throw new Error("GitHub draft Release did not include an upload URL");
    }
    assertExpectedAssetNames(release, expected);
    await ensureAsset(release, ARCHIVE_NAME, expected[0][1], "application/gzip");
    await ensureAsset(release, ARTIFACT_METADATA_NAME, expected[1][1], "application/json");
    await ensureAsset(
      release,
      `${ARCHIVE_NAME}.sha256`,
      expected[2][1],
      "text/plain; charset=utf-8",
    );
    await verifyReleaseAssets(release, expected);

    await request(endpoint(base, repositoryValue, `/releases/${release.id}`), {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ draft: false }),
    });
    // Do not trust the PATCH response as the publication read-after-write
    // boundary. Re-read by exact tag so a stale or partial response cannot
    // make promotion report success before GitHub exposes all assets.
    const published = await releaseByTag(tag);
    if (!published) throw new Error("GitHub Release disappeared after publication");
    if (published.draft !== false) throw new Error("GitHub Release could not be published");
    await assertReleaseIdentity(published, tag, normalizedSourceCommit);
    await verifyReleaseAssets(published, expected);
    logger.log(
      `published runtime artifact ${tag} ` +
        `(archiveSha256=${metadata.archiveSha256} contentSha256=${metadata.contentSha256})`,
    );
    return { tag, metadata, alreadyPublished: false };
  }

  return { promote, request, releaseByTag, tagTargetCommit };
}

export async function promoteRuntimeArtifact(options = {}) {
  const publisher = createRuntimeArtifactPublisher(options);
  return publisher.promote({
    sourceCommit: options.sourceCommit,
    artifactDir: options.artifactDir,
  });
}

async function main() {
  const publisher = createRuntimeArtifactPublisher({
    apiUrl: process.env.GITHUB_API_URL || "https://api.github.com",
    repository: process.env.GITHUB_REPOSITORY,
    token: process.env.GITHUB_TOKEN,
  });
  await publisher.promote({
    sourceCommit: process.env.TG_SOURCE_COMMIT,
    artifactDir: process.env.TG_ARTIFACT_DIR || DEFAULT_ARTIFACT_DIR,
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`runtime artifact promotion failed: ${error.message}`);
    process.exitCode = 1;
  });
}
