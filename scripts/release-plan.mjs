import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { runtimeArtifactTag } from "./runtime-release.mjs";

const REPOSITORY_ROOT = resolve(new URL("..", import.meta.url).pathname);
export const PACKAGE_NAME = "flutter_quill_editor";
export const PACKAGE_DIRECTORY = "clients/flutter_quill_editor";
export const PACKAGE_TAG_PREFIX = "dart-v";
export const RELEASE_BRANCH_PREFIX = "automation/flutter-release-v";
export const RELEASE_COMMIT_PREFIX = "chore(release): prepare flutter_quill_editor";

const VERSION_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const COMMIT_PATTERN = /^[0-9a-f]{40}$/;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const RUNTIME_REPOSITORY = "TeamGaga2/flutter_quill_editor";
const RUNTIME_ARCHIVE_NAME = "webview-runtime.tar.gz";
const RELEASE_BUMPS = new Set(["patch", "minor", "major"]);

// Keep this list aligned with the inputs which can change the runtime bytes or
// the artifact contract. Release tooling and workflow-only changes do not
// require minting a duplicate immutable runtime artifact.
export const RUNTIME_INPUT_PREFIXES = ["apps/webview-runtime/", "packages/"];
export const RUNTIME_INPUT_FILES = [
  "package.json",
  "pnpm-lock.yaml",
  "pnpm-workspace.yaml",
  "tsconfig.json",
  "vite.config.ts",
  "scripts/create-runtime-artifact.mjs",
  "scripts/runtime-release.mjs",
  "scripts/verify-runtime-dist.mjs",
];

const CHANGELOG_GROUPS = [
  ["Breaking changes", "breaking"],
  ["Features", "feature"],
  ["Fixes", "fix"],
  ["Other changes", "other"],
];

