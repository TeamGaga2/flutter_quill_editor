# Release automation security policy

This repository uses a single-click GitHub Actions release flow for
`flutter_quill_editor`. The person who clicks **Run workflow** authorizes that
one release attempt. After that point the workflow is allowed to finish
without a second human approval, but every state-changing step remains behind
machine-readable, fail-closed checks.

## Credentials

- `PUB_ACCESS_TOKEN` is not used. pub.dev publishing uses the official GitHub
  Actions OIDC flow and a tag pattern of `dart-v{{version}}`.
- The first package version must still be published manually with `dart pub
publish` because pub.dev does not allow OIDC to create a package. For this
  repository that bootstrap version is `0.1.1`; later versions are automated.
- `RELEASE_APP_ID` is a repository Actions variable, not a secret.
- `RELEASE_APP_PRIVATE_KEY` is a repository or `release-automation` Environment
  secret. No real value may be committed, placed in workflow YAML, or printed
  in evidence.
- The GitHub App must be installed on this repository only. Its permissions
  are Contents read/write, Pull requests read/write, Issues read/write,
  Checks read-only, Actions read-only, and Metadata read-only. Checks and
  Actions read access is needed only to observe PR/run conclusions; the
  workflow still requests an installation token scoped to this repository.

## pub.dev OIDC Environment

Create a GitHub Environment named exactly `pub.dev` with no required
reviewers. Its deployment branch/tag rule must allow only tags matching
`dart-v*`. The OIDC reusable publish workflow receives this environment name
explicitly.

In pub.dev Admin → Automated publishing, bind the same repository
`TeamGaga2/flutter_quill_editor`, GitHub Environment `pub.dev`, and tag pattern
`dart-v{{version}}`. The GitHub Environment name and the pub.dev binding must
match exactly; otherwise the OIDC token is rejected.

## Required GitHub configuration

Repository administrators must configure these controls once; this change set
does not modify remote settings:

1. Protect `main` with the release workflow's checks, forbid force-push and
   deletion, and require pull requests. Do not require a second human review
   for the generated release PR; the workflow dispatch, exact artifact proof,
   package checks, and finalizer are the release gates.
2. Protect `dart-v*` tags so only the repository-scoped Release App can create
   them.
3. Protect `automation/flutter-release-*` branches so only the repository-
   scoped Release App can create, update, or delete them. Human users and
   other workflow tokens must not have those branch permissions.
4. Keep `runtime-artifact-promotion` restricted to `main` and do not add an
   interactive reviewer if unattended releases are desired. The job still
   retains `contents: write` only in the publishing job.
5. Create the `release-automation` Environment without reviewers, or store the
   private key as a repository secret. Do not make this Environment a hidden
   second approval gate.
6. Create the `pub.dev` Environment as described above: no reviewers and only
   `dart-v*` tags.
7. In pub.dev Admin, bind repository `TeamGaga2/flutter_quill_editor` to the
   `pub.dev` Environment with tag pattern `dart-v{{version}}`.
8. Add `@LazyBoppy` and `@hyzmm` as repository collaborators with the required
   review authority, and enforce `.github/CODEOWNERS` through branch rules.

## Machine gates

The one-click flow refuses to continue when any of these conditions is false:

- the dispatch came from `main` and the source SHA remains unchanged;
- if `main` changes while a generated release PR is pending, the old PR and
  branch are closed/deleted and an internal `repository_dispatch` carrying the
  same `bump` and the incremented `attempt` is sent from `main`; the manual UI
  exposes only `bump`, attempts start at `0`, and at most three restarts are
  accepted;
- the current package tag matches the package version and the target version
  does not already have a tag;
- runtime changes are promoted through the existing exact-source immutable
  artifact workflow, including Artifact Contract and byte verification;
- an exact Release update verifies archive, metadata, sidecar, content digest,
  entry digest, HTML references, and protocol compatibility before changing
  lock/vendor/manifest files;
- the generated PR contains only the allowed package release files;
- all PR checks pass and both the PR head and `main` are unchanged immediately
  before squash merge;
- the finalizer finds exactly one PR associated with the merge commit and
  verifies the Release App bot, `main` base, generated head branch, merged
  state, and exact release title before creating any tag or Release;
- the post-merge commit has the generated release shape and the expected stable
  one-step version bump;
- the finalizer finds no conflicting annotated tag or GitHub Release.

No existing tag, Release, artifact, or package version is overwritten. A
partial run is retried only after the exact current state has been read back;
any mismatch fails the run.

When an automatic restart is performed, the old run ends successfully as
`superseded` and skips merge, finalizer, and publish waiting. If the three-run
restart limit is reached, the workflow fails closed and requires a fresh human
dispatch.

## Recovery

If pub.dev publishing fails after the annotated tag exists, rerun the
tag-triggered `Flutter client` workflow for that exact tag. If the finalizer
fails, rerun `Finalize Flutter package release` only after confirming that the
merge commit is still the generated release commit. Never move a tag or replace
an immutable runtime Release. If a package version is already published, fix
the source and publish a new patch version.
