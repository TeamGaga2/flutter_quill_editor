# WebView runtime release

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
