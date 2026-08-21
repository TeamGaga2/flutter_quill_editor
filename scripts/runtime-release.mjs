import { createHash } from "node:crypto";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, relative, resolve, sep } from "node:path";
import { gzipSync } from "node:zlib";

const COMMIT_PATTERN = /^[0-9a-f]{40}$/;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const RELEASE_TAG_PREFIX = "webview-runtime-channel-";
const ARTIFACT_TAG_PREFIX = "webview-runtime-artifact-";
const ARCHIVE_NAME = "webview-runtime.tar.gz";
const ARTIFACT_METADATA_NAME = "runtime-artifact.json";
const ARTIFACT_FILE_NAMES = [ARTIFACT_METADATA_NAME, ARCHIVE_NAME, `${ARCHIVE_NAME}.sha256`];

function lstatIfExists(path) {
  try {
    return lstatSync(path);
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

function pathWithin(root, path) {
  return path === root || path.startsWith(`${root}${sep}`);
}

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

/**
 * Return the immutable promotion tag for one exact runtime source commit.
 *
 * The legacy branch/pipeline helpers above intentionally remain available for
 * the PR-1 compatibility window. New promotion code must use this helper so
 * that a tag has no moving branch or CI-run component.
 */
export function runtimeArtifactTag(sourceCommit) {
  if (typeof sourceCommit !== "string" || !COMMIT_PATTERN.test(sourceCommit)) {
    throw new Error("sourceCommit must be a full lowercase commit SHA");
  }
  return `${ARTIFACT_TAG_PREFIX}${sourceCommit}`;
}

export const artifactTag = runtimeArtifactTag;

export function parseRuntimeArtifactTag(tag) {
  if (typeof tag !== "string" || !tag.startsWith(ARTIFACT_TAG_PREFIX)) return null;
  const sourceCommit = tag.slice(ARTIFACT_TAG_PREFIX.length);
  if (!COMMIT_PATTERN.test(sourceCommit)) return null;
  return { sourceCommit };
}

function assertSafeRelativePath(path, label) {
  const hasNonPortableAscii =
    typeof path === "string" &&
    Array.from(path).some((character) => {
      const codePoint = character.codePointAt(0);
      return codePoint < 0x20 || codePoint === 0x7f || codePoint > 0x7e;
    });
  if (
    typeof path !== "string" ||
    path.length === 0 ||
    hasNonPortableAscii ||
    path.startsWith("/") ||
    /^[a-zA-Z]:/.test(path) ||
    path.includes("\\") ||
    path.split(/[\\/]/).some((part) => part === "" || part === ".." || part === ".")
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
    let value = match[2].split(/[?#]/, 1)[0];
    if (!value || value.startsWith("/") || /^[a-z][a-z0-9+.-]*:/i.test(value)) continue;
    while (value.startsWith("./")) value = value.slice(2);
    if (!value) throw new Error("runtime HTML reference must name a file");
    references.push(value);
  }
  return references;
}

export function validateRuntimeDist(distDir) {
  const root = resolve(distDir);
  const rootInfo = lstatIfExists(root);
  if (rootInfo?.isSymbolicLink() || (rootInfo && !rootInfo.isDirectory())) {
    throw new Error("runtime dist must be a real directory");
  }
  // Reject symlinks and non-regular entries before opening runtime-version or
  // parsing any HTML. Validation must not follow an attacker-controlled link.
  validateRuntimeFilesystemTree(root);
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
  if (!Number.isInteger(manifest.protocolVersion) || manifest.protocolVersion <= 0) {
    throw new Error("runtime-version.json protocolVersion must be a positive integer");
  }
  if (!Number.isInteger(manifest.hostEnvelopeVersion) || manifest.hostEnvelopeVersion <= 0) {
    throw new Error("runtime-version.json hostEnvelopeVersion must be a positive integer");
  }
  if (typeof manifest.buildId !== "string" || manifest.buildId.length === 0) {
    throw new Error("runtime-version.json buildId must be a non-empty string");
  }
  if (typeof manifest.builtAt !== "string" || manifest.builtAt.length === 0) {
    throw new Error("runtime-version.json builtAt must be a non-empty string");
  }
  if (typeof manifest.sourceCommit !== "string" || !COMMIT_PATTERN.test(manifest.sourceCommit)) {
    throw new Error("runtime-version.json sourceCommit must be a full commit SHA");
  }
  if (
    typeof manifest.webEntrySha256 !== "string" ||
    !SHA256_PATTERN.test(manifest.webEntrySha256)
  ) {
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

  return manifest;
}

function utf8PathCompare(left, right) {
  return Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));
}

/**
 * Calculate the cross-language content digest for a validated runtime tree.
 *
 * The digest intentionally does not include file modes, mtimes, directory
 * entries, or archive metadata. Each ordinary file contributes one canonical
 * UTF-8 record: `relative/path\\0<file sha256>\\n`, with records ordered by
 * their UTF-8 encoded relative path.
 */
export function canonicalContentSha256(distDir) {
  const root = resolve(distDir);
  const files = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const path = resolve(dir, name);
      const info = lstatSync(path);
      if (info.isSymbolicLink()) {
        throw new Error(`runtime content must not contain symlinks: ${relative(root, path)}`);
      }
      if (info.isDirectory()) {
        walk(path);
      } else if (info.isFile()) {
        const relativePath = relative(root, path).split(sep).join("/");
        assertSafeRelativePath(relativePath, "runtime content path");
        files.push({ path, relativePath });
      } else {
        throw new Error(`runtime content contains unsupported entry: ${relative(root, path)}`);
      }
    }
  };
  walk(root);
  files.sort((left, right) => utf8PathCompare(left.relativePath, right.relativePath));

  const digest = createHash("sha256");
  for (const file of files) {
    const fileSha256 = sha256File(file.path);
    digest.update(Buffer.from(`${file.relativePath}\0${fileSha256}\n`, "utf8"));
  }
  return digest.digest("hex");
}

function validateRuntimeFilesystemTree(root) {
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
}

function assertSha256(value, label) {
  if (typeof value !== "string" || !SHA256_PATTERN.test(value)) {
    throw new Error(`${label} must be a lowercase SHA-256`);
  }
}

/**
 * Build the distribution-neutral metadata that accompanies a runtime archive.
 * No branch, pipeline, release, or latest selector is part of this contract.
 */
export function makeRuntimeArtifactMetadata({
  sourceCommit,
  runtimeVersion,
  archiveSha256,
  contentSha256,
}) {
  if (!runtimeVersion || typeof runtimeVersion !== "object") {
    throw new Error("runtimeVersion must be an object");
  }
  if (runtimeVersion.sourceCommit !== sourceCommit) {
    throw new Error("runtime-version.json sourceCommit does not match artifact sourceCommit");
  }
  runtimeArtifactTag(sourceCommit);
  assertSha256(archiveSha256, "archiveSha256");
  assertSha256(contentSha256, "contentSha256");
  if (!Number.isInteger(runtimeVersion.protocolVersion) || runtimeVersion.protocolVersion <= 0) {
    throw new Error("protocolVersion must be a positive integer");
  }
  if (
    !Number.isInteger(runtimeVersion.hostEnvelopeVersion) ||
    runtimeVersion.hostEnvelopeVersion <= 0
  ) {
    throw new Error("hostEnvelopeVersion must be a positive integer");
  }
  if (typeof runtimeVersion.buildId !== "string" || runtimeVersion.buildId.length === 0) {
    throw new Error("runtime-version.json buildId must be a non-empty string");
  }
  if (typeof runtimeVersion.webEntry !== "string") {
    throw new Error("webEntry must be a safe relative path");
  }
  assertSafeRelativePath(runtimeVersion.webEntry, "webEntry");
  if (typeof runtimeVersion.webEntrySha256 !== "string") {
    throw new Error("webEntrySha256 must be a lowercase SHA-256");
  }
  assertSha256(runtimeVersion.webEntrySha256, "webEntrySha256");
  return {
    schemaVersion: 1,
    package: "webview-runtime",
    archiveName: ARCHIVE_NAME,
    archiveSha256,
    contentSha256,
    sourceCommit,
    buildId: runtimeVersion.buildId,
    protocolVersion: runtimeVersion.protocolVersion,
    hostEnvelopeVersion: runtimeVersion.hostEnvelopeVersion,
    webEntry: runtimeVersion.webEntry,
    webEntrySha256: runtimeVersion.webEntrySha256,
  };
}

function assertArtifactOutputDirectory(outputDir) {
  const root = resolve(outputDir);
  const info = lstatIfExists(root);
  if (info) {
    if (info.isSymbolicLink() || !info.isDirectory()) {
      throw new Error("runtime artifact output directory must be a real directory");
    }
  } else {
    mkdirSync(root, { recursive: true });
  }
  return root;
}

function assertArtifactOutputFile(path) {
  const info = lstatIfExists(path);
  if (!info) return;
  if (info.isSymbolicLink() || !info.isFile()) {
    throw new Error(`runtime artifact output must contain regular files: ${path}`);
  }
}

function assertArtifactOutputOutsideDist(distRoot, outputRoot) {
  const realDistRoot = realpathSync(distRoot);
  const outputInfo = lstatIfExists(outputRoot);
  if (outputInfo?.isSymbolicLink()) {
    throw new Error("runtime artifact output directory must not be a symlink");
  }
  if (outputInfo) {
    const realOutputRoot = realpathSync(outputRoot);
    if (pathWithin(realDistRoot, realOutputRoot)) {
      throw new Error("runtime artifact output must be outside the runtime dist directory");
    }
    return;
  }

  // The output directory may not exist yet. Resolve its nearest existing
  // parent before checking the real path, so a symlinked parent cannot hide an
  // output location inside dist behind a different lexical path.
  let existingParent = resolve(outputRoot, "..");
  while (!lstatIfExists(existingParent)) {
    const next = resolve(existingParent, "..");
    if (next === existingParent) break;
    existingParent = next;
  }
  const realParent = realpathSync(existingParent);
  const projectedOutput = resolve(realParent, relative(existingParent, outputRoot));
  if (pathWithin(realDistRoot, projectedOutput)) {
    throw new Error("runtime artifact output must be outside the runtime dist directory");
  }
}

/**
 * Validate the isolated three-file artifact directory before promotion.
 *
 * This check intentionally rejects extra files, symlinks, and realpath escapes
 * so a downloaded Actions artifact cannot smuggle a different payload into the
 * publisher.
 */
export function validateRuntimeArtifact(artifactDir, expectedSourceCommit = null) {
  const root = resolve(artifactDir);
  if (!existsSync(root)) throw new Error("runtime artifact directory is missing");
  const rootInfo = lstatSync(root);
  if (rootInfo.isSymbolicLink() || !rootInfo.isDirectory()) {
    throw new Error("runtime artifact directory must be a real directory");
  }
  const names = readdirSync(root).sort(utf8PathCompare);
  if (
    names.length !== ARTIFACT_FILE_NAMES.length ||
    names.some((name, index) => name !== ARTIFACT_FILE_NAMES[index])
  ) {
    throw new Error("runtime artifact directory must contain exactly three files");
  }
  const realRoot = realpathSync(root);
  for (const name of names) {
    const path = resolve(root, name);
    const info = lstatSync(path);
    if (info.isSymbolicLink() || !info.isFile()) {
      throw new Error(`runtime artifact contains a symlink or non-file: ${name}`);
    }
    if (realpathSync(path) !== resolve(realRoot, name)) {
      throw new Error(`runtime artifact file escapes its output directory: ${name}`);
    }
  }

  const metadata = JSON.parse(readFileSync(resolve(root, ARTIFACT_METADATA_NAME), "utf8"));
  const metadataKeys = [
    "schemaVersion",
    "package",
    "archiveName",
    "archiveSha256",
    "contentSha256",
    "sourceCommit",
    "buildId",
    "protocolVersion",
    "hostEnvelopeVersion",
    "webEntry",
    "webEntrySha256",
  ];
  if (
    !metadata ||
    typeof metadata !== "object" ||
    Object.keys(metadata).length !== metadataKeys.length ||
    metadataKeys.some((key) => !(key in metadata))
  ) {
    throw new Error("runtime-artifact.json has an unexpected schema");
  }
  if (metadata.schemaVersion !== 1 || metadata.package !== "webview-runtime") {
    throw new Error("runtime-artifact.json schema or package is invalid");
  }
  if (metadata.archiveName !== ARCHIVE_NAME) {
    throw new Error("runtime-artifact.json archiveName is invalid");
  }
  if (expectedSourceCommit !== null && metadata.sourceCommit !== expectedSourceCommit) {
    throw new Error("runtime-artifact.json sourceCommit does not match requested sourceCommit");
  }
  const normalizedSourceCommit = metadata.sourceCommit;
  runtimeArtifactTag(normalizedSourceCommit);
  const runtimeVersion = {
    sourceCommit: normalizedSourceCommit,
    buildId: metadata.buildId,
    protocolVersion: metadata.protocolVersion,
    hostEnvelopeVersion: metadata.hostEnvelopeVersion,
    webEntry: metadata.webEntry,
    webEntrySha256: metadata.webEntrySha256,
  };
  makeRuntimeArtifactMetadata({
    sourceCommit: normalizedSourceCommit,
    runtimeVersion,
    archiveSha256: metadata.archiveSha256,
    contentSha256: metadata.contentSha256,
  });

  const checksum = readFileSync(resolve(root, `${ARCHIVE_NAME}.sha256`), "utf8");
  if (checksum !== `${metadata.archiveSha256}  ${ARCHIVE_NAME}\n`) {
    throw new Error("runtime artifact checksum sidecar does not match metadata");
  }
  const archiveBytes = readFileSync(resolve(root, ARCHIVE_NAME));
  const archiveSha256 = createHash("sha256").update(archiveBytes).digest("hex");
  if (archiveSha256 !== metadata.archiveSha256) {
    throw new Error("runtime artifact archive does not match metadata");
  }
  return metadata;
}

/**
 * Produce the three files that form a promoted runtime artifact.
 *
 * The output directory is deliberately outside the dist tree in callers so
 * the archive cannot accidentally include its own metadata or checksum.
 */
export function createRuntimeArtifact({ distDir, outputDir, sourceCommit = null }) {
  const root = resolve(distDir);
  const runtimeVersion = validateRuntimeDist(root);
  if (sourceCommit !== null && runtimeVersion.sourceCommit !== sourceCommit) {
    throw new Error("runtime-version.json sourceCommit does not match requested sourceCommit");
  }
  const requestedOutput = resolve(outputDir);
  assertArtifactOutputOutsideDist(root, requestedOutput);
  const output = assertArtifactOutputDirectory(requestedOutput);
  const archivePath = resolve(output, ARCHIVE_NAME);
  const metadataPath = resolve(output, ARTIFACT_METADATA_NAME);
  const checksumPath = resolve(output, `${ARCHIVE_NAME}.sha256`);
  assertArtifactOutputFile(archivePath);
  assertArtifactOutputFile(metadataPath);
  assertArtifactOutputFile(checksumPath);
  const contentSha256 = canonicalContentSha256(root);
  createArchive(root, archivePath);
  const archiveBytes = readFileSync(archivePath);
  const archiveSha256 = createHash("sha256").update(archiveBytes).digest("hex");
  const metadata = makeRuntimeArtifactMetadata({
    sourceCommit: runtimeVersion.sourceCommit,
    runtimeVersion,
    archiveSha256,
    contentSha256,
  });
  const metadataBytes = Buffer.from(`${JSON.stringify(metadata, null, 2)}\n`, "utf8");
  const checksumBytes = Buffer.from(`${archiveSha256}  ${ARCHIVE_NAME}\n`, "utf8");
  writeFileSync(metadataPath, metadataBytes);
  writeFileSync(checksumPath, checksumBytes);
  const validatedMetadata = validateRuntimeArtifact(output, runtimeVersion.sourceCommit);
  return {
    archivePath,
    metadataPath,
    checksumPath,
    archiveSha256,
    contentSha256,
    metadata: validatedMetadata,
  };
}

export function createArchive(distDir, archivePath) {
  const root = resolve(distDir);
  const files = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir).sort(utf8PathCompare)) {
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
    assertSafeRelativePath(name, "runtime archive path");
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

export { ARCHIVE_NAME, ARTIFACT_METADATA_NAME, ARTIFACT_TAG_PREFIX, RELEASE_TAG_PREFIX };
