# SDK Release Flow

This is the release process for Switchboard SDK packages and crates.

The hard rule is simple: release from `sbv3`. Do not release from
`switchboard-sdk`.

`sbv3` is the canonical source for SDK source code, manifests, lockfiles,
release notes, dry-runs, and real publish commands. `switchboard-sdk` is the
public mirror. It is synced from `sbv3` through Copybara and should normally
only change through that flow.

If `sbv3` and `switchboard-sdk` disagree, fix `sbv3` first, then sync the
mirror. Do not work around a mismatch by publishing from the mirror.

## Repositories

Use `sbv3` for release work:

- Version bumps.
- Manifest and lockfile updates.
- Release notes.
- Tests and dry-runs.
- Real `npm publish`, `pnpm publish`, and `cargo publish` commands.

Use `switchboard-sdk` only after the `sbv3` PR has merged:

- Confirm Copybara mirrored the expected files.
- Confirm mirrored manifests match the canonical `sbv3` manifests.
- Confirm public users can see the same release notes and process docs.

Do not prepare release-only branches in `switchboard-sdk`. Do not run release
guardrail scripts from `switchboard-sdk` unless a script is specifically testing
the mirror layout and the canonical `sbv3` state has already been verified.

## Mirrored SDK Paths

These are the main SDK paths that Copybara mirrors from `sbv3` into
`switchboard-sdk`:

| SDK | Canonical `sbv3` path | Public mirror path |
| --- | --- | --- |
| `@switchboard-xyz/on-demand` | `javascript/on-demand` | `solana/javascript/on-demand` |
| `@switchboard-xyz/common` | `javascript/common` | `javascript/common` |
| `@switchboard-xyz/sui-sdk` | `javascript/sui-sdk` | `javascript/sui-sdk` |
| `switchboard-on-demand` | `rust/switchboard-on-demand` | `solana/rust/switchboard-on-demand` |
| `switchboard-on-demand-client` | `rust/switchboard-on-demand-client` | `solana/rust/switchboard-on-demand-client` |
| Aptos SDKs | `chains/aptos` | `aptos` |
| Sail SDK | `rust/sail-sdk` | `sail/sail-sdk` |
| Surge core | `rust/switchboard-surge-core` | `surge/switchboard-surge-core` |
| Surge oracle | `rust/switchboard-surge-oracle` | `surge/switchboard-surge-oracle` |

When adding a new mirrored SDK path, update `sbv3/copy.bara.sky` and
`sbv3/.github/workflows/copybara.yml` in the same PR. If contributor changes
must sync back from `switchboard-sdk`, update the inverse Copybara config there
through the normal mirror-maintenance path, not as part of a release-only PR.

## Release Preparation

Start from a clean `sbv3` worktree based on current `origin/main`. Do not use a
dirty local checkout for release prep.

Before changing versions:

1. Check the latest published registry version for each SDK:

   ```bash
   npm view <package> version
   cargo info <crate>
   ```

2. Check the canonical `sbv3` manifest version and the matching lockfile entry.
3. Check the mirrored `switchboard-sdk` manifest version only as a comparison.
4. Audit merged `sbv3` PRs and commits since the last published release.
5. Decide the next version from the canonical `sbv3` changes, not from stale
   mirror state.
6. Write the source-of-truth results into the release-prep PR body.

If the release notes, registry latest version, `sbv3` manifest, or
`switchboard-sdk` mirror disagree, pause and resolve that mismatch before
continuing.

## Version And Lockfile Updates

Apply version bumps only in `sbv3`.

For npm packages:

- Update the package-local `package.json`.
- Update the relevant lockfile before running frozen installs.
- Add any imported runtime dependency as a direct dependency of the package.
- Keep test scripts wired into `package.json` so release-critical smoke tests
  run through normal package tests.

For Rust crates:

- Update the crate `Cargo.toml`.
- Update the crate lockfile when it tracks the crate package version.
- Run `cargo package --list` before publishing.
- Exclude local-only files such as `.env` from crate packages.

Do not bump another version number just because a publish command failed. First
confirm the current directory, manifest path, registry latest version, and
whether the version was changed in canonical `sbv3` or only in
`switchboard-sdk`.

## Release Notes

`SDK_RELEASE_NOTES.md` is the canonical release ledger.

For each release batch:

- Add the newest batch at the top.
- List each package or crate, target version, and status.
- Use short user-facing bullets.
- Include source PRs or commits where they clarify why a release is needed.
- Keep planned, prepared, dry-run verified, and published statuses explicit.

