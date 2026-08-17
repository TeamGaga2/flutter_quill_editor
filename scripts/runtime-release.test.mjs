import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vite-plus/test";
import {
  branchIdentity,
  createArchive,
  makeReleaseMetadata,
  parseReleaseTag,
  releaseTag,
  validateRuntimeDist,
} from "./runtime-release.mjs";

describe("runtime release identity", () => {
  test("uses the full branch name and pipeline IID", () => {
    const branch = "feature/editor/dev";
    const tag = releaseTag({ branch, pipelineIid: 42 });
    expect(tag).toContain(branchIdentity(branch).slice(0, 16));
    expect(parseReleaseTag(tag)?.pipelineIid).toBe(42);
  });

  test("metadata binds branch, commit, pipeline and archive checksum", () => {
    const branch = "dev";
    const tag = releaseTag({ branch, pipelineIid: 7 });
    const metadata = makeReleaseMetadata({
      branch,
      sourceCommit: "a".repeat(40),
      pipelineId: 11,
      pipelineIid: 7,
      tag,
      archiveSha256: "b".repeat(64),
      runtimeVersion: {
        protocolVersion: 1,
        hostEnvelopeVersion: 1,
        buildId: "build",
        builtAt: "2026-01-01T00:00:00.000Z",
      },
    });
    expect(metadata.branchIdentity).toBe(branchIdentity(branch));
    expect(metadata.releaseTag).toBe(tag);
    expect(metadata.archiveSha256).toBe("b".repeat(64));
    expect(metadata.generatedAt).toBe("2026-01-01T00:00:00.000Z");
  });
});

describe("runtime dist validation", () => {
  test("checks iframe hash and all HTML asset references", () => {
    const root = mkdtempSync(join(tmpdir(), "tg-runtime-dist-"));
    try {
      mkdirSync(join(root, "assets"));
      writeFileSync(join(root, "assets", "main.js"), "console.log('ok')");
      const iframe = '<script src="./assets/main.js"></script>';
      writeFileSync(join(root, "iframe.abc.html"), iframe);
      writeFileSync(join(root, "index.html"), '<iframe src="./iframe.abc.html"></iframe>');
      writeFileSync(
        join(root, "runtime-version.json"),
        JSON.stringify({
          protocolVersion: 1,
          hostEnvelopeVersion: 1,
          buildId: "build",
          builtAt: "2026-01-01T00:00:00.000Z",
          package: "webview-runtime",
          sourceCommit: "a".repeat(40),
          webEntry: "iframe.abc.html",
          webEntrySha256: createHash("sha256").update(iframe).digest("hex"),
        }),
      );
      expect(validateRuntimeDist(root).sourceCommit).toBe("a".repeat(40));
      writeFileSync(join(root, "iframe.abc.html"), '<script src="./missing.js"></script>');
      expect(() => validateRuntimeDist(root)).toThrow(/missing|match/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

test("archive bytes are deterministic for the same dist", () => {
  const root = mkdtempSync(join(tmpdir(), "tg-runtime-archive-"));
  try {
    writeFileSync(join(root, "b.txt"), "b");
    writeFileSync(join(root, "a.txt"), "a");
    const first = join(root, "first.tar.gz");
    const second = join(root, "second.tar.gz");
    createArchive(root, first);
    const firstBytes = readFileSync(first);
    rmSync(first);
    createArchive(root, second);
    expect(readFileSync(second)).toEqual(firstBytes);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