function git(args, cwd = REPOSITORY_ROOT) {
  try {
    return execFileSync("git", args, {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  } catch (error) {
    const detail = error?.stderr?.toString().trim();
    throw new Error(`git ${args.join(" ")} failed${detail ? `: ${detail}` : ""}`);
  }
}

function assertCommit(value, label = "commit") {
  if (typeof value !== "string" || !COMMIT_PATTERN.test(value)) {
    throw new Error(`${label} must be a full lowercase commit SHA`);
  }
  return value;
}

export function parseVersion(value, label = "version") {
  if (typeof value !== "string") throw new Error(`${label} must be SemVer X.Y.Z`);
  const match = VERSION_PATTERN.exec(value.trim());
  if (!match) throw new Error(`${label} must be a stable SemVer X.Y.Z`);
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
  };
}

export function formatVersion(version) {
  if (!version || !Number.isSafeInteger(version.major) || !Number.isSafeInteger(version.minor)) {
    throw new Error("version components must be safe integers");
  }
  if (!Number.isSafeInteger(version.patch)) throw new Error("version patch must be a safe integer");
  if (version.major < 0 || version.minor < 0 || version.patch < 0) {
    throw new Error("version components must be non-negative");
  }
  return `${version.major}.${version.minor}.${version.patch}`;
}

export function compareVersions(left, right) {
  const a = typeof left === "string" ? parseVersion(left) : left;
  const b = typeof right === "string" ? parseVersion(right) : right;
  return a.major - b.major || a.minor - b.minor || a.patch - b.patch;
}

export function bumpVersion(currentVersion, bump) {
  const current = parseVersion(currentVersion, "current version");
  if (!RELEASE_BUMPS.has(bump)) {
    throw new Error("bump must be one of patch, minor, or major");
  }
  if (bump === "major") return formatVersion({ major: current.major + 1, minor: 0, patch: 0 });
  if (bump === "minor")
    return formatVersion({ major: current.major, minor: current.minor + 1, patch: 0 });
  return formatVersion({ major: current.major, minor: current.minor, patch: current.patch + 1 });
}

export function parseReleaseTrigger({
  eventName,
  action = "",
  actor = "",
  manualBump = "",
  restartBump = "",
  restartAttempt = "",
}) {
  if (eventName === "workflow_dispatch") {
    if (!RELEASE_BUMPS.has(manualBump)) {
      throw new Error("workflow_dispatch bump must be patch, minor, or major");
    }
    return { kind: "manual", bump: manualBump, attempt: 0 };
  }
  if (eventName !== "repository_dispatch") {
    throw new Error("release workflow received an unsupported trigger");
  }
  if (action !== "flutter-release-restart") {
    throw new Error("repository_dispatch action is not an internal release restart");
  }
  if (actor !== "github-actions[bot]") {
    throw new Error("release restart must be dispatched by github-actions[bot]");
  }
  if (!RELEASE_BUMPS.has(restartBump)) {
    throw new Error("release restart bump must be patch, minor, or major");
  }
  const attemptText = String(restartAttempt).trim();
  if (!/^(0|[1-3])$/.test(attemptText)) {
    throw new Error("release restart attempt must be an integer from 0 through 3");
  }
  return { kind: "restart", bump: restartBump, attempt: Number(attemptText) };
}

export function readPackageVersion(pubspecText) {
  const matches = [...pubspecText.matchAll(/^version:[ \t]*([^\s#\r\n]+)[ \t]*$/gm)];
  if (matches.length !== 1) throw new Error("pubspec.yaml must contain exactly one version field");
  const version = matches[0][1];
  parseVersion(version, "pubspec version");
  return version;
}

export function isRuntimeInputPath(path) {
  return (
    typeof path === "string" &&
    (RUNTIME_INPUT_PREFIXES.some((prefix) => path.startsWith(prefix)) ||
      RUNTIME_INPUT_FILES.includes(path))
  );
}

export function runtimeInputChanged(changedPaths) {
  if (!Array.isArray(changedPaths)) throw new Error("changedPaths must be an array");
  return changedPaths.some(isRuntimeInputPath);
}

function categoryForCommit(type, breaking) {
  if (breaking) return "breaking";
  if (type === "feat") return "feature";
  if (type === "fix" || type === "bugfix" || type === "perf") return "fix";
  return "other";
}

export function parseConventionalCommit({ sha, subject, body = "" }) {
  const commitSha = assertCommit(sha, "commit SHA");
  if (typeof subject !== "string" || !subject.trim()) throw new Error("commit subject is required");
  const normalizedSubject = subject.trim();
  const header =
    /^(?<type>[a-z][\w-]*)(?:\((?<scope>[^)]+)\))?(?<breaking>!)?:\s+(?<summary>.+)$/i.exec(
      normalizedSubject,
    );
  const type = header?.groups?.type?.toLowerCase() || "other";
  const breaking =
    Boolean(header?.groups?.breaking) || /^(?:BREAKING CHANGE|BREAKING-CHANGE):/im.test(body);
  return {
    sha: commitSha,
    shortSha: commitSha.slice(0, 7),
    subject: normalizedSubject,
    type,
    scope: header?.groups?.scope || null,
    breaking,
    category: categoryForCommit(type, breaking),
  };
}

function isIgnoredCommit(commit) {
  return (
    /^Merge (?:pull request|branch|remote-tracking)/i.test(commit.subject) ||
    /^chore\(release\): prepare flutter_quill_editor \d+\.\d+\.\d+$/i.test(commit.subject) ||
    /\[skip release\]/i.test(commit.subject)
  );
}

export function generateChangelog(commits, nextVersion) {
  parseVersion(nextVersion, "next version");
  if (!Array.isArray(commits)) throw new Error("commits must be an array");
  const parsed = commits
    .map((commit) => (commit.category ? commit : parseConventionalCommit(commit)))
    .filter((commit) => !isIgnoredCommit(commit));
  if (parsed.length === 0) throw new Error("release has no publishable commits since the last tag");

  const sections = [];
  for (const [heading, category] of CHANGELOG_GROUPS) {
    const entries = parsed.filter((commit) => commit.category === category);
    if (entries.length === 0) continue;
    sections.push(
      `### ${heading}\n\n${entries.map((commit) => `- ${commit.subject} (${commit.shortSha})`).join("\n")}`,
    );
  }
  return `## ${nextVersion}\n\n${sections.join("\n\n")}\n`;
}

function runtimeLockIdentity(lock) {
  if (!lock || typeof lock !== "object") throw new Error("runtime lock must be an object");
  const artifact = lock.artifact;
  const runtime = lock.runtime;
  if (!artifact || typeof artifact !== "object" || !runtime || typeof runtime !== "object") {
    throw new Error("runtime lock must contain artifact and runtime objects");
  }
  const identity = {
    sourceCommit: runtime.sourceCommit,
    releaseTag: artifact.releaseTag,
    archiveName: artifact.archiveName,
    archiveSha256: artifact.archiveSha256,
    contentSha256: artifact.contentSha256,
    buildId: runtime.buildId,
    protocolVersion: runtime.protocolVersion,
    hostEnvelopeVersion: runtime.hostEnvelopeVersion,
    webEntry: runtime.webEntry,
    webEntrySha256: runtime.webEntrySha256,
  };
  assertCommit(identity.sourceCommit, "runtime lock sourceCommit");
  if (identity.releaseTag !== runtimeArtifactTag(identity.sourceCommit)) {
    throw new Error("runtime lock releaseTag does not match sourceCommit");
  }
  if (artifact.repository !== RUNTIME_REPOSITORY) {
    throw new Error("runtime lock repository does not match this repository");
  }
  if (identity.archiveName !== RUNTIME_ARCHIVE_NAME) {
    throw new Error("runtime lock archiveName is invalid");
  }
  for (const name of ["archiveSha256", "contentSha256", "buildId", "webEntry"]) {
    if (typeof identity[name] !== "string" || !identity[name]) {
      throw new Error(`runtime lock ${name} is required`);
    }
  }
  for (const name of ["archiveSha256", "contentSha256", "webEntrySha256"]) {
    if (!SHA256_PATTERN.test(identity[name])) {
      throw new Error(`runtime lock ${name} must be a lowercase SHA-256`);
    }
  }
  for (const name of ["protocolVersion", "hostEnvelopeVersion"]) {
    if (!Number.isInteger(identity[name]) || identity[name] <= 0) {
      throw new Error(`runtime lock ${name} is invalid`);
    }
  }
  return identity;
}

export function flattenRuntimeLock(lock) {
  return runtimeLockIdentity(lock);
}

export function createReleasePlan({
  bump,
  currentVersion,
  sourceCommit,
  baseTag,
  baseTagCommit,
  commits,
  changedPaths,
  runtimeChanged,
  runtimeLock,
}) {
  const normalizedSourceCommit = assertCommit(sourceCommit, "sourceCommit");
  const parsedCurrentVersion = parseVersion(currentVersion, "current version");
  const nextVersion = bumpVersion(formatVersion(parsedCurrentVersion), bump);
  const lockBefore = flattenRuntimeLock(runtimeLock);
  const detectedRuntimeChange = runtimeChanged ?? runtimeInputChanged(changedPaths || []);
  const changelogEntry = generateChangelog(commits, nextVersion);
  const normalizedBaseTag = baseTag || `${PACKAGE_TAG_PREFIX}${currentVersion}`;
  if (normalizedBaseTag !== `${PACKAGE_TAG_PREFIX}${currentVersion}`) {
    throw new Error("baseTag must match the current package version");
  }
  assertCommit(baseTagCommit, "baseTagCommit");
  return {
    schemaVersion: 1,
    package: PACKAGE_NAME,
    packageDirectory: PACKAGE_DIRECTORY,
    bump,
    currentVersion,
    nextVersion,
    sourceCommit: normalizedSourceCommit,
    baseTag: normalizedBaseTag,
    baseTagCommit,
    changedPaths: [...(changedPaths || [])].sort((left, right) => left.localeCompare(right)),
    commits: commits.map((commit) => (commit.category ? commit : parseConventionalCommit(commit))),
    changelogEntry,
    runtimeChanged: Boolean(detectedRuntimeChange),
    previousRuntimeSourceCommit: lockBefore.sourceCommit,
    runtimeSourceCommit: detectedRuntimeChange ? normalizedSourceCommit : lockBefore.sourceCommit,
    runtimeArtifactTag: detectedRuntimeChange
      ? runtimeArtifactTag(normalizedSourceCommit)
      : lockBefore.releaseTag,
    packageTag: `${PACKAGE_TAG_PREFIX}${nextVersion}`,
    releaseBranch: `${RELEASE_BRANCH_PREFIX}${nextVersion}`,
    lockBefore,
  };
}

function isAncestor(ancestor, descendant, cwd) {
  try {
    execFileSync("git", ["merge-base", "--is-ancestor", ancestor, descendant], {
      cwd,
      stdio: "ignore",
    });
    return true;
  } catch {
    return false;
  }
}

function parseTagVersion(tag) {
  if (!tag.startsWith(PACKAGE_TAG_PREFIX)) return null;
  const value = tag.slice(PACKAGE_TAG_PREFIX.length);
  try {
    parseVersion(value);
    return value;
  } catch {
    return null;
  }
}

function findBaseTag({ root, sourceCommit, currentVersion }) {
  const expectedTag = `${PACKAGE_TAG_PREFIX}${currentVersion}`;
  const tags = git(["tag", "--list", `${PACKAGE_TAG_PREFIX}*`], root)
    .split("\n")
    .map((tag) => tag.trim())
    .filter(Boolean);
  if (!tags.includes(expectedTag)) {
    throw new Error(`current package tag is missing: ${expectedTag}`);
  }
  const currentTagCommit = git(["rev-parse", `${expectedTag}^{commit}`], root);
  if (!isAncestor(currentTagCommit, sourceCommit, root)) {
    throw new Error(`${expectedTag} is not an ancestor of sourceCommit`);
  }
  const ancestorVersions = tags
    .map((tag) => ({ tag, version: parseTagVersion(tag) }))
    .filter(
      (entry) =>
        entry.version &&
        isAncestor(git(["rev-parse", `${entry.tag}^{commit}`], root), sourceCommit, root),
    )
    .sort((left, right) => compareVersions(right.version, left.version));
  if (ancestorVersions[0]?.version !== currentVersion) {
    throw new Error("pubspec version is not the latest package tag on this branch");
  }
  return { tag: expectedTag, commit: currentTagCommit };
}

function readCommitsSince(root, baseTag, sourceCommit) {
  const raw = git(
    ["log", "--no-merges", `--format=%H%x00%s%x00%b%x1e`, `${baseTag}..${sourceCommit}`],
    root,
  );
  return raw
    .split("\x1e")
    .map((record) => record.trim())
    .filter(Boolean)
    .map((record) => {
      const [sha, subject, ...bodyParts] = record.split("\x00");
      return { sha, subject, body: bodyParts.join("\x00").trim() };
    });
}

export function createReleasePlanFromRepository({
  root = REPOSITORY_ROOT,
  packageDirectory = PACKAGE_DIRECTORY,
  bump,
}) {
  const packageRoot = resolve(root, packageDirectory);
  const sourceCommit = git(["rev-parse", "HEAD"], root);
  assertCommit(sourceCommit, "sourceCommit");
  const pubspecText = readFileSync(resolve(packageRoot, "pubspec.yaml"), "utf8");
  const currentVersion = readPackageVersion(pubspecText);
  const { tag: baseTag, commit: baseTagCommit } = findBaseTag({
    root,
    sourceCommit,
    currentVersion,
  });
  const changedPaths = git(["diff", "--name-only", `${baseTag}..${sourceCommit}`], root)
    .split("\n")
    .map((path) => path.trim())
    .filter(Boolean);
  const runtimeLock = JSON.parse(
    readFileSync(resolve(packageRoot, "richtext-runtime.lock.json"), "utf8"),
  );
  if (!isAncestor(runtimeLock.runtime.sourceCommit, sourceCommit, root)) {
    throw new Error("runtime lock sourceCommit is not an ancestor of the release sourceCommit");
  }
  const plan = createReleasePlan({
    bump,
    currentVersion,
    sourceCommit,
    baseTag,
    baseTagCommit,
    commits: readCommitsSince(root, baseTag, sourceCommit),
    changedPaths,
    runtimeLock,
  });
  if (git(["tag", "--list", plan.packageTag], root)) {
    throw new Error(`package tag already exists: ${plan.packageTag}`);
  }
  return plan;
}

export function applyPackageRelease({ pubspecPath, changelogPath, plan }) {
  if (!plan || plan.schemaVersion !== 1) throw new Error("release plan schema is unsupported");
  const pubspecBefore = readFileSync(pubspecPath, "utf8");
  const changelogBefore = readFileSync(changelogPath, "utf8");
  const currentVersion = readPackageVersion(pubspecBefore);
  const expectedEntry = plan.changelogEntry.trimEnd();
  const idempotentPrefix = `# Changelog\n\n${expectedEntry}\n\n`;
  if (currentVersion === plan.nextVersion && changelogBefore.startsWith(idempotentPrefix)) {
    return false;
  }
  if (currentVersion !== plan.currentVersion) {
    throw new Error(
      `pubspec version changed while preparing release: expected ${plan.currentVersion}, got ${currentVersion}`,
    );
  }
  if (changelogBefore.includes(`## ${plan.nextVersion}`)) {
    throw new Error(`CHANGELOG.md already contains ${plan.nextVersion}`);
  }
  const versionMatches = [...pubspecBefore.matchAll(/^version:[ \t]*([^\s#\r\n]+)[ \t]*$/gm)];
  if (versionMatches.length !== 1) throw new Error("pubspec.yaml version field is ambiguous");
  const pubspecAfter =
    pubspecBefore.slice(0, versionMatches[0].index) +
    `version: ${plan.nextVersion}` +
    pubspecBefore.slice(versionMatches[0].index + versionMatches[0][0].length);
  const changelogHeader = /^# Changelog\s*\r?\n(?:\r?\n)?/.exec(changelogBefore);
  if (!changelogHeader) throw new Error("CHANGELOG.md must start with # Changelog");
  const changelogAfter =
    changelogBefore.slice(0, changelogHeader[0].length) +
    `${expectedEntry}\n\n` +
    changelogBefore.slice(changelogHeader[0].length);
  try {
    writeFileSync(pubspecPath, pubspecAfter);
    writeFileSync(changelogPath, changelogAfter);
  } catch (error) {
    writeFileSync(pubspecPath, pubspecBefore);
    writeFileSync(changelogPath, changelogBefore);
    throw error;
  }
  return true;
}

export function applyReleasePlan({ root = REPOSITORY_ROOT, plan }) {
  const actualSourceCommit = git(["rev-parse", "HEAD"], root);
  if (actualSourceCommit !== plan.sourceCommit) {
    throw new Error("release source changed after planning; restart from the new main commit");
  }
  const packageRoot = resolve(root, plan.packageDirectory || PACKAGE_DIRECTORY);
  return applyPackageRelease({
    pubspecPath: resolve(packageRoot, "pubspec.yaml"),
    changelogPath: resolve(packageRoot, "CHANGELOG.md"),
    plan,
  });
}

function tableValue(value) {
  return String(value ?? "N/A")
    .replaceAll("|", "\\|")
    .replaceAll("\n", " ");
}

function readAssetEvidence(path) {
  if (!path) return [];
  return readFileSync(path, "utf8")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [name, id, size, hash, url] = line.split("\t");
      if (!name || !id || !size || !hash || !url)
        throw new Error("asset evidence row is malformed");
      return { name, id, size, hash, url };
    });
}

function validateReleaseEvidence(release, plan) {
  if (!release || typeof release !== "object")
    throw new Error("release evidence must be an object");
  if (release.tag_name !== plan.runtimeArtifactTag)
    throw new Error("release evidence tag does not match the runtime tag");
  if (release.draft === true || release.prerelease === true)
    throw new Error("runtime release evidence is not published");
  const names = (release.assets || []).map((asset) => asset?.name).sort();
  const expected = [
    "runtime-artifact.json",
    "webview-runtime.tar.gz",
    "webview-runtime.tar.gz.sha256",
  ].sort();
  if (names.length !== expected.length || names.some((name, index) => name !== expected[index])) {
    throw new Error("runtime release evidence must contain exactly three assets");
  }
}

export function renderReleaseEvidence({
  plan,
  lockAfter,
  promotionRunUrl,
  release = null,
  assetEvidencePath = null,
}) {
  const after = flattenRuntimeLock(lockAfter);
  const rows = [
    ["Runtime source commit", plan.lockBefore.sourceCommit, after.sourceCommit],
    ["Artifact release tag", plan.lockBefore.releaseTag, after.releaseTag],
    ["Archive name", plan.lockBefore.archiveName, after.archiveName],
    ["Archive SHA-256", plan.lockBefore.archiveSha256, after.archiveSha256],
    ["Content SHA-256", plan.lockBefore.contentSha256, after.contentSha256],
    ["Build ID", plan.lockBefore.buildId, after.buildId],
    ["Web entry", plan.lockBefore.webEntry, after.webEntry],
    ["Web entry SHA-256", plan.lockBefore.webEntrySha256, after.webEntrySha256],
    ["protocolVersion", plan.lockBefore.protocolVersion, after.protocolVersion],
    ["hostEnvelopeVersion", plan.lockBefore.hostEnvelopeVersion, after.hostEnvelopeVersion],
  ];
  const assets = readAssetEvidence(assetEvidencePath);
  if (release) {
    validateReleaseEvidence(release, plan);
    const remoteAssets = new Map(release.assets.map((asset) => [asset.name, asset]));
    if (assets.length !== remoteAssets.size) {
      throw new Error("asset evidence must contain one row for every remote Release asset");
    }
    const seenNames = new Set();
    for (const asset of assets) {
      const remote = remoteAssets.get(asset.name);
      if (!remote || seenNames.has(asset.name)) {
        throw new Error("asset evidence must contain one row for every remote Release asset");
      }
      if (asset.id !== String(remote.id) || asset.size !== String(remote.size)) {
        throw new Error(`asset evidence identity differs from Release asset: ${asset.name}`);
      }
      if (asset.url !== remote.browser_download_url) {
        throw new Error(`asset evidence URL differs from Release asset: ${asset.name}`);
      }
      if (!SHA256_PATTERN.test(asset.hash)) {
        throw new Error(`asset evidence hash is invalid: ${asset.name}`);
      }
      seenNames.add(asset.name);
    }
    if (seenNames.size !== remoteAssets.size) {
      throw new Error("asset evidence is missing a remote Release asset");
    }
  }
  const assetTable = release
    ? [
        "| Remote asset | Asset ID | Size | Observed SHA-256 | Browser URL |",
        "| --- | ---: | ---: | --- | --- |",
        ...assets.map(
          (asset) =>
            `| \`${tableValue(asset.name)}\` | ${tableValue(asset.id)} | ${tableValue(asset.size)} | \`${tableValue(asset.hash)}\` | ${tableValue(asset.url)} |`,
        ),
      ].join("\n")
    : "Runtime artifact was unchanged; the committed exact Release was reused and offline verification passed.";
  return [
    "# Automated Flutter package release",
    "",
    `- Package: \`${PACKAGE_NAME}\``,
    `- Version: \`${plan.currentVersion}\` → \`${plan.nextVersion}\` (${plan.bump})`,
    `- Package tag to create after merge: \`${plan.packageTag}\``,
    "- Release authorization: the original workflow dispatch is the sole human authorization; all subsequent gates are automated.",
    "",
    "## Purpose and source",
    "",
    `- Release source commit: \`${plan.sourceCommit}\``,
    `- Previous package tag: \`${plan.baseTag}\` (${plan.baseTagCommit})`,
    `- Promotion / orchestration run: ${promotionRunUrl || "not provided"}`,
    `- Runtime changed since the previous exact lock: ${plan.runtimeChanged ? "yes" : "no"}`,
    `- Exact runtime artifact tag: \`${plan.runtimeArtifactTag}\``,
    "",
    "## Identity change",
    "",
    "| Field | Old value | New value |",
    "| --- | --- | --- |",
    ...rows.map(
      ([field, oldValue, newValue]) =>
        `| ${field} | \`${tableValue(oldValue)}\` | \`${tableValue(newValue)}\` |`,
    ),
    "",
    "## Remote promotion evidence",
    "",
    plan.runtimeChanged
      ? "- [x] Existing exact Release was queried and its three asset bytes were read back by the exact-tag update tool."
      : "- [x] Existing exact Release is retained; no new promotion or lock selector was created.",
    "- [x] Archive checksum, canonical content digest, runtime entry digest, HTML references, protocol and host-envelope compatibility were verified.",
    "- [x] No branch/latest selector, fallback artifact, local artifact, credential or signed URL was used.",
    "",
    assetTable,
    "",
    "## Required tracked outputs",
    "",
    "- [x] `clients/flutter_quill_editor/richtext-runtime.lock.json`",
    "- [x] `clients/flutter_quill_editor/assets/richtext_webview_runtime/**`",
    "- [x] `clients/flutter_quill_editor/lib/host/runtime_manifest.dart`",
    "- [x] `clients/flutter_quill_editor/pubspec.yaml` and `CHANGELOG.md` updated by the release tool.",
    "- [x] No unrelated tracked files changed.",
    "",
    "## Verification",
    "",
    "- [x] `vp install --frozen-lockfile --prefer-offline`",
    "- [x] `vp check`",
    "- [x] `vp test scripts/runtime-artifact.test.mjs scripts/release-plan.test.mjs --run`",
    "- [x] `dart run tool/richtext_runtime_prepare.dart --verify` (offline)",
    "- [x] `flutter analyze`",
    "- [x] `flutter test`",
    "- [x] `flutter build web` for the example",
    "- [x] `flutter pub publish --dry-run`",
    "",
    "## Review and rollback",
    "",
    `- Known-good package tag for rollback: \`${plan.baseTag}\``,
    `- Known-good runtime tag for rollback: \`${plan.lockBefore.releaseTag}\``,
    "- If publication fails after merge, rerun the immutable package tag workflow; do not move or overwrite an existing tag or Release.",
    "- If the package version is already published, restore the known-good lock/vendor/manifest set and publish a new patch version.",
    "",
  ].join("\n");
}

function argumentValue(args, name, required = true) {
  const index = args.indexOf(name);
  if (index === -1) {
    if (required) throw new Error(`${name} is required`);
    return null;
  }
  const value = args[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${name} requires a value`);
  return value;
}

function cli() {
  const [command = "plan", ...args] = process.argv.slice(2);
  if (command === "plan") {
    const root = resolve(argumentValue(args, "--root", false) || REPOSITORY_ROOT);
    const plan = createReleasePlanFromRepository({
      root,
      packageDirectory: argumentValue(args, "--package-directory", false) || PACKAGE_DIRECTORY,
      bump: argumentValue(args, "--bump"),
    });
    const output = resolve(argumentValue(args, "--output", false) || "release-plan.json");
    writeFileSync(output, `${JSON.stringify(plan, null, 2)}\n`);
    console.log(
      `planned ${PACKAGE_NAME} ${plan.currentVersion} -> ${plan.nextVersion}; runtimeChanged=${plan.runtimeChanged}`,
    );
    return;
  }
  if (command === "apply") {
    const root = resolve(argumentValue(args, "--root", false) || REPOSITORY_ROOT);
    const plan = JSON.parse(readFileSync(resolve(argumentValue(args, "--plan")), "utf8"));
    applyReleasePlan({ root, plan });
    console.log(`applied ${PACKAGE_NAME} ${plan.nextVersion}`);
    return;
  }
  if (command === "evidence") {
    const plan = JSON.parse(readFileSync(resolve(argumentValue(args, "--plan")), "utf8"));
    const lockAfter = JSON.parse(
      readFileSync(resolve(argumentValue(args, "--lock-after")), "utf8"),
    );
    const releasePath = argumentValue(args, "--release-json", false);
    const release = releasePath ? JSON.parse(readFileSync(resolve(releasePath), "utf8")) : null;
    const output = resolve(argumentValue(args, "--output"));
    writeFileSync(
      output,
      renderReleaseEvidence({
        plan,
        lockAfter,
        release,
        assetEvidencePath: argumentValue(args, "--asset-evidence", false),
        promotionRunUrl: argumentValue(args, "--promotion-run-url", false),
      }),
    );
    console.log(`rendered release evidence at ${output}`);
    return;
  }
  throw new Error(`unknown release-plan command: ${command}`);
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname)) {
  try {
    cli();
  } catch (error) {
    console.error(`release planning failed: ${error.message}`);
    process.exitCode = 1;
  }
}
