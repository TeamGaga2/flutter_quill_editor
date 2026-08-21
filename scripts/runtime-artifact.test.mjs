import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, test } from "vite-plus/test";
import {
  canonicalContentSha256,
  createRuntimeArtifact,
  makeRuntimeArtifactMetadata,
  parseRuntimeArtifactTag,
  runtimeArtifactTag,
  validateRuntimeArtifact,
} from "./runtime-release.mjs";
import { createRuntimeArtifactPublisher } from "./promote-runtime-artifact.mjs";

const fixturePath = resolve(process.cwd(), "scripts/fixtures/runtime-content-sha256.json");

function runtimeDist(root, sourceCommit = "a".repeat(40)) {
  mkdirSync(join(root, "assets"));
  writeFileSync(join(root, "assets", "main.js"), "console.log('ok');\n");
  const iframe = '<script src="./assets/main.js"></script>\n';
  writeFileSync(join(root, "iframe.abc.html"), iframe);
  writeFileSync(join(root, "index.html"), '<iframe src="./iframe.abc.html"></iframe>\n');
  writeFileSync(
    join(root, "runtime-version.json"),
    JSON.stringify({
      protocolVersion: 2,
      hostEnvelopeVersion: 1,
      buildId: sourceCommit,
      builtAt: "2026-01-01T00:00:00.000Z",
      package: "webview-runtime",
      sourceCommit,
      webEntry: "iframe.abc.html",
      webEntrySha256: createHash("sha256").update(iframe).digest("hex"),
    }),
  );
}

function artifactFixture() {
  const distDir = mkdtempSync(join(tmpdir(), "tg-runtime-artifact-dist-"));
  const artifactDir = mkdtempSync(join(tmpdir(), "tg-runtime-artifact-output-"));
  const sourceCommit = "e".repeat(40);
  runtimeDist(distDir, sourceCommit);
  const artifact = createRuntimeArtifact({
    distDir,
    outputDir: artifactDir,
    sourceCommit,
  });
  return {
    distDir,
    artifactDir,
    sourceCommit,
    artifact,
    cleanup: () => {
      rmSync(distDir, { recursive: true, force: true });
      rmSync(artifactDir, { recursive: true, force: true });
    },
  };
}

const mockApiUrl = "https://api.test";
const mockRepository = "acme/editor";

function mockResponse(status, body = null, headers = {}) {
  const bytes = Buffer.isBuffer(body)
    ? body
    : Buffer.from(body === null ? "" : typeof body === "string" ? body : JSON.stringify(body));
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: {
      get(name) {
        return headers[name.toLowerCase()] || null;
      },
    },
    async json() {
      return JSON.parse(bytes.toString("utf8"));
    },
    async arrayBuffer() {
      return bytes;
    },
  };
}

function asset(name, url = `${mockApiUrl}/repos/${mockRepository}/releases/assets/${name}`) {
  return { name, url };
}

