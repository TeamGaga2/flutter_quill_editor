import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vite-plus/test";
import {
  applyPackageRelease,
  bumpVersion,
  createReleasePlan,
  flattenRuntimeLock,
  generateChangelog,
  isRuntimeInputPath,
  parseConventionalCommit,
  parseReleaseTrigger,
  parseVersion,
  renderReleaseEvidence,
  runtimeInputChanged,
} from "./release-plan.mjs";
import { runtimeArtifactTag } from "./runtime-release.mjs";

const sha = (character) => character.repeat(40);

function lock(sourceCommit = sha("a")) {
  return {
    schemaVersion: 1,
    artifact: {
      repository: "TeamGaga2/flutter_quill_editor",
      releaseTag: runtimeArtifactTag(sourceCommit),
      archiveName: "webview-runtime.tar.gz",
      archiveSha256: "b".repeat(64),
      contentSha256: "c".repeat(64),
    },
    runtime: {
      sourceCommit,
      buildId: sourceCommit,
      protocolVersion: 2,
      hostEnvelopeVersion: 1,
      webEntry: "iframe.abc.html",
      webEntrySha256: "d".repeat(64),
    },
  };
}

function plan(overrides = {}) {
  return createReleasePlan({
    bump: "patch",
    currentVersion: "0.1.1",
    sourceCommit: sha("e"),
    baseTag: "dart-v0.1.1",
    baseTagCommit: sha("f"),
    commits: [
      { sha: sha("1"), subject: "fix(runtime): close the editor cleanly", body: "" },
      { sha: sha("2"), subject: "feat(api): add an explicit release path", body: "" },
    ],
    changedPaths: ["clients/flutter_quill_editor/lib/editor.dart"],
    runtimeChanged: false,
    runtimeLock: lock(),
    ...overrides,
  });
}

describe("release version planning", () => {
  test("bumps only stable patch, minor, and major versions", () => {
    expect(parseVersion("0.1.1")).toEqual({ major: 0, minor: 1, patch: 1 });
    expect(bumpVersion("0.1.1", "patch")).toBe("0.1.2");
    expect(bumpVersion("0.1.1", "minor")).toBe("0.2.0");
    expect(bumpVersion("0.1.1", "major")).toBe("1.0.0");
    expect(() => bumpVersion("0.1.1", "pre")).toThrow(/patch, minor, or major/);
    expect(() => parseVersion("v0.1.1")).toThrow(/stable SemVer/);
  });

  test("parses manual and internal restart triggers without exposing attempt in the UI", () => {
    expect(parseReleaseTrigger({ eventName: "workflow_dispatch", manualBump: "minor" })).toEqual({
      kind: "manual",
      bump: "minor",
      attempt: 0,
    });
    expect(
      parseReleaseTrigger({
        eventName: "repository_dispatch",
        action: "flutter-release-restart",
        actor: "github-actions[bot]",
        restartBump: "patch",
        restartAttempt: "2",
      }),
    ).toEqual({ kind: "restart", bump: "patch", attempt: 2 });
    expect(() =>
      parseReleaseTrigger({
        eventName: "repository_dispatch",
        action: "flutter-release-restart",
        actor: "ordinary-user",
        restartBump: "patch",
        restartAttempt: "1",
      }),
    ).toThrow(/github-actions/);
    expect(() =>
      parseReleaseTrigger({
        eventName: "repository_dispatch",
        action: "flutter-release-restart",
        actor: "github-actions[bot]",
        restartBump: "patch",
        restartAttempt: "4",
      }),
    ).toThrow(/attempt/);
  });

  test("classifies conventional commits and detects breaking changes", () => {
    expect(
      parseConventionalCommit({ sha: sha("a"), subject: "feat(api)!: change the wire shape" }),
    ).toMatchObject({
      type: "feat",
      scope: "api",
      category: "breaking",
      breaking: true,
    });
    expect(
      parseConventionalCommit({
        sha: sha("b"),
        subject: "refactor: simplify the host",
        body: "BREAKING CHANGE: old host hooks are removed",
      }),
    ).toMatchObject({ category: "breaking", breaking: true });
  });

  test("generates grouped changelog entries from commits", () => {
    const output = generateChangelog(
      [
        { sha: sha("a"), subject: "Merge pull request #1 from TeamGaga2/dev" },
        { sha: sha("b"), subject: "feat(editor): add paste support" },
        { sha: sha("c"), subject: "fix: preserve selection" },
        { sha: sha("d"), subject: "docs: update the runbook" },
      ],
      "0.2.0",
    );
    expect(output).toContain("## 0.2.0");
    expect(output.indexOf("### Features")).toBeLessThan(output.indexOf("### Fixes"));
    expect(output).toContain("- feat(editor): add paste support (bbbbbbb)");
    expect(output).toContain("- docs: update the runbook (ddddddd)");
    expect(() =>
      generateChangelog(
        [{ sha: sha("a"), subject: "chore(release): prepare flutter_quill_editor 0.2.0" }],
        "0.2.0",
      ),
    ).toThrow(/no publishable commits/);
  });
});

