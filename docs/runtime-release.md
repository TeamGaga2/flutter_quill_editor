# WebView runtime release

The repository has two separate runtime workflows:

1. Ordinary pull-request and `dev`/`main` pushes run the runtime checks and
   upload short-lived GitHub Actions artifacts for diagnostics. They never
   create or update a GitHub Release.
2. The protected `runtime-artifact-promotion.yml` workflow is manually
   dispatched with one full `sourceCommit`. After the
   `runtime-artifact-promotion` Environment approval, it builds that exact
   commit and publishes the immutable Release tag
   `webview-runtime-artifact-<sourceCommit>`.

The promoted Release contains exactly:

- `webview-runtime.tar.gz`;
- `runtime-artifact.json`;
- `webview-runtime.tar.gz.sha256`.

The metadata contains only distribution-neutral runtime identity: source
commit, build ID, protocol versions, entry information, archive SHA-256 and
canonical content SHA-256. Branch names, pipeline numbers and latest ordering
are not artifact identity.

## Flutter package updates

`clients/flutter_quill_editor/richtext-runtime.lock.json` is the only runtime
selector. A formal update names an exact promoted tag:

```sh
cd clients/flutter_quill_editor
dart run tool/richtext_runtime_prepare.dart \
  --update \
  --release-tag webview-runtime-artifact-<sourceCommit>
```

The update verifies the remote Release, safely extracts the archive, checks
the runtime identity and content digest, and atomically updates the lock,
vendored assets and generated manifest. Normal verification is offline:

```sh
dart run tool/richtext_runtime_prepare.dart --verify
flutter analyze
flutter test
```

For local Flutter integration, use `--local <distPath>`. It is ephemeral,
does not write the formal lock and must not be published. There is no branch,
latest or legacy fallback path.

See the [promotion, pin, verification and rollback runbook](runbooks/runtime-artifact-promotion.md)
and [ADR 0007](adr/0007-flutter-package-locks-immutable-runtime-artifact.md).
