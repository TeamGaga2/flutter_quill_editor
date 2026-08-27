import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import {
  bumpVersion,
  compareVersions,
  parseVersion,
  readPackageVersion,
  RELEASE_BRANCH_PREFIX,
} from "./release-plan.mjs";

const REPOSITORY_ROOT = resolve(new URL("..", import.meta.url).pathname);
const PACKAGE_PUBSPEC = "clients/flutter_quill_editor/pubspec.yaml";
const PACKAGE_CHANGELOG = "clients/flutter_quill_editor/CHANGELOG.md";
const PACKAGE_TAG_PREFIX = "dart-v";
const RELEASE_COMMIT_PATTERN =
  /^chore\(release\): prepare flutter_quill_editor (0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const COMMIT_PATTERN = /^[0-9a-f]{40}$/;
const APP_SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;

export const RELEASE_ALLOWED_PATHS = [
  PACKAGE_PUBSPEC,
  PACKAGE_CHANGELOG,
  "clients/flutter_quill_editor/richtext-runtime.lock.json",
  "clients/flutter_quill_editor/lib/host/runtime_manifest.dart",
  "clients/flutter_quill_editor/assets/richtext_webview_runtime/",
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

function assertCommit(value, label) {
  if (typeof value !== "string" || !COMMIT_PATTERN.test(value)) {
    throw new Error(`${label} must be a full lowercase commit SHA`);
  }
  return value;
}

export function isAllowedReleasePath(path) {
  return RELEASE_ALLOWED_PATHS.some((allowed) =>
    allowed.endsWith("/") ? path.startsWith(allowed) : path === allowed,
  );
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function changelogEntryForVersion(changelog, version) {
  if (typeof changelog !== "string") throw new Error("CHANGELOG.md must be text");
  parseVersion(version, "release version");
  const heading = new RegExp(`^## ${escapeRegExp(version)}\\s*$`, "m");
  const match = heading.exec(changelog);
  if (!match) throw new Error(`CHANGELOG.md is missing release heading ${version}`);
  const nextHeading = /^##\s+/gm;
  nextHeading.lastIndex = match.index + match[0].length;
  const next = nextHeading.exec(changelog);
  return changelog.slice(match.index, next ? next.index : changelog.length).trimEnd();
}

export function validateReleaseSnapshot({
  subject,
  version,
  parentVersion,
  changedPaths,
  changelog,
}) {
  const match = RELEASE_COMMIT_PATTERN.exec(subject || "");
  if (!match)
    throw new Error("release commit subject does not contain the expected package version");
  const targetVersion = `${match[1]}.${match[2]}.${match[3]}`;
  parseVersion(targetVersion, "release commit version");
  if (version !== targetVersion)
    throw new Error("pubspec version does not match release commit subject");
  parseVersion(parentVersion, "parent package version");
  if (compareVersions(targetVersion, parentVersion) <= 0) {
    throw new Error("release version must be newer than the parent package version");
  }
  const validBump = ["patch", "minor", "major"].some(
    (bump) => bumpVersion(parentVersion, bump) === targetVersion,
  );
  if (!validBump)
    throw new Error("release version must be exactly one patch, minor, or major bump");
  if (!Array.isArray(changedPaths) || changedPaths.length === 0) {
    throw new Error("release commit has no changed files");
  }
  const unexpected = changedPaths.filter((path) => !isAllowedReleasePath(path));
  if (unexpected.length > 0) {
    throw new Error(`release commit contains unexpected files: ${unexpected.join(", ")}`);
  }
  if (!changedPaths.includes(PACKAGE_PUBSPEC) || !changedPaths.includes(PACKAGE_CHANGELOG)) {
    throw new Error("release commit must update pubspec.yaml and CHANGELOG.md");
  }
  changelogEntryForVersion(changelog, targetVersion);
  return {
    version: targetVersion,
    packageTag: `${PACKAGE_TAG_PREFIX}${targetVersion}`,
  };
}

export function validateOpenReleasePullRequest({
  pullRequest,
  botUser,
  appSlug,
  repository,
  sourceCommit,
  nextVersion,
  headCommit,
  commitSubject,
  commitParents,
  changedPaths,
}) {
  const expectedSourceCommit = fullSha(sourceCommit, "release source commit");
  const expectedHeadCommit = fullSha(headCommit, "release PR head commit");
  const expectedRepository = required(repository, "GITHUB_REPOSITORY");
  const version = parseVersion(nextVersion, "release version");
  const versionText = `${version.major}.${version.minor}.${version.patch}`;
  const expectedTitle = `chore(release): prepare flutter_quill_editor ${versionText}`;
  const expectedBranch = `${RELEASE_BRANCH_PREFIX}${versionText}`;
  const expectedBotLogin = `${validateAppSlug(appSlug)}[bot]`;
  if (!pullRequest || pullRequest.state !== "open") {
    throw new Error("release PR must be open");
  }
  if (pullRequest.title !== expectedTitle) {
    throw new Error("release PR title does not match the release version");
  }
  if (
    pullRequest.base?.ref !== "main" ||
    pullRequest.base?.repo?.full_name !== expectedRepository
  ) {
    throw new Error("release PR base is not the protected main branch");
  }
  if (
    pullRequest.head?.ref !== expectedBranch ||
    pullRequest.head?.repo?.full_name !== expectedRepository ||
    fullSha(pullRequest.head?.sha, "release PR head") !== expectedHeadCommit
  ) {
    throw new Error("release PR head is not the generated release commit");
  }
  if (
    !botUser ||
    botUser.login !== expectedBotLogin ||
    botUser.type !== "Bot" ||
    !Number.isInteger(botUser.id) ||
    pullRequest.user?.login !== expectedBotLogin ||
    pullRequest.user?.type !== "Bot" ||
    pullRequest.user?.id !== botUser.id
  ) {
    throw new Error("release PR was not created by the Release App bot");
  }
  if (commitSubject !== expectedTitle) {
    throw new Error("release PR head commit subject does not match the release title");
  }
  if (
    !Array.isArray(commitParents) ||
    commitParents.length !== 1 ||
    fullSha(commitParents[0], "release PR parent commit") !== expectedSourceCommit
  ) {
    throw new Error("release PR head commit must have exactly the planned source parent");
  }
  if (!Array.isArray(changedPaths) || changedPaths.length === 0) {
    throw new Error("release PR must contain changed files");
  }
  if (new Set(changedPaths).size !== changedPaths.length) {
    throw new Error("release PR changed files contain duplicates");
  }
  const unexpected = changedPaths.filter((path) => !isAllowedReleasePath(path));
  if (unexpected.length > 0) {
    throw new Error(`release PR contains unexpected files: ${unexpected.join(", ")}`);
  }
  if (!changedPaths.includes(PACKAGE_PUBSPEC) || !changedPaths.includes(PACKAGE_CHANGELOG)) {
    throw new Error("release PR must update pubspec.yaml and CHANGELOG.md");
  }
  return { branch: expectedBranch, title: expectedTitle, headCommit: expectedHeadCommit };
}

function validateAppSlug(value) {
  if (typeof value !== "string" || !APP_SLUG_PATTERN.test(value)) {
    throw new Error("RELEASE_APP_SLUG must be a lowercase GitHub App slug");
  }
  return value;
}

export function validateReleasePullRequest({
  pullRequests,
  botUser,
  appSlug,
  repository,
  commit,
  version,
}) {
  const expectedCommit = fullSha(commit, "release merge commit");
  const expectedRepository = required(repository, "GITHUB_REPOSITORY");
  const expectedVersion = parseVersion(version, "release version");
  const versionText = `${expectedVersion.major}.${expectedVersion.minor}.${expectedVersion.patch}`;
  const expectedBranch = `${RELEASE_BRANCH_PREFIX}${versionText}`;
  const expectedBotLogin = `${validateAppSlug(appSlug)}[bot]`;
  if (!Array.isArray(pullRequests) || pullRequests.length !== 1) {
    throw new Error("release merge commit must have exactly one associated pull request");
  }
  if (
    !botUser ||
    botUser.login !== expectedBotLogin ||
    botUser.type !== "Bot" ||
    !Number.isInteger(botUser.id)
  ) {
    throw new Error("Release App bot identity could not be verified");
  }
  const [pullRequest] = pullRequests;
  if (pullRequest.merge_commit_sha !== expectedCommit) {
    throw new Error("associated pull request does not merge the current release commit");
  }
  if (
    pullRequest.state !== "closed" ||
    typeof pullRequest.merged_at !== "string" ||
    pullRequest.merged_at.length === 0
  ) {
    throw new Error("associated pull request is not merged");
  }
  if (pullRequest.title !== `chore(release): prepare flutter_quill_editor ${versionText}`) {
    throw new Error("associated pull request title does not match the release version");
  }
  if (
    pullRequest.base?.ref !== "main" ||
    pullRequest.base?.repo?.full_name !== expectedRepository
  ) {
    throw new Error("associated pull request base is not the protected main branch");
  }
  if (
    pullRequest.head?.ref !== expectedBranch ||
    pullRequest.head?.repo?.full_name !== expectedRepository
  ) {
    throw new Error("associated pull request head is not the generated release branch");
  }
  if (
    pullRequest.user?.login !== expectedBotLogin ||
    pullRequest.user?.type !== "Bot" ||
    pullRequest.user?.id !== botUser.id
  ) {
    throw new Error("associated pull request was not created by the Release App bot");
  }
  return pullRequest;
}

export function detectReleaseCommit({
  root = REPOSITORY_ROOT,
  commit = git(["rev-parse", "HEAD"], root),
}) {
  const normalizedCommit = assertCommit(commit, "release commit");
  const subject = git(["show", "-s", "--format=%s", normalizedCommit], root);
  if (!RELEASE_COMMIT_PATTERN.test(subject)) {
    return { release: false, commit: normalizedCommit, subject };
  }
  const parent = assertCommit(git(["rev-parse", `${normalizedCommit}^`], root), "release parent");
  const version = readPackageVersion(git(["show", `${normalizedCommit}:${PACKAGE_PUBSPEC}`], root));
  const parentVersion = readPackageVersion(git(["show", `${parent}:${PACKAGE_PUBSPEC}`], root));
  const changedPaths = git(["diff", "--name-only", parent, normalizedCommit], root)
    .split("\n")
    .map((path) => path.trim())
    .filter(Boolean);
  const changelog = git(["show", `${normalizedCommit}:${PACKAGE_CHANGELOG}`], root);
  const result = validateReleaseSnapshot({
    subject,
    version,
    parentVersion,
    changedPaths,
    changelog,
  });
  return {
    release: true,
    commit: normalizedCommit,
    parent,
    subject,
    changedPaths,
    ...result,
    changelogEntry: changelogEntryForVersion(changelog, result.version),
  };
}

class GitHubRequestError extends Error {
  constructor({ status, method, url, body }) {
    super(`GitHub request failed (${status}) for ${method} ${url}${body ? `: ${body}` : ""}`);
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

function createGitHubApi({
  apiUrl = "https://api.github.com",
  repository,
  token,
  fetchImpl = globalThis.fetch,
}) {
  if (typeof fetchImpl !== "function") throw new Error("fetch implementation is required");
  const base = required(apiUrl, "GITHUB_API_URL").replace(/\/$/, "");
  const parsedBase = new URL(base);
  if (parsedBase.protocol !== "https:" || parsedBase.origin !== "https://api.github.com") {
    throw new Error("GITHUB_API_URL must be https://api.github.com for release finalization");
  }
  const repositoryName = required(repository, "GITHUB_REPOSITORY");
  if (!/^[^/]+\/[^/]+$/.test(repositoryName)) {
    throw new Error("GITHUB_REPOSITORY must be in owner/name form");
  }
  const tokenValue = required(token, "RELEASE_GITHUB_TOKEN");

  async function requestUrl(url, displayPath, options = {}, expectedStatuses = null) {
    const method = options.method || "GET";
    const headers = {
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      ...options.headers,
      Authorization: `Bearer ${tokenValue}`,
    };
    const response = await fetchImpl(url, {
      ...options,
      method,
      headers,
      redirect: "error",
    });
    const body = await response.text();
    const accepted = expectedStatuses || (response.ok ? [response.status] : []);
    if (!accepted.includes(response.status)) {
      throw new GitHubRequestError({
        status: response.status,
        method,
        url: url.toString(),
        body,
      });
    }
    if (response.status === 404) return null;
    if (!body) return null;
    try {
      return JSON.parse(body);
    } catch {
      throw new Error(`GitHub returned non-JSON data for ${method} ${displayPath}`);
    }
  }

  async function request(path, options = {}, expectedStatuses = null) {
    return requestUrl(
      new URL(`${base}/repos/${repositoryName}${path}`),
      path,
      options,
      expectedStatuses,
    );
  }

  async function requestRoot(path, options = {}, expectedStatuses = null) {
    return requestUrl(new URL(`${base}${path}`), path, options, expectedStatuses);
  }

  return {
    async tagRef(tag) {
      const result = await request(`/git/ref/tags/${encodeURIComponent(tag)}`, {}, [200, 404]);
      return result;
    },
    async tagObject(sha) {
      return request(`/git/tags/${encodeURIComponent(sha)}`);
    },
    async createTag(body) {
      return request(
        "/git/tags",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
        [201],
      );
    },
    async createRef(body) {
      return request(
        "/git/refs",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
        [201],
      );
    },
    async releaseByTag(tag) {
      return request(`/releases/tags/${encodeURIComponent(tag)}`, {}, [200, 404]);
    },
    async pullRequestsForCommit(commit) {
      return request(`/commits/${encodeURIComponent(commit)}/pulls?per_page=100`);
    },
    async botUser(login) {
      return requestRoot(`/users/${encodeURIComponent(login)}`, {}, [200, 404]);
    },
    async createRelease(body) {
      return request(
        "/releases",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
        [201],
      );
    },
  };
}

export async function authorizeReleasePullRequest({ api, appSlug, repository, commit, version }) {
  const expectedBotLogin = `${validateAppSlug(appSlug)}[bot]`;
  const botUser = await api.botUser(expectedBotLogin);
  const pullRequests = await api.pullRequestsForCommit(fullSha(commit, "release merge commit"));
  return validateReleasePullRequest({
    pullRequests,
    botUser,
    appSlug,
    repository,
    commit,
    version,
  });
}

function fullSha(value, label) {
  if (typeof value !== "string" || !COMMIT_PATTERN.test(value))
    throw new Error(`${label} is invalid`);
  return value.toLowerCase();
}

async function resolveTagCommit(api, tag) {
  const ref = await api.tagRef(tag);
  if (ref === null) return null;
  if (ref.ref !== `refs/tags/${tag}` || !ref.object || typeof ref.object.sha !== "string") {
    throw new Error("GitHub returned an invalid package tag ref");
  }
  if (ref.object.type === "commit") {
    return { annotated: false, commit: fullSha(ref.object.sha, "package tag commit") };
  }
  if (ref.object.type !== "tag")
    throw new Error("package tag must point to a commit or annotated tag");
  const tagObject = await api.tagObject(fullSha(ref.object.sha, "package tag object"));
  if (tagObject.object?.type !== "commit")
    throw new Error("annotated package tag must point to a commit");
  return {
    annotated: true,
    commit: fullSha(tagObject.object.sha, "annotated package tag commit"),
  };
}

export async function ensureAnnotatedPackageTag({ api, tag, commit, message }) {
  const expectedCommit = fullSha(commit, "package release commit");
  const existing = await resolveTagCommit(api, tag);
  if (existing) {
    if (!existing.annotated) throw new Error(`existing package tag is not annotated: ${tag}`);
    if (existing.commit !== expectedCommit)
      throw new Error(`existing package tag points to a different commit: ${tag}`);
    return { created: false, tag };
  }
  let tagObject;
  try {
    tagObject = await api.createTag({ tag, message, object: expectedCommit, type: "commit" });
  } catch (error) {
    if (!(error instanceof GitHubRequestError) || error.status !== 422) throw error;
    const raced = await resolveTagCommit(api, tag);
    if (!raced || !raced.annotated || raced.commit !== expectedCommit) {
      throw new Error(`package tag creation raced with an incompatible tag: ${tag}`);
    }
    return { created: false, tag };
  }
  const tagObjectSha = fullSha(tagObject?.sha, "created package tag object");
  if (
    tagObject.object?.type !== "commit" ||
    fullSha(tagObject.object.sha, "created package tag commit") !== expectedCommit
  ) {
    throw new Error("GitHub created an unexpected annotated package tag object");
  }
  try {
    await api.createRef({ ref: `refs/tags/${tag}`, sha: tagObjectSha });
  } catch (error) {
    if (!(error instanceof GitHubRequestError) || error.status !== 422) throw error;
    const raced = await resolveTagCommit(api, tag);
    if (!raced || !raced.annotated || raced.commit !== expectedCommit) {
      throw new Error(`package tag ref creation raced with an incompatible tag: ${tag}`);
    }
  }
  const final = await resolveTagCommit(api, tag);
  if (!final?.annotated || final.commit !== expectedCommit) {
    throw new Error(`package tag did not resolve to the expected annotated commit: ${tag}`);
  }
  return { created: true, tag };
}

function normalizedMarkdown(value) {
  return String(value || "")
    .replace(/\r\n/g, "\n")
    .trim();
}

function validatePackageRelease(release, { tag, name, body }) {
  if (!release || release.tag_name !== tag)
    throw new Error("GitHub package Release tag is invalid");
  if (release.draft === true || release.prerelease === true)
    throw new Error("package Release must be published");
  if (release.name !== name) throw new Error("existing package Release name differs");
  if (normalizedMarkdown(release.body) !== normalizedMarkdown(body)) {
    throw new Error("existing package Release notes differ; refusing to overwrite");
  }
  return release;
}

export async function ensurePackageRelease({ api, tag, commit, version, body }) {
  const name = `${PACKAGE_TAG_PREFIX}${version}`;
  const existing = await api.releaseByTag(tag);
  if (existing)
    return { created: false, release: validatePackageRelease(existing, { tag, name, body }) };
  let release;
  try {
    release = await api.createRelease({
      tag_name: tag,
      target_commitish: commit,
      name,
      body,
      draft: false,
      prerelease: false,
    });
  } catch (error) {
    if (!(error instanceof GitHubRequestError) || error.status !== 422) throw error;
    const raced = await api.releaseByTag(tag);
    if (!raced) throw error;
    return { created: false, release: validatePackageRelease(raced, { tag, name, body }) };
  }
  return { created: true, release: validatePackageRelease(release, { tag, name, body }) };
}

async function finalize({
  root = REPOSITORY_ROOT,
  commit,
  api,
  repository,
  appSlug,
  detection = null,
}) {
  const release = detection || detectReleaseCommit({ root, commit });
  if (!release.release) {
    console.log(`commit ${release.commit} is not an automated package release; finalizer skipped`);
    return release;
  }
  await authorizeReleasePullRequest({
    api,
    appSlug,
    repository,
    commit: release.commit,
    version: release.version,
  });
  const tagMessage = `${release.packageTag}\n\n${release.changelogEntry}`;
  await ensureAnnotatedPackageTag({
    api,
    tag: release.packageTag,
    commit: release.commit,
    message: tagMessage,
  });
  await ensurePackageRelease({
    api,
    tag: release.packageTag,
    commit: release.commit,
    version: release.version,
    body: release.changelogEntry,
  });
  console.log(`finalized ${release.packageTag} at ${release.commit}`);
  return release;
}

async function main() {
  const root = REPOSITORY_ROOT;
  const commit = process.env.GITHUB_SHA || git(["rev-parse", "HEAD"], root);
  if (process.argv.includes("--detect")) {
    console.log(JSON.stringify(detectReleaseCommit({ root, commit }), null, 2));
    return;
  }
  const repository = required(process.env.GITHUB_REPOSITORY, "GITHUB_REPOSITORY");
  const appSlug = validateAppSlug(process.env.RELEASE_APP_SLUG);
  const api = createGitHubApi({
    apiUrl: process.env.GITHUB_API_URL || "https://api.github.com",
    repository,
    token: process.env.RELEASE_GITHUB_TOKEN,
  });
  await finalize({ root, commit, api, repository, appSlug });
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname)) {
  main().catch((error) => {
    console.error(`release finalization failed: ${error.message}`);
    process.exitCode = 1;
  });
}