function createMockGithub({
  sourceCommit,
  tag,
  releaseResponses = [],
  tagResponses = [],
  assetBytes,
  postStatus = 201,
  postRelease = null,
  redirectAssets = false,
  assetRedirectUrl = null,
  patchResponse = null,
  patchRereadRelease = null,
  missingTagWhileDraft = false,
}) {
  const requests = [];
  const state = {
    releaseResponses: [...releaseResponses],
    tagResponses: [...tagResponses],
    uploaded: new Map(),
    currentRelease: postRelease ? structuredClone(postRelease) : null,
    patchCount: 0,
    postCount: 0,
  };
  const assetPayload = assetBytes || new Map();
  const redirectLocation = (name, fallback) =>
    (assetRedirectUrl || fallback).replace("{name}", encodeURIComponent(name));
  const defaultRelease = postRelease || {
    id: 1,
    tag_name: tag,
    target_commitish: sourceCommit,
    draft: true,
    upload_url: `https://uploads.github.com/repos/${mockRepository}/releases/1/assets{?name}`,
    assets: [],
  };

  const fetchImpl = async (input, options = {}) => {
    const url = new URL(input);
    const method = options.method || "GET";
    requests.push({ url, options });
    if (url.pathname === `/repos/${mockRepository}/git/ref/tags/${tag}`) {
      if (missingTagWhileDraft && state.currentRelease?.draft === true) {
        return mockResponse(404);
      }
      const next =
        state.tagResponses.length > 0
          ? state.tagResponses.shift()
          : state.currentRelease
            ? sourceCommit
            : null;
      if (next === null) return mockResponse(404);
      if (next === "redirect") {
        return mockResponse(200, {
          ref: `refs/tags/${tag}`,
          object: { type: "commit", sha: "f".repeat(40) },
        });
      }
      if (next && typeof next === "object") {
        return mockResponse(200, {
          ref: `refs/tags/${tag}`,
          object: next,
        });
      }
      return mockResponse(200, {
        ref: `refs/tags/${tag}`,
        object: { type: "commit", sha: next },
      });
    }
    if (url.pathname === `/repos/${mockRepository}/git/tags/${"a".repeat(40)}`) {
      return mockResponse(200, {
        object: { type: "commit", sha: sourceCommit },
      });
    }
    if (url.pathname === `/repos/${mockRepository}/releases/tags/${tag}`) {
      const next =
        state.releaseResponses.length > 0 ? state.releaseResponses.shift() : state.currentRelease;
      if (next === null) return mockResponse(404);
      state.currentRelease = structuredClone(next);
      return mockResponse(200, structuredClone(state.currentRelease));
    }
    if (url.pathname === `/repos/${mockRepository}/releases` && method === "POST") {
      state.postCount += 1;
      if (postStatus === 422) return mockResponse(422, { message: "already_exists" });
      state.currentRelease = structuredClone(defaultRelease);
      return mockResponse(postStatus, structuredClone(state.currentRelease));
    }
    if (url.pathname === `/repos/${mockRepository}/releases/1` && method === "PATCH") {
      state.patchCount += 1;
      const patched = structuredClone(state.currentRelease || defaultRelease);
      patched.draft = false;
      const names = [
        "webview-runtime.tar.gz",
        "runtime-artifact.json",
        "webview-runtime.tar.gz.sha256",
      ];
      patched.assets = names.map((name) =>
        asset(name, `${mockApiUrl}/repos/${mockRepository}/releases/assets/${name}`),
      );
      state.currentRelease = structuredClone(patchRereadRelease || patched);
      return mockResponse(200, patchResponse || patched);
    }
    if (url.pathname.startsWith(`/repos/${mockRepository}/releases/assets/`)) {
      const name = decodeURIComponent(url.pathname.split("/").at(-1));
      const bytes = assetPayload.get(name) || state.uploaded.get(name);
      if (!bytes) return mockResponse(404);
      if (redirectAssets) {
        return mockResponse(302, null, {
          location: redirectLocation(
            name,
            `https://github.com/runtime-assets/${encodeURIComponent(name)}`,
          ),
        });
      }
      return mockResponse(200, bytes);
    }
    if (url.origin === "https://github.com" && url.pathname.startsWith("/runtime-assets/")) {
      const name = decodeURIComponent(url.pathname.split("/").at(-1));
      if (redirectAssets) {
        return mockResponse(302, null, {
          location: redirectLocation(name, `https://api.test/runtime-assets/{name}`),
        });
      }
      return mockResponse(200, assetPayload.get(name) || state.uploaded.get(name));
    }
    if (url.origin === mockApiUrl && url.pathname.startsWith("/runtime-assets/")) {
      const name = decodeURIComponent(url.pathname.split("/").at(-1));
      return mockResponse(200, assetPayload.get(name) || state.uploaded.get(name));
    }
    if (url.origin === "https://uploads.github.com" && method === "POST") {
      const name = url.searchParams.get("name");
      state.uploaded.set(name, Buffer.from(options.body));
      return mockResponse(
        201,
        asset(name, `${mockApiUrl}/repos/${mockRepository}/releases/assets/${name}`),
      );
    }
    throw new Error(`unexpected mock request: ${method} ${url}`);
  };
  return { fetchImpl, requests, state, assetPayload, defaultRelease };
}

function publisherFor(mock) {
  return createRuntimeArtifactPublisher({
    fetchImpl: mock.fetchImpl,
    apiUrl: mockApiUrl,
    repository: mockRepository,
    token: "test-token",
    allowedRepositories: [mockRepository],
    logger: { log() {} },
  });
}

