# Runtime lock update

Use this template only for a formal update from a **published, immutable,
exact-tag runtime artifact**. This PR must not use `--local`,
`--from-artifact --allow-unpublished`, a branch/latest resolver, a cache-only
input, or a fallback artifact.

> Operational reference: [runtime artifact promotion, pin, verification, and
> rollback runbook](../../docs/runbooks/runtime-artifact-promotion.md).

## Purpose and source

- Runtime source PR or change:
- Promotion workflow run URL/ID:
- GitHub Environment approval record:
- Exact source commit (new, full 40-character SHA):
- Exact artifact tag (new):
- Was the source commit reachable from protected `dev`/`main` at promotion time? [ ]
- Was the Release already published and read back before this PR? [ ]

## Identity change

Fill every old/new value. Use `N/A (no previous formal lock)` only when the
repository genuinely has no previous formal lock, and explain the legacy
baseline in the notes.

| Field                 | Old value | New value | Evidence / notes |
| --------------------- | --------- | --------- | ---------------- |
| Runtime source commit |           |           |                  |
| Artifact release tag  |           |           |                  |
| Archive name          |           |           |                  |
| Archive SHA-256       |           |           |                  |
| Content SHA-256       |           |           |                  |
| Build ID              |           |           |                  |
| Web entry             |           |           |                  |
| Web entry SHA-256     |           |           |                  |
| `protocolVersion`     |           |           |                  |
| `hostEnvelopeVersion` |           |           |                  |

## Remote promotion evidence

- [ ] Real tag ref was queried and resolved to the exact new source commit
      (including annotated-tag resolution when applicable).
- [ ] Release `tag_name` is exactly the new tag and the Release is published,
      not draft.
- [ ] `runtime-artifact.json` was downloaded from the real Release; its bytes
      match the promotion output and its source commit matches the new commit.
- [ ] `webview-runtime.tar.gz` was downloaded from the real Release and its
      bytes hash to the metadata `archiveSha256`.
- [ ] `webview-runtime.tar.gz.sha256` was downloaded and is byte-for-byte the
      expected archive checksum line.
- [ ] Remote asset IDs, sizes, URLs, and observed SHA-256 values are recorded
      below or in an attached evidence artifact.

| Remote asset                    | Asset ID / URL | Expected size | Observed size | Expected SHA-256 | Observed SHA-256 |
| ------------------------------- | -------------- | ------------: | ------------: | ---------------- | ---------------- |
| `runtime-artifact.json`         |                |               |               |                  |                  |
| `webview-runtime.tar.gz`        |                |               |               |                  |                  |
| `webview-runtime.tar.gz.sha256` |                |               |               |                  |                  |

Do not paste GitHub tokens, signed URLs containing credentials, or authorization
headers into this PR.

## Required tracked outputs

The formal update must review these three groups together:

- [ ] `clients/flutter_quill_editor/richtext-runtime.lock.json`
- [ ] `clients/flutter_quill_editor/assets/richtext_webview_runtime/**`
- [ ] `clients/flutter_quill_editor/lib/host/runtime_manifest.dart`

Also confirm:

- [ ] `runtime-version.json` agrees with the new lock/runtime identity.
- [ ] No `richtext-runtime-channel.json` or legacy Release history was deleted
      as part of this PR unless a separately approved migration PR requires it.
- [ ] No unrelated runtime, Flutter host, protocol, or generated files changed.
- [ ] The generated manifest was produced by the tool and has no hand edits.

## Commands and test evidence

Commands run from `clients/flutter_quill_editor`:

```sh
dart run tool/richtext_runtime_prepare.dart --update --release-tag <exact-tag>
dart run tool/richtext_runtime_prepare.dart --verify
flutter analyze
flutter test
```

- [ ] `--update --release-tag <exact-tag>` completed without fallback.
- [ ] Offline `--verify` passed after the update.
- [ ] Archive checksum, content digest, entry SHA, HTML references, and
      protocol/host compatibility validation passed.
- [ ] Atomic materialization completed and no temporary/generated debris is
      present.
- [ ] Re-running `--verify` produces no diff.
- [ ] Relevant runtime integration/App offline evidence is attached, or the
      reason it is not applicable is recorded.
- [ ] `git diff --check` passed.

Validation notes/logs:

```text
<paste concise output summaries and links; do not paste credentials>
```

## Review and rollback

- Runtime compatibility impact:
- Known-good artifact/tag for rollback:
- Rollback plan if this PR is merged but not released:
- Package patch-release plan if a package was already published:
- [ ] Reviewer has checked the remote tag/ref and all three asset byte hashes.
- [ ] Reviewer has confirmed that this PR does not change promotion permissions,
      Environment rules, ADR status, or legacy behavior.
