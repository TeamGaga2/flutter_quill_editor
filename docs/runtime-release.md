# WebView runtime release

> Proposed replacement: [ADR 0007](adr/0007-flutter-package-locks-immutable-runtime-artifact.md)
> and [the artifact sync implementation plan](plans/webview-runtime-artifact-sync-implementation-plan.md).
> PR-0 has not switched implementation; the branch/latest workflow described
> below remains the current production behavior until the migration is complete.

The GitHub Actions workflow publishes an immutable GitHub Release for the
`dev` branch after verification and the runtime build pass. Pull requests and
the `main` branch run verification only.

The release tag is
`webview-runtime-channel-<branch-slug>-<branch-identity>-<run-number>`. The
release contains `webview-runtime.tar.gz`, `runtime-release.json`, and the
archive checksum. The metadata keeps the source commit, branch, GitHub run ID,
run number, protocol versions, and archive SHA-256 together.

The publishing job uses the workflow's `GITHUB_TOKEN` with `contents: write`.
It verifies an existing release with the same tag before treating the run as
successful. A new release stays as a draft while all three assets are uploaded
and read back; it is published only after every byte matches the verified
runtime build.

## PR-1 parallel promotion path

PR-1 adds `runtime-artifact-promotion.yml` without changing the legacy `dev`
consumer path. Its build job has `contents: read`, checks an exact
`sourceCommit` reachable from `origin/dev` or `origin/main`, and uploads a
7-day Actions artifact. The publish job downloads only that three-file artifact
and runs the exact-tag publisher with `contents: write` inside the protected
`runtime-artifact-promotion` Environment. Repository administrators must
configure that protected Environment in GitHub, including required reviewers
and branch restrictions, before formally enabling promotion. PR-1 remains a
parallel path and does not switch the current legacy behavior.
The write-capable job checks out the workflow revision for the publisher; it
does not execute JavaScript from the selected runtime source commit.

The shared `scripts/fixtures/runtime-content-sha256.json` freezes the
cross-language content digest. The PR-2 Dart verifier and local artifact
materialization framework consume it, but this checkout deliberately does not
commit `richtext-runtime.lock.json`: no promoted exact Release has been proved
for the current vendored bytes. The legacy consumer therefore remains the
working production path until the promotion and remote byte-readback gate is
completed.
Both builders use the same portable printable-ASCII runtime path rule
(rejecting non-ASCII, control characters, backslashes and traversal); the
canonical digest framing itself remains UTF-8.