function releaseWithAssets(fixture, { draft = false, duplicate = false, wrongTag = false } = {}) {
  const names = [
    "webview-runtime.tar.gz",
    "runtime-artifact.json",
    "webview-runtime.tar.gz.sha256",
  ];
  const assets = names.map((name) => asset(name));
  if (duplicate) assets.push(asset(names[0]));
  return {
    id: 1,
    tag_name: wrongTag
      ? `${fixture.artifact.metadata.sourceCommit}-wrong`
      : runtimeArtifactTag(fixture.sourceCommit),
    target_commitish: fixture.sourceCommit,
    draft,
    upload_url: `https://uploads.github.com/repos/${mockRepository}/releases/1/assets{?name}`,
    assets,
  };
}

function expectedAssetBytes(fixture) {
  return new Map([
    ["webview-runtime.tar.gz", readFileSync(fixture.artifact.archivePath)],
    ["runtime-artifact.json", readFileSync(fixture.artifact.metadataPath)],
    ["webview-runtime.tar.gz.sha256", readFileSync(fixture.artifact.checksumPath)],
  ]);
}

describe("runtime artifact identity", () => {
  test("uses the full source commit for an immutable promotion tag", () => {
    const sourceCommit = "a".repeat(40);
    const tag = runtimeArtifactTag(sourceCommit);
    expect(tag).toBe(`webview-runtime-artifact-${sourceCommit}`);
    expect(parseRuntimeArtifactTag(tag)).toEqual({ sourceCommit });
    expect(() => runtimeArtifactTag("A".repeat(40))).toThrow(/lowercase/);
    expect(parseRuntimeArtifactTag("webview-runtime-artifact-dev")).toBeNull();
  });

  test("metadata contains only distribution-neutral runtime identity", () => {
    const sourceCommit = "a".repeat(40);
    const metadata = makeRuntimeArtifactMetadata({
      sourceCommit,
      runtimeVersion: {
        sourceCommit,
        buildId: sourceCommit,
        protocolVersion: 2,
        hostEnvelopeVersion: 1,
        webEntry: "iframe.abc.html",
        webEntrySha256: "b".repeat(64),
      },
      archiveSha256: "c".repeat(64),
      contentSha256: "d".repeat(64),
    });
    expect(metadata).toEqual({
      schemaVersion: 1,
      package: "webview-runtime",
      archiveName: "webview-runtime.tar.gz",
      archiveSha256: "c".repeat(64),
      contentSha256: "d".repeat(64),
      sourceCommit,
      buildId: sourceCommit,
      protocolVersion: 2,
      hostEnvelopeVersion: 1,
      webEntry: "iframe.abc.html",
      webEntrySha256: "b".repeat(64),
    });
    expect(metadata).not.toHaveProperty("branch");
    expect(metadata).not.toHaveProperty("pipelineIid");
    expect(metadata).not.toHaveProperty("latest");
    expect(() =>
      makeRuntimeArtifactMetadata({
        sourceCommit,
        runtimeVersion: {
          sourceCommit,
          buildId: sourceCommit,
          protocolVersion: "2",
          hostEnvelopeVersion: 1,
          webEntry: "iframe.abc.html",
          webEntrySha256: "b".repeat(64),
        },
        archiveSha256: "c".repeat(64),
        contentSha256: "d".repeat(64),
      }),
    ).toThrow(/protocolVersion/);
  });
});