Before publishing, each release-note version must match:

- The canonical `sbv3` manifest.
- The canonical `sbv3` lockfile when the lockfile tracks the package or crate.
- The final `switchboard-sdk` mirror manifest after Copybara sync.
- The version shown by the publish dry-run.

## Public SDK Documentation Visibility

SDK README and source-comment changes are not visible everywhere at merge time.

- The public npm README for `@switchboard-xyz/on-demand` updates only after a
  new package version is published from canonical `sbv3`.
- Hosted TypeDoc updates only after running the package doc generation and
  deploying with the package's `docgen:deploy` flow.
- `switchboard-sdk` should receive these documentation changes only through
  Copybara after the `sbv3` PR merges.

For docs-only SDK changes that affect customer guidance, include the required
package release and hosted TypeDoc deploy in the PR or release checklist.

For `@switchboard-xyz/on-demand` API-doc changes, run:

```bash
pnpm --dir javascript/on-demand docgen
```

## Verification

Run the smallest checks that prove the release is packageable and contains the
intended changes. Under `/Users/j/Code`, run builds, tests, and package
commands through the container launcher.

For npm packages, run from the canonical `sbv3` package path:

```bash
pnpm install --lockfile-only
pnpm install --frozen-lockfile
pnpm run check-types
pnpm test
pnpm publish --dry-run
```

For Rust crates, run from `sbv3` with canonical manifest paths:

```bash
cargo test --manifest-path rust/<crate>/Cargo.toml
cargo package --list --manifest-path rust/<crate>/Cargo.toml
cargo publish --dry-run --manifest-path rust/<crate>/Cargo.toml
```

Run feature checks when a crate has important feature combinations, especially
for Solana/SBF-safe builds.

After dry-runs:

- Inspect package output for the intended version.
- Confirm generated artifacts, tarballs, `target/`, `dist/`, and
  `node_modules/` are not committed.
- Confirm package contents do not include secrets or local-only files.
- Run `git status --short --ignored=matching` and clean only generated
  artifacts that were created by the checks.

## Merge, Mirror, Publish

Use this order:

1. Merge the `sbv3` release-prep PR.
2. Let Copybara open or update the `copybara/sbv3-sync` pull request in
   `switchboard-sdk`.
3. Review and merge the generated pull request under the mirror repository's
   normal branch protection.
4. Confirm the mirror contains the same release notes and matching manifests.
5. Publish from canonical `sbv3` paths.
6. Verify registry versions after publish.
7. Update `SDK_RELEASE_NOTES.md` from prepared to published if needed.
8. Let Copybara open or update the pull request that mirrors the release-note
   status change.

Publish commands must run from `sbv3`, for example:

```bash
cd javascript/on-demand
pnpm publish
```

```bash
cargo publish --manifest-path rust/switchboard-on-demand/Cargo.toml
```

```bash
cargo publish --manifest-path rust/switchboard-on-demand-client/Cargo.toml
```

Dry-runs should use the same canonical paths with `--dry-run`.

## Stop Conditions

Stop immediately and re-check the source of truth if any of these happen:

- A publish command reports that the version already exists.
- A publish command is packaging an older version than expected.
- A command is being run from `switchboard-sdk` during release prep or publish.
- A release-note version differs from the `sbv3` manifest version.
- A `switchboard-sdk` manifest differs from the matching `sbv3` manifest after
  Copybara sync.
- A lockfile still points at the old version.
- A package dry-run contains generated artifacts that should not ship.
- A crate package list includes `.env` or another local-only file.
- Copybara did not sync the release notes or release-flow docs.

Do not fix these by blindly bumping another version number. First confirm:

- Current working directory.
- Manifest path.
- Registry latest version.
- `sbv3` manifest and lockfile state.
- `switchboard-sdk` mirror state after Copybara.

## What Went Wrong Before

The `switchboard-on-demand-client` release once failed because the public mirror
had `0.6.0`, but canonical `sbv3` still had `0.5.1`. Publishing from `sbv3`
tried to publish `0.5.1`, which already existed on crates.io.

The correct fix was not to release from `switchboard-sdk`. The correct fix was
to update the canonical `sbv3` manifest and lockfile, verify the crate dry-run
from `sbv3`, then let Copybara sync the mirror.

That incident is why every future release must begin with a source-of-truth
check and must publish only from `sbv3`.
