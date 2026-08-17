import { createHash } from "node:crypto";
import { existsSync, lstatSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve, sep } from "node:path";
import { gzipSync } from "node:zlib";

const COMMIT_PATTERN = /^[0-9a-f]{40}$/;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const RELEASE_TAG_PREFIX = "webview-runtime-channel-";
const ARCHIVE_NAME = "webview-runtime.tar.gz";

export function branchIdentity(branch) {
  if (typeof branch !== "string" || branch.length === 0 || branch.length > 255) {
    throw new Error("branch must be a non-empty string no longer than 255 characters");
  }
  return createHash("sha256").update(branch, "utf8").digest("hex");
}

export function branchSlug(branch) {
  const slug = branch
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  if (!slug) throw new Error(`branch cannot produce a release slug: ${branch}`);
  return slug;
}

export function releaseTag({ branch, pipelineIid }) {
  if (!Number.isInteger(pipelineIid) || pipelineIid <= 0) {
    throw new Error("pipelineIid must be a positive integer");
  }
  return `${RELEASE_TAG_PREFIX}${branchSlug(branch)}-${branchIdentity(branch).slice(0, 16)}-${pipelineIid}`;
}

export function parseReleaseTag(tag) {
  if (typeof tag !== "string") return null;
  const match = new RegExp(`^${RELEASE_TAG_PREFIX}(.+)-([0-9a-f]{16})-([1-9][0-9]*)$`).exec(tag);
  if (!match) return null;
  return { branchSlug: match[1], branchIdentity: match[2], pipelineIid: Number(match[3]) };
}

function assertSafeRelativePath(path, label) {
  if (
    typeof path !== "string" ||
    path.length === 0 ||
    path.startsWith("/") ||
    /^[a-zA-Z]:[\\/]/.test(path) ||
    path.split(/[\\/]/).some((part) => part === "..")
  ) {
    throw new Error(`${label} must be a safe relative path: ${path}`);
  }
}