describe("runtime change detection", () => {
  test("only runtime inputs require a new exact promotion", () => {
    expect(isRuntimeInputPath("apps/webview-runtime/src/main.ts")).toBe(true);
    expect(isRuntimeInputPath("packages/protocol/src/messages.ts")).toBe(true);
    expect(isRuntimeInputPath("scripts/release-plan.mjs")).toBe(false);
    expect(isRuntimeInputPath(".github/workflows/release-flutter-package.yml")).toBe(false);
    expect(runtimeInputChanged(["clients/flutter_quill_editor/CHANGELOG.md"])).toBe(false);
    expect(runtimeInputChanged(["scripts/runtime-release.mjs"])).toBe(true);
  });

  test("plan keeps the previous immutable tag when runtime bytes did not change", () => {
    const result = plan();
    expect(result.runtimeChanged).toBe(false);
    expect(result.runtimeArtifactTag).toBe(runtimeArtifactTag(sha("a")));
    expect(result.packageTag).toBe("dart-v0.1.2");
    expect(result.releaseBranch).toBe("automation/flutter-release-v0.1.2");
  });

  test("plan selects the exact source commit when runtime inputs changed", () => {
    const result = plan({
      runtimeChanged: true,
      changedPaths: ["apps/webview-runtime/src/main.ts"],
    });
    expect(result.runtimeArtifactTag).toBe(runtimeArtifactTag(sha("e")));
    expect(result.previousRuntimeSourceCommit).toBe(sha("a"));
    expect(result.runtimeSourceCommit).toBe(sha("e"));
  });

  test("rejects a lock whose tag does not match its source commit", () => {
    expect(() =>
      flattenRuntimeLock({ ...lock(), artifact: { ...lock().artifact, releaseTag: "wrong" } }),
    ).toThrow(/releaseTag does not match/);
  });

  test("rejects a lock with a different repository or malformed digest", () => {
    expect(() =>
      flattenRuntimeLock({
        ...lock(),
        artifact: { ...lock().artifact, repository: "someone/else" },
      }),
    ).toThrow(/repository/);
    expect(() =>
      flattenRuntimeLock({
        ...lock(),
        artifact: { ...lock().artifact, archiveSha256: "not-a-sha" },
      }),
    ).toThrow(/archiveSha256/);
  });
});

describe("version and changelog application", () => {
  test("updates pubspec and changelog once, then is idempotent", () => {
    const root = mkdtempSync(join(tmpdir(), "tg-release-plan-"));
    const pubspecPath = join(root, "pubspec.yaml");
    const changelogPath = join(root, "CHANGELOG.md");
    const releasePlan = plan();
    try {
      writeFileSync(pubspecPath, "name: flutter_quill_editor\nversion: 0.1.1\n");
      writeFileSync(changelogPath, "# Changelog\n\n## 0.1.1\n\n- Existing release.\n");
      expect(applyPackageRelease({ pubspecPath, changelogPath, plan: releasePlan })).toBe(true);
      expect(readFileSync(pubspecPath, "utf8")).toContain("version: 0.1.2\n");
      expect(readFileSync(pubspecPath, "utf8")).toContain(
        "name: flutter_quill_editor\nversion: 0.1.2\n",
      );
      expect(readFileSync(changelogPath, "utf8").startsWith("# Changelog\n\n## 0.1.2")).toBe(true);
      expect(applyPackageRelease({ pubspecPath, changelogPath, plan: releasePlan })).toBe(false);
      expect(readFileSync(changelogPath, "utf8").match(/## 0\.1\.2/g)).toHaveLength(1);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("fails closed when the package changed before application", () => {
    const root = mkdtempSync(join(tmpdir(), "tg-release-plan-mismatch-"));
    const pubspecPath = join(root, "pubspec.yaml");
    const changelogPath = join(root, "CHANGELOG.md");
    try {
      writeFileSync(pubspecPath, "name: flutter_quill_editor\nversion: 0.1.2\n");
      writeFileSync(changelogPath, "# Changelog\n");
      expect(() => applyPackageRelease({ pubspecPath, changelogPath, plan: plan() })).toThrow(
        /version changed/,
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

test("renders release evidence with exact asset rows", () => {
  const root = mkdtempSync(join(tmpdir(), "tg-release-evidence-"));
  const evidencePath = join(root, "assets.tsv");
  try {
    const releasePlan = plan({ runtimeChanged: true });
    const release = {
      tag_name: releasePlan.runtimeArtifactTag,
      draft: false,
      prerelease: false,
      assets: [
        {
          name: "runtime-artifact.json",
          id: 1,
          size: 10,
          browser_download_url:
            "https://github.com/TeamGaga2/flutter_quill_editor/releases/assets/1",
        },
        {
          name: "webview-runtime.tar.gz",
          id: 2,
          size: 20,
          browser_download_url:
            "https://github.com/TeamGaga2/flutter_quill_editor/releases/assets/2",
        },
        {
          name: "webview-runtime.tar.gz.sha256",
          id: 3,
          size: 30,
          browser_download_url:
            "https://github.com/TeamGaga2/flutter_quill_editor/releases/assets/3",
        },
      ],
    };
    writeFileSync(
      evidencePath,
      [
        `runtime-artifact.json\t1\t10\t${"e".repeat(64)}\thttps://github.com/TeamGaga2/flutter_quill_editor/releases/assets/1`,
        `webview-runtime.tar.gz\t2\t20\t${"f".repeat(64)}\thttps://github.com/TeamGaga2/flutter_quill_editor/releases/assets/2`,
        `webview-runtime.tar.gz.sha256\t3\t30\t${"a".repeat(64)}\thttps://github.com/TeamGaga2/flutter_quill_editor/releases/assets/3`,
      ].join("\n"),
    );
    const output = renderReleaseEvidence({
      plan: releasePlan,
      lockAfter: lock(sha("e")),
      release,
      assetEvidencePath: evidencePath,
      promotionRunUrl: "https://github.com/TeamGaga2/flutter_quill_editor/actions/runs/1",
    });
    expect(output).toContain("Remote asset");
    expect(output).toContain("runtime-artifact.json");
    expect(output).toContain("actions/runs/1");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
