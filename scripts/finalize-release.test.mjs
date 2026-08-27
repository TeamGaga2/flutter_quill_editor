import { describe, expect, test } from "vite-plus/test";
import {
  authorizeReleasePullRequest,
  changelogEntryForVersion,
  ensureAnnotatedPackageTag,
  ensurePackageRelease,
  isAllowedReleasePath,
  validateOpenReleasePullRequest,
  validateReleasePullRequest,
  validateReleaseSnapshot,
} from "./finalize-release.mjs";

const sha = (character) => character.repeat(40);
const repository = "TeamGaga2/flutter_quill_editor";
const appSlug = "release-automation";
const releaseCommit = sha("a");
const releaseSourceCommit = sha("b");

function releasePullRequest(overrides = {}) {
  return {
    number: 42,
    merge_commit_sha: releaseCommit,
    state: "closed",
    merged_at: "2026-08-27T00:00:00Z",
    title: "chore(release): prepare flutter_quill_editor 0.1.2",
    base: { ref: "main", repo: { full_name: repository } },
    head: {
      ref: "automation/flutter-release-v0.1.2",
      repo: { full_name: repository },
    },
    user: { login: `${appSlug}[bot]`, type: "Bot", id: 9001 },
    ...overrides,
  };
}

function releaseApi({ pullRequests = [releasePullRequest()], botUser } = {}) {
  return {
    async botUser() {
      return botUser || { login: `${appSlug}[bot]`, type: "Bot", id: 9001 };
    },
    async pullRequestsForCommit() {
      return pullRequests;
    },
  };
}

function openReleasePullRequest(overrides = {}) {
  return {
    ...releasePullRequest(),
    state: "open",
    head: {
      ref: "automation/flutter-release-v0.1.2",
      sha: releaseCommit,
      repo: { full_name: repository },
    },
    ...overrides,
  };
}

