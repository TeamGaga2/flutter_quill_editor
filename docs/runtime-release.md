# WebView runtime release

The `dev` branch publishes an immutable GitLab Release after the runtime build
and asset checks pass. The release tag is
`webview-runtime-channel-<branch-slug>-<branch-identity>-<pipeline-iid>` where
the identity is the first 16 characters of the SHA-256 of the full branch name.

The pipeline uploads `webview-runtime.tar.gz`, `runtime-release.json`, and the
archive checksum to the Generic Package Registry, reads each upload back, and
only then creates the Release. A failed build or upload never creates a
client-consumable Release.

The publish script uses `CI_API_V4_URL`, `CI_PROJECT_ID`, `CI_JOB_TOKEN`,
`CI_COMMIT_BRANCH`, `CI_COMMIT_SHA`, `CI_PIPELINE_ID`, and `CI_PIPELINE_IID`.
For a self-managed GitLab, the project must allow the job token to write the
Generic Package Registry and create the generated tag/release. No token is put
in a URL, log, or artifact.