function sha256File(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function relativeReferences(html) {
  const references = [];
  const pattern = /\b(?:src|href)\s*=\s*(["'])(.*?)\1/gi;
  for (const match of html.matchAll(pattern)) {
    const value = match[2].split(/[?#]/, 1)[0];
    if (!value || value.startsWith("/") || /^[a-z][a-z0-9+.-]*:/i.test(value)) continue;
    references.push(value.replace(/^\.\//, ""));
  }
  return references;
}

export function validateRuntimeDist(distDir) {
  const root = resolve(distDir);
  const manifestPath = resolve(root, "runtime-version.json");
  if (!existsSync(manifestPath)) throw new Error("dist/runtime-version.json is missing");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const required = [
    "protocolVersion",
    "hostEnvelopeVersion",
    "buildId",
    "builtAt",
    "package",
    "sourceCommit",
    "webEntry",
    "webEntrySha256",
  ];
  for (const field of required) {
    if (!(field in manifest)) throw new Error(`runtime-version.json missing ${field}`);
  }
  if (manifest.package !== "webview-runtime") throw new Error("unexpected runtime package");
  if (!COMMIT_PATTERN.test(manifest.sourceCommit)) {
    throw new Error("runtime-version.json sourceCommit must be a full commit SHA");
  }
  if (!SHA256_PATTERN.test(manifest.webEntrySha256)) {
    throw new Error("runtime-version.json webEntrySha256 must be a lowercase SHA-256");
  }
  assertSafeRelativePath(manifest.webEntry, "runtime-version.json webEntry");
  const entryPath = resolve(root, manifest.webEntry);
  if (!entryPath.startsWith(`${root}${sep}`) || !existsSync(entryPath)) {
    throw new Error(`runtime entry is missing: ${manifest.webEntry}`);
  }
  if (sha256File(entryPath) !== manifest.webEntrySha256) {
    throw new Error("runtime-version.json webEntrySha256 does not match the entry");
  }

  const htmlFiles = [resolve(root, "index.html"), entryPath];
  for (const htmlPath of htmlFiles) {
    if (!existsSync(htmlPath))
      throw new Error(`runtime HTML is missing: ${relative(root, htmlPath)}`);
    for (const reference of relativeReferences(readFileSync(htmlPath, "utf8"))) {
      assertSafeRelativePath(reference, `HTML reference in ${relative(root, htmlPath)}`);
      const target = resolve(dirname(htmlPath), reference);
      if (!target.startsWith(`${root}${sep}`) || !existsSync(target)) {
        throw new Error(`HTML reference is missing: ${reference}`);
      }
      if (!statSync(target).isFile()) throw new Error(`HTML reference is not a file: ${reference}`);
    }
  }

  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const path = resolve(dir, name);
      const info = lstatSync(path);
      if (info.isSymbolicLink())
        throw new Error(`runtime dist must not contain symlinks: ${relative(root, path)}`);
      if (info.isDirectory()) walk(path);
      else if (!info.isFile())
        throw new Error(`runtime dist contains unsupported entry: ${relative(root, path)}`);
    }
  };
  walk(root);
  return manifest;
}

export function createArchive(distDir, archivePath) {
  const root = resolve(distDir);
  const files = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir).sort()) {
      const path = resolve(dir, name);
      const info = lstatSync(path);
      if (info.isSymbolicLink())
        throw new Error(`runtime archive must not contain symlinks: ${relative(root, path)}`);
      if (info.isDirectory()) walk(path);
      else if (info.isFile()) files.push(path);
      else throw new Error(`runtime archive contains unsupported entry: ${relative(root, path)}`);
    }
  };
  walk(root);
  const chunks = [];
  for (const path of files) {
    const name = relative(root, path).split(sep).join("/");
    const data = readFileSync(path);
    if (Buffer.byteLength(name) > 100) throw new Error(`runtime archive path is too long: ${name}`);
    const header = Buffer.alloc(512, 0);
    header.write(name, 0, 100, "utf8");
    header.write("0000644\0", 100, 8, "ascii");
    header.write("0000000\0", 108, 8, "ascii");
    header.write("0000000\0", 116, 8, "ascii");
    header.write(`${data.length.toString(8).padStart(11, "0")}\0`, 124, 12, "ascii");
    header.write("00000000000\0", 136, 12, "ascii");
    header[156] = "0".charCodeAt(0);
    header.write("ustar\0", 257, 6, "ascii");
    header.write("00", 263, 2, "ascii");
    header.write("        ", 148, 8, "ascii");
    const checksum = [...header].reduce((sum, byte) => sum + byte, 0);
    header.write(`${checksum.toString(8).padStart(6, "0")}\0 `, 148, 8, "ascii");
    chunks.push(header, data, Buffer.alloc((512 - (data.length % 512)) % 512));
  }
  chunks.push(Buffer.alloc(1024));
  writeFileSync(archivePath, gzipSync(Buffer.concat(chunks), { level: 9, mtime: 0 }));
}

export function makeReleaseMetadata({
  branch,
  sourceCommit,
  pipelineId,
  pipelineIid,
  tag,
  archiveSha256,
  runtimeVersion,
}) {
  if (!COMMIT_PATTERN.test(sourceCommit)) throw new Error("sourceCommit must be a full commit SHA");
  if (!Number.isInteger(pipelineId) || pipelineId <= 0)
    throw new Error("pipelineId must be positive");
  if (!Number.isInteger(pipelineIid) || pipelineIid <= 0)
    throw new Error("pipelineIid must be positive");
  if (!SHA256_PATTERN.test(archiveSha256))
    throw new Error("archiveSha256 must be a lowercase SHA-256");
  if (tag !== releaseTag({ branch, pipelineIid }))
    throw new Error("release tag does not match branch and pipeline IID");
  return {
    schemaVersion: 1,
    branch,
    branchIdentity: branchIdentity(branch),
    sourceCommit,
    pipelineId,
    pipelineIid,
    releaseTag: tag,
    archiveName: ARCHIVE_NAME,
    archiveSha256,
    protocolVersion: runtimeVersion.protocolVersion,
    hostEnvelopeVersion: runtimeVersion.hostEnvelopeVersion,
    runtimeBuildId: runtimeVersion.buildId,
    generatedAt: runtimeVersion.builtAt,
  };
}

export { ARCHIVE_NAME, RELEASE_TAG_PREFIX };