test("content digest follows the shared UTF-8 golden fixture", () => {
  const fixture = JSON.parse(readFileSync(fixturePath, "utf8"));
  const root = mkdtempSync(join(tmpdir(), "tg-runtime-content-"));
  try {
    for (const file of [...fixture.files].reverse()) {
      const path = join(root, ...file.path.split("/"));
      mkdirSync(join(path, ".."), { recursive: true });
      const bytes = Buffer.from(file.contentBase64, "base64");
      expect(createHash("sha256").update(bytes).digest("hex")).toBe(file.sha256);
      writeFileSync(path, bytes);
    }
    expect(canonicalContentSha256(root)).toBe(fixture.contentSha256);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("promotion resolves an annotated tag to and verifies its final commit", async () => {
  const fixture = artifactFixture();
  try {
    const annotatedObject = "a".repeat(40);
    const tag = runtimeArtifactTag(fixture.sourceCommit);
    const mock = createMockGithub({
      sourceCommit: fixture.sourceCommit,
      tag,
      tagResponses: [{ type: "tag", sha: annotatedObject }],
      releaseResponses: [releaseWithAssets(fixture, { draft: true })],
      assetBytes: expectedAssetBytes(fixture),
    });
    const result = await publisherFor(mock).promote({
      sourceCommit: fixture.sourceCommit,
      artifactDir: fixture.artifactDir,
    });
    expect(result.alreadyPublished).toBe(false);
    expect(
      mock.requests.some(
        (request) =>
          request.url.pathname === `/repos/${mockRepository}/git/tags/${annotatedObject}`,
      ),
    ).toBe(true);
  } finally {
    fixture.cleanup();
  }
});

test("content digest changes on mutation and rejects unsafe or ambiguous paths", () => {
  const root = mkdtempSync(join(tmpdir(), "tg-runtime-content-safety-"));
  try {
    writeFileSync(join(root, "b.txt"), "b");
    writeFileSync(join(root, "a.txt"), "a");
    const first = canonicalContentSha256(root);
    writeFileSync(join(root, "a.txt"), "changed");
    expect(canonicalContentSha256(root)).not.toBe(first);

    if (process.platform !== "win32") {
      writeFileSync(join(root, "target.txt"), "target");
      symlinkSync("target.txt", join(root, "link.txt"));
      expect(() => canonicalContentSha256(root)).toThrow(/symlink/);
      rmSync(join(root, "link.txt"));

      writeFileSync(join(root, "bad\\name.txt"), "bad");
      expect(() => canonicalContentSha256(root)).toThrow(/backslash|safe relative/);
      rmSync(join(root, "bad\\name.txt"));

      writeFileSync(join(root, "C:runtime.js"), "bad");
      expect(() => canonicalContentSha256(root)).toThrow(/safe relative/);
      rmSync(join(root, "C:runtime.js"));
    }

    for (const path of ["é.txt", "한.txt", "e\u0301.txt"]) {
      writeFileSync(join(root, path), "non-portable");
      expect(() => canonicalContentSha256(root)).toThrow(/ASCII|portable|safe relative/);
      rmSync(join(root, path));
    }

    for (const webEntry of ["assets//main.js", "assets/"]) {
      expect(() =>
        makeRuntimeArtifactMetadata({
          sourceCommit: "a".repeat(40),
          runtimeVersion: {
            sourceCommit: "a".repeat(40),
            protocolVersion: 1,
            hostEnvelopeVersion: 1,
            buildId: "build",
            webEntry,
            webEntrySha256: "b".repeat(64),
          },
          archiveSha256: "c".repeat(64),
          contentSha256: "d".repeat(64),
        }),
      ).toThrow(/safe relative/);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("artifact builder writes and validates exactly three deterministic files", () => {
  const first = artifactFixture();
  const second = artifactFixture();
  try {
    expect(readFileSync(first.artifact.archivePath)).toEqual(
      readFileSync(second.artifact.archivePath),
    );
    expect(readFileSync(first.artifact.metadataPath)).toEqual(
      readFileSync(second.artifact.metadataPath),
    );
    expect(validateRuntimeArtifact(first.artifactDir, first.sourceCommit)).toEqual(
      first.artifact.metadata,
    );
    expect(readFileSync(first.artifact.checksumPath, "utf8")).toBe(
      `${first.artifact.archiveSha256}  webview-runtime.tar.gz\n`,
    );
  } finally {
    first.cleanup();
    second.cleanup();
  }
});

test("artifact builder isolates output directories and files from symlinks", () => {
  const fixture = artifactFixture();
  const linkedOutput = mkdtempSync(join(tmpdir(), "tg-runtime-artifact-link-parent-"));
  const realOutput = mkdtempSync(join(tmpdir(), "tg-runtime-artifact-real-output-"));
  const outputLink = join(linkedOutput, "output");
  symlinkSync(realOutput, outputLink);
  try {
    expect(() =>
      createRuntimeArtifact({
        distDir: fixture.distDir,
        outputDir: outputLink,
        sourceCommit: fixture.sourceCommit,
      }),
    ).toThrow(/real directory|symlink/);
    expect(() =>
      createRuntimeArtifact({
        distDir: fixture.distDir,
        outputDir: join(fixture.distDir, "nested-output"),
        sourceCommit: fixture.sourceCommit,
      }),
    ).toThrow(/outside/);
  } finally {
    rmSync(outputLink, { force: true });
    rmSync(linkedOutput, { recursive: true, force: true });
    rmSync(realOutput, { recursive: true, force: true });
    fixture.cleanup();
  }

  const distDir = mkdtempSync(join(tmpdir(), "tg-runtime-artifact-dist-"));
  const outputDir = mkdtempSync(join(tmpdir(), "tg-runtime-artifact-output-"));
  const outside = mkdtempSync(join(tmpdir(), "tg-runtime-artifact-outside-"));
  const danglingArchive = join(outputDir, "webview-runtime.tar.gz");
  try {
    runtimeDist(distDir, "b".repeat(40));
    symlinkSync(join(outside, "archive-target"), danglingArchive);
    expect(() =>
      createRuntimeArtifact({
        distDir,
        outputDir,
        sourceCommit: "b".repeat(40),
      }),
    ).toThrow(/regular files|symlink/);
  } finally {
    rmSync(distDir, { recursive: true, force: true });
    rmSync(outputDir, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  }
});

test("runtime validation scans the full tree before reading HTML or manifest", () => {
  if (process.platform === "win32") return;
  const distDir = mkdtempSync(join(tmpdir(), "tg-runtime-scan-dist-"));
  const outsideDir = mkdtempSync(join(tmpdir(), "tg-runtime-scan-outside-"));
  const outputDir = mkdtempSync(join(tmpdir(), "tg-runtime-scan-output-"));
  try {
    writeFileSync(join(outsideDir, "runtime-version.json"), "not-json");
    symlinkSync(join(outsideDir, "runtime-version.json"), join(distDir, "runtime-version.json"));
    expect(() =>
      createRuntimeArtifact({
        distDir,
        outputDir,
        sourceCommit: "c".repeat(40),
      }),
    ).toThrow(/symlink/);
  } finally {
    rmSync(distDir, { recursive: true, force: true });
    rmSync(outsideDir, { recursive: true, force: true });
    rmSync(outputDir, { recursive: true, force: true });
  }
});

test("artifact validation rejects symlinked output and unexpected files", () => {
  const fixture = artifactFixture();
  try {
    writeFileSync(join(fixture.artifactDir, "unexpected.txt"), "unexpected");
    expect(() => validateRuntimeArtifact(fixture.artifactDir, fixture.sourceCommit)).toThrow(
      /exactly three|unexpected/,
    );
    rmSync(join(fixture.artifactDir, "unexpected.txt"));

    const outside = mkdtempSync(join(tmpdir(), "tg-runtime-artifact-outside-"));
    const link = join(fixture.artifactDir, "runtime-link");
    try {
      symlinkSync(outside, link);
      expect(() => validateRuntimeArtifact(fixture.artifactDir, fixture.sourceCommit)).toThrow(
        /symlink|exactly three/,
      );
    } finally {
      rmSync(link, { force: true });
      rmSync(outside, { recursive: true, force: true });
    }
  } finally {
    fixture.cleanup();
  }
});

test("promotion workflow has an exact source commit and split permissions", () => {
  const workflow = readFileSync(
    resolve(process.cwd(), ".github/workflows/runtime-artifact-promotion.yml"),
    "utf8",
  );
  const buildJob = workflow.slice(workflow.indexOf("  build:"), workflow.indexOf("  publish:"));
  const publishJob = workflow.slice(workflow.indexOf("  publish:"));
  expect(workflow).toContain("workflow_dispatch:");
  expect(workflow).toContain("sourceCommit:");
  expect(workflow).toContain("required: true");
  expect(workflow).toContain("ref: ${{ inputs.sourceCommit }}");
  expect(workflow).toContain("git rev-parse HEAD");
  expect(workflow).toContain("origin/dev");
  expect(workflow).toContain("origin/main");
  expect(workflow).toContain("persist-credentials: false");
  expect(workflow).toContain("environment: runtime-artifact-promotion");
  expect(workflow).toContain("ref: ${{ github.workflow_sha }}");
  expect(workflow).toContain("write-capable job must execute publisher code");
  expect(workflow).toContain("contents: read");
  expect(workflow).toContain("contents: write");
  expect(buildJob).toContain("contents: read");
  expect(buildJob).toContain("ref: ${{ inputs.sourceCommit }}");
  expect(buildJob).not.toContain("contents: write");
  expect(publishJob).toContain("environment: runtime-artifact-promotion");
  expect(publishJob).toContain("contents: write");
  expect(publishJob).not.toContain("ref: ${{ inputs.sourceCommit }}");
  expect(workflow).toContain("vp install --frozen-lockfile --prefer-offline");
  expect(workflow).toContain("actions/download-artifact@v8");
  expect(workflow).toContain("node scripts/promote-runtime-artifact.mjs");
  expect(workflow).toContain("TG_ARTIFACT_DIR: runtime-artifact");
  expect(workflow).toContain("path: runtime-artifact");
  expect(workflow).not.toContain(".runtime-artifact");
  expect(workflow).not.toContain("TG_SOURCE_BRANCH");
  expect(workflow).not.toContain("TG_PIPELINE_IID");

  const legacyWorkflow = readFileSync(
    resolve(process.cwd(), ".github/workflows/runtime-release.yml"),
    "utf8",
  );
  expect(legacyWorkflow).toContain("vp install --frozen-lockfile --prefer-offline");
  expect(legacyWorkflow).toContain(".github/workflows/runtime-artifact-promotion.yml");
});

test("legacy dev Release workflow does not depend on the artifact job", () => {
  const workflow = readFileSync(
    resolve(process.cwd(), ".github/workflows/runtime-release.yml"),
    "utf8",
  );
  expect(workflow).toContain("node scripts/publish-runtime-release.mjs");
  expect(workflow).toContain("TG_SOURCE_BRANCH");
  expect(workflow).toContain("TG_PIPELINE_IID");
  expect(workflow).toContain("artifact-contract:");
  const legacyRelease = workflow.slice(workflow.indexOf("  release:"));
  expect(legacyRelease).toContain("needs: verify");
  expect(legacyRelease).not.toContain("artifact-contract");
});

describe("runtime artifact promotion behavior", () => {
  test("rejects an exact tag ref that points to another commit", async () => {
    const fixture = artifactFixture();
    try {
      const tag = runtimeArtifactTag(fixture.sourceCommit);
      const mock = createMockGithub({
        sourceCommit: fixture.sourceCommit,
        tag,
        tagResponses: ["f".repeat(40)],
      });
      await expect(
        publisherFor(mock).promote({
          sourceCommit: fixture.sourceCommit,
          artifactDir: fixture.artifactDir,
        }),
      ).rejects.toThrow(/different commit|sourceCommit/);
      expect(mock.state.postCount).toBe(0);
    } finally {
      fixture.cleanup();
    }
  });

  test("rejects a Release whose tag name does not match", async () => {
    const fixture = artifactFixture();
    try {
      const tag = runtimeArtifactTag(fixture.sourceCommit);
      const mock = createMockGithub({
        sourceCommit: fixture.sourceCommit,
        tag,
        releaseResponses: [releaseWithAssets(fixture, { wrongTag: true })],
        assetBytes: expectedAssetBytes(fixture),
      });
      await expect(
        publisherFor(mock).promote({
          sourceCommit: fixture.sourceCommit,
          artifactDir: fixture.artifactDir,
        }),
      ).rejects.toThrow(/unexpected tag/);
    } finally {
      fixture.cleanup();
    }
  });

  test("never forwards the token across an asset redirect or to an untrusted origin", async () => {
    const fixture = artifactFixture();
    try {
      const tag = runtimeArtifactTag(fixture.sourceCommit);
      const bytes = expectedAssetBytes(fixture);
      const mock = createMockGithub({
        sourceCommit: fixture.sourceCommit,
        tag,
        releaseResponses: [releaseWithAssets(fixture)],
        assetBytes: bytes,
        redirectAssets: true,
      });
      await publisherFor(mock).promote({
        sourceCommit: fixture.sourceCommit,
        artifactDir: fixture.artifactDir,
      });
      const apiAssetRequest = mock.requests.find(
        (request) => request.url.origin === mockApiUrl && request.url.pathname.includes("/assets/"),
      );
      const redirectedAssetRequest = mock.requests.find(
        (request) => request.url.origin === "https://github.com",
      );
      expect(apiAssetRequest.options.headers.Authorization).toBe("Bearer test-token");
      expect(redirectedAssetRequest.options.headers.Authorization).toBeUndefined();

      const officialRelease = releaseWithAssets(fixture);
      officialRelease.assets = officialRelease.assets.map((releaseAsset) => ({
        ...releaseAsset,
        url: `https://github.com/runtime-assets/${releaseAsset.name}`,
      }));
      const officialMock = createMockGithub({
        sourceCommit: fixture.sourceCommit,
        tag,
        releaseResponses: [officialRelease],
        assetBytes: bytes,
      });
      const officialFetch = async (input, options = {}) => {
        const url = new URL(input);
        if (url.origin === "https://github.com" && url.pathname.startsWith("/runtime-assets/")) {
          const name = decodeURIComponent(url.pathname.split("/").at(-1));
          return mockResponse(302, null, {
            location: `https://api.test/runtime-assets/${encodeURIComponent(name)}`,
          });
        }
        return officialMock.fetchImpl(input, options);
      };
      await createRuntimeArtifactPublisher({
        fetchImpl: officialFetch,
        apiUrl: mockApiUrl,
        repository: mockRepository,
        token: "test-token",
        allowedRepositories: [mockRepository],
        logger: { log() {} },
      }).promote({
        sourceCommit: fixture.sourceCommit,
        artifactDir: fixture.artifactDir,
      });
      const redirectedBackToApi = officialMock.requests.find(
        (request) =>
          request.url.origin === mockApiUrl && request.url.pathname.startsWith("/runtime-assets/"),
      );
      expect(redirectedBackToApi.options.headers.Authorization).toBeUndefined();

      const evilRelease = releaseWithAssets(fixture);
      evilRelease.assets[0].url = "https://evil.example/runtime.tar.gz";
      const evilMock = createMockGithub({
        sourceCommit: fixture.sourceCommit,
        tag,
        releaseResponses: [evilRelease],
        assetBytes: bytes,
      });
      await expect(
        publisherFor(evilMock).promote({
          sourceCommit: fixture.sourceCommit,
          artifactDir: fixture.artifactDir,
        }),
      ).rejects.toThrow(/untrusted origin/);
    } finally {
      fixture.cleanup();
    }
  });

  test("rejects duplicate assets before upload or publish", async () => {
    const fixture = artifactFixture();
    try {
      const tag = runtimeArtifactTag(fixture.sourceCommit);
      const mock = createMockGithub({
        sourceCommit: fixture.sourceCommit,
        tag,
        releaseResponses: [releaseWithAssets(fixture, { duplicate: true })],
        assetBytes: expectedAssetBytes(fixture),
      });
      await expect(
        publisherFor(mock).promote({
          sourceCommit: fixture.sourceCommit,
          artifactDir: fixture.artifactDir,
        }),
      ).rejects.toThrow(/duplicate/);
      expect(mock.state.patchCount).toBe(0);
    } finally {
      fixture.cleanup();
    }
  });

  test("rejects duplicate assets in a draft before attempting uploads", async () => {
    const fixture = artifactFixture();
    try {
      const tag = runtimeArtifactTag(fixture.sourceCommit);
      const mock = createMockGithub({
        sourceCommit: fixture.sourceCommit,
        tag,
        releaseResponses: [releaseWithAssets(fixture, { draft: true, duplicate: true })],
        assetBytes: expectedAssetBytes(fixture),
      });
      await expect(
        publisherFor(mock).promote({
          sourceCommit: fixture.sourceCommit,
          artifactDir: fixture.artifactDir,
        }),
      ).rejects.toThrow(/duplicate/);
      expect(mock.state.uploaded.size).toBe(0);
      expect(mock.state.patchCount).toBe(0);
    } finally {
      fixture.cleanup();
    }
  });

  test("continues a matching draft, reads all bytes back, and publishes", async () => {
    const fixture = artifactFixture();
    try {
      const tag = runtimeArtifactTag(fixture.sourceCommit);
      const bytes = expectedAssetBytes(fixture);
      const draft = releaseWithAssets(fixture, { draft: true });
      draft.assets = [draft.assets[0]];
      const mock = createMockGithub({
        sourceCommit: fixture.sourceCommit,
        tag,
        releaseResponses: [draft],
        assetBytes: bytes,
      });
      const result = await publisherFor(mock).promote({
        sourceCommit: fixture.sourceCommit,
        artifactDir: fixture.artifactDir,
      });
      expect(result.alreadyPublished).toBe(false);
      expect(mock.state.uploaded.size).toBe(2);
      expect(mock.state.patchCount).toBe(1);
      expect(mock.requests.some((request) => request.options.method === "PATCH")).toBe(true);
      expect(
        mock.requests.filter((request) => request.url.pathname.includes("/releases/tags/")).length,
      ).toBe(2);
    } finally {
      fixture.cleanup();
    }
  });

  test("allows a new draft before GitHub materializes its exact tag ref", async () => {
    const fixture = artifactFixture();
    try {
      const tag = runtimeArtifactTag(fixture.sourceCommit);
      const mock = createMockGithub({
        sourceCommit: fixture.sourceCommit,
        tag,
        assetBytes: expectedAssetBytes(fixture),
        missingTagWhileDraft: true,
      });
      const result = await publisherFor(mock).promote({
        sourceCommit: fixture.sourceCommit,
        artifactDir: fixture.artifactDir,
      });
      expect(result.alreadyPublished).toBe(false);
      expect(mock.state.patchCount).toBe(1);
    } finally {
      fixture.cleanup();
    }
  });

  test("does not trust a successful PATCH response without a published reread", async () => {
    const fixture = artifactFixture();
    try {
      const tag = runtimeArtifactTag(fixture.sourceCommit);
      const bytes = expectedAssetBytes(fixture);
      const draft = releaseWithAssets(fixture, { draft: true });
      const patchResponse = structuredClone(draft);
      patchResponse.draft = false;
      const mock = createMockGithub({
        sourceCommit: fixture.sourceCommit,
        tag,
        releaseResponses: [draft],
        assetBytes: bytes,
        patchResponse,
        patchRereadRelease: draft,
      });
      await expect(
        publisherFor(mock).promote({
          sourceCommit: fixture.sourceCommit,
          artifactDir: fixture.artifactDir,
        }),
      ).rejects.toThrow(/could not be published/);
      expect(mock.state.patchCount).toBe(1);
    } finally {
      fixture.cleanup();
    }
  });

  test("returns success for published identical bytes without mutation", async () => {
    const fixture = artifactFixture();
    try {
      const tag = runtimeArtifactTag(fixture.sourceCommit);
      const mock = createMockGithub({
        sourceCommit: fixture.sourceCommit,
        tag,
        releaseResponses: [releaseWithAssets(fixture)],
        assetBytes: expectedAssetBytes(fixture),
      });
      const result = await publisherFor(mock).promote({
        sourceCommit: fixture.sourceCommit,
        artifactDir: fixture.artifactDir,
      });
      expect(result.alreadyPublished).toBe(true);
      expect(mock.state.postCount).toBe(0);
      expect(mock.state.patchCount).toBe(0);
    } finally {
      fixture.cleanup();
    }
  });

  test("fails when an existing published asset has different bytes", async () => {
    const fixture = artifactFixture();
    try {
      const tag = runtimeArtifactTag(fixture.sourceCommit);
      const bytes = expectedAssetBytes(fixture);
      bytes.set("webview-runtime.tar.gz", Buffer.from("different"));
      const mock = createMockGithub({
        sourceCommit: fixture.sourceCommit,
        tag,
        releaseResponses: [releaseWithAssets(fixture)],
        assetBytes: bytes,
      });
      await expect(
        publisherFor(mock).promote({
          sourceCommit: fixture.sourceCommit,
          artifactDir: fixture.artifactDir,
        }),
      ).rejects.toThrow(/asset differs/);
      expect(mock.state.patchCount).toBe(0);
    } finally {
      fixture.cleanup();
    }
  });

  test("re-gets a Release after a concurrent POST 422", async () => {
    const fixture = artifactFixture();
    try {
      const tag = runtimeArtifactTag(fixture.sourceCommit);
      const raced = releaseWithAssets(fixture);
      const mock = createMockGithub({
        sourceCommit: fixture.sourceCommit,
        tag,
        tagResponses: [null, fixture.sourceCommit],
        releaseResponses: [null, raced],
        assetBytes: expectedAssetBytes(fixture),
        postStatus: 422,
      });
      const result = await publisherFor(mock).promote({
        sourceCommit: fixture.sourceCommit,
        artifactDir: fixture.artifactDir,
      });
      expect(result.alreadyPublished).toBe(true);
      expect(mock.state.postCount).toBe(1);
      expect(
        mock.requests.filter((request) => request.url.pathname.includes("/releases/tags/")).length,
      ).toBe(2);
    } finally {
      fixture.cleanup();
    }
  });

  test("requires an HTTPS GitHub API URL", () => {
    expect(() =>
      createRuntimeArtifactPublisher({
        fetchImpl: async () => mockResponse(500),
        apiUrl: "http://api.test",
        repository: mockRepository,
        token: "test-token",
        allowedRepositories: [mockRepository],
      }),
    ).toThrow(/HTTPS/);
  });

  test("rejects an attacker-selected repository outside the explicit allowlist", () => {
    expect(() =>
      createRuntimeArtifactPublisher({
        fetchImpl: async () => mockResponse(500),
        apiUrl: mockApiUrl,
        repository: "evil.example/runtime",
        token: "test-token",
      }),
    ).toThrow(/allowlisted/);
  });
});