describe("release finalizer validation", () => {
  test("accepts exactly one stable version bump and the generated file set", () => {
    const result = validateReleaseSnapshot({
      subject: "chore(release): prepare flutter_quill_editor 0.1.2",
      version: "0.1.2",
      parentVersion: "0.1.1",
      changedPaths: [
        "clients/flutter_quill_editor/pubspec.yaml",
        "clients/flutter_quill_editor/CHANGELOG.md",
        "clients/flutter_quill_editor/richtext-runtime.lock.json",
      ],
      changelog: "# Changelog\n\n## 0.1.2\n\n- fix: preserve selection\n",
    });
    expect(result).toEqual({ version: "0.1.2", packageTag: "dart-v0.1.2" });
    expect(
      isAllowedReleasePath(
        "clients/flutter_quill_editor/assets/richtext_webview_runtime/index.html",
      ),
    ).toBe(true);
    expect(isAllowedReleasePath(".github/workflows/release-flutter-package.yml")).toBe(false);
  });

  test("authorizes exactly one merged PR created by the Release App bot", async () => {
    const result = await authorizeReleasePullRequest({
      api: releaseApi(),
      appSlug,
      repository,
      commit: releaseCommit,
      version: "0.1.2",
    });
    expect(result.number).toBe(42);
  });

  test("rejects an ordinary user even when the release shape is otherwise valid", async () => {
    const pullRequest = releasePullRequest({
      user: { login: "ordinary-user", type: "User", id: 7 },
    });
    await expect(
      authorizeReleasePullRequest({
        api: releaseApi({ pullRequests: [pullRequest] }),
        appSlug,
        repository,
        commit: releaseCommit,
        version: "0.1.2",
      }),
    ).rejects.toThrow(/Release App bot/);
  });

  test("rejects a release PR with the wrong branch or title", () => {
    expect(() =>
      validateReleasePullRequest({
        pullRequests: [
          releasePullRequest({
            head: { ref: "automation/other", repo: { full_name: repository } },
          }),
        ],
        botUser: { login: `${appSlug}[bot]`, type: "Bot", id: 9001 },
        appSlug,
        repository,
        commit: releaseCommit,
        version: "0.1.2",
      }),
    ).toThrow(/generated release branch/);
    expect(() =>
      validateReleasePullRequest({
        pullRequests: [releasePullRequest({ title: "chore: fake release" })],
        botUser: { login: `${appSlug}[bot]`, type: "Bot", id: 9001 },
        appSlug,
        repository,
        commit: releaseCommit,
        version: "0.1.2",
      }),
    ).toThrow(/title/);
  });

  test("rejects no associated PR or multiple associated PRs", async () => {
    const request = {
      api: releaseApi({ pullRequests: [] }),
      appSlug,
      repository,
      commit: releaseCommit,
      version: "0.1.2",
    };
    await expect(authorizeReleasePullRequest(request)).rejects.toThrow(/exactly one/);
    await expect(
      authorizeReleasePullRequest({
        ...request,
        api: releaseApi({ pullRequests: [releasePullRequest(), releasePullRequest()] }),
      }),
    ).rejects.toThrow(/exactly one/);
  });

  test("validates the open PR snapshot before it can be reused", () => {
    const valid = {
      pullRequest: openReleasePullRequest(),
      botUser: { login: `${appSlug}[bot]`, type: "Bot", id: 9001 },
      appSlug,
      repository,
      sourceCommit: releaseSourceCommit,
      nextVersion: "0.1.2",
      headCommit: releaseCommit,
      commitSubject: "chore(release): prepare flutter_quill_editor 0.1.2",
      commitParents: [releaseSourceCommit],
      changedPaths: [
        "clients/flutter_quill_editor/pubspec.yaml",
        "clients/flutter_quill_editor/CHANGELOG.md",
        "clients/flutter_quill_editor/richtext-runtime.lock.json",
      ],
    };
    expect(validateOpenReleasePullRequest(valid)).toMatchObject({
      branch: "automation/flutter-release-v0.1.2",
      headCommit: releaseCommit,
    });
    expect(() =>
      validateOpenReleasePullRequest({
        ...valid,
        pullRequest: openReleasePullRequest({
          user: { login: "ordinary-user", type: "User", id: 7 },
        }),
      }),
    ).toThrow(/Release App bot/);
    expect(() =>
      validateOpenReleasePullRequest({
        ...valid,
        pullRequest: openReleasePullRequest({
          head: {
            ref: "automation/wrong",
            sha: releaseCommit,
            repo: { full_name: repository },
          },
        }),
      }),
    ).toThrow(/generated release commit/);
    expect(() =>
      validateOpenReleasePullRequest({
        ...valid,
        commitSubject: "chore: fake release",
      }),
    ).toThrow(/commit subject/);
    expect(() =>
      validateOpenReleasePullRequest({
        ...valid,
        commitParents: [releaseSourceCommit, sha("c")],
      }),
    ).toThrow(/exactly the planned source parent/);
    expect(() =>
      validateOpenReleasePullRequest({
        ...valid,
        changedPaths: ["clients/flutter_quill_editor/pubspec.yaml"],
      }),
    ).toThrow(/pubspec.yaml and CHANGELOG/);
  });

  test("rejects unexpected files, mismatched versions, and missing changelog headings", () => {
    const base = {
      subject: "chore(release): prepare flutter_quill_editor 0.1.2",
      version: "0.1.2",
      parentVersion: "0.1.1",
      changedPaths: [
        "clients/flutter_quill_editor/pubspec.yaml",
        "clients/flutter_quill_editor/CHANGELOG.md",
      ],
      changelog: "# Changelog\n\n## 0.1.2\n",
    };
    expect(() =>
      validateReleaseSnapshot({
        ...base,
        changedPaths: [...base.changedPaths, "scripts/release-plan.mjs"],
      }),
    ).toThrow(/unexpected files/);
    expect(() => validateReleaseSnapshot({ ...base, version: "0.1.3" })).toThrow(/does not match/);
    expect(() => validateReleaseSnapshot({ ...base, changelog: "# Changelog\n" })).toThrow(
      /missing release heading/,
    );
  });

  test("extracts only the requested changelog section", () => {
    const changelog = "# Changelog\n\n## 0.2.0\n\n- new\n\n## 0.1.2\n\n- old\n";
    expect(changelogEntryForVersion(changelog, "0.2.0")).toBe("## 0.2.0\n\n- new");
    expect(changelogEntryForVersion(changelog, "0.1.2")).toBe("## 0.1.2\n\n- old");
  });
});

test("finalizer refuses to reuse a lightweight tag", async () => {
  const api = {
    async tagRef() {
      return {
        ref: "refs/tags/dart-v0.1.2",
        object: { type: "commit", sha: sha("a") },
      };
    },
  };
  await expect(
    ensureAnnotatedPackageTag({
      api,
      tag: "dart-v0.1.2",
      commit: sha("a"),
      message: "release",
    }),
  ).rejects.toThrow(/not annotated/);
});

test("finalizer treats an already matching annotated tag and Release as idempotent", async () => {
  const tagObjectSha = sha("b");
  const releaseBody = "## 0.1.2\n\n- fix: preserve selection";
  const calls = [];
  const api = {
    async tagRef() {
      calls.push("tagRef");
      return {
        ref: "refs/tags/dart-v0.1.2",
        object: { type: "tag", sha: tagObjectSha },
      };
    },
    async tagObject() {
      calls.push("tagObject");
      return { object: { type: "commit", sha: sha("a") } };
    },
    async releaseByTag() {
      calls.push("releaseByTag");
      return {
        tag_name: "dart-v0.1.2",
        draft: false,
        prerelease: false,
        name: "dart-v0.1.2",
        body: releaseBody,
      };
    },
  };
  await expect(
    ensureAnnotatedPackageTag({
      api,
      tag: "dart-v0.1.2",
      commit: sha("a"),
      message: "release",
    }),
  ).resolves.toEqual({ created: false, tag: "dart-v0.1.2" });
  await expect(
    ensurePackageRelease({
      api,
      tag: "dart-v0.1.2",
      commit: sha("a"),
      version: "0.1.2",
      body: releaseBody,
    }),
  ).resolves.toMatchObject({ created: false });
  expect(calls).toContain("releaseByTag");
});
