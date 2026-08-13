# SDK Release Notes

This file is the canonical release notes ledger for Switchboard SDK releases.
The newest release batch should stay at the top.

## Release Prep Checklist

- Follow `SDK_RELEASE_FLOW.md`; release from canonical `sbv3`, not from the `switchboard-sdk` mirror.
- Before publishing, confirm each release-note version matches the canonical `sbv3` manifest version, the final `switchboard-sdk` release-branch manifest version, and the latest published registry version.

## 2026-08-11 Rust Pyth SDK Release Prep

### `switchboard-protos@0.2.7`

Status: prepared.

- Publishes the Pyth push-feed task fields and legacy Pyth Core API-key configuration already present in the canonical schema.
- Extends the shared Rust/JavaScript conformance fixture to cover the request-scoped `${PYTH_API_KEY}` placeholder without changing the legacy control identity.

### `switchboard-on-demand-client@0.6.1`

Status: prepared.

- Requires `switchboard-protos` 0.2.7 or newer on the compatible 0.2 line so Pyth fields cannot be discarded during decode and re-encode.
- Adds request-scoped variable overrides to Crossbar simulation, every gateway signature route, and classic PullFeed update helpers while preserving existing method signatures.
- Redacts override values from Crossbar and gateway error/log text exposed to callers without mutating results, feed hashes, or signatures.
- Pins the legacy client crate to the Solana 1.18 SDK line it supports and fixes compatibility with its module paths.
- Preserves exact on-chain `max_variance` values and rejects malformed or identity-mismatched gateway responses before instruction construction.

### `switchboard-on-demand@0.13.1`

Status: prepared.

- Requires `switchboard-protos` 0.2.7 or newer on the compatible 0.2 line.
- Adds the same backward-compatible request-scoped override APIs as the legacy client crate for Solana 2.x and 3.x consumers.
- Keeps the Solana 2.x support floor at 2.1 and the Solana 3.x support ceiling below 4.x.
- Preserves exact on-chain `max_variance` values, rejects malformed or identity-mismatched gateway responses, and safely decodes unaligned classic PullFeed accounts.

### `sb-on-demand-schemas@0.1.4`

Status: prepared.

- Requires `switchboard-protos` 0.2.7 or newer and preserves Pyth push/API-key fields across V1 job and V2 feed decoding.
- Aligns its Solana bounds with the supported `switchboard-on-demand` 0.13 release line.

Publish in dependency order: `switchboard-protos@0.2.7`,
`switchboard-on-demand-client@0.6.1`, `switchboard-on-demand@0.13.1`, then
`sb-on-demand-schemas@0.1.4`.

## 2026-08-07 Release Prep

### `@switchboard-xyz/sui-sdk@0.1.17`

Status: prepared.

- Adds request-scoped `variableOverrides` support to `fetchManyUpdateTx`, `fetchUpdateTx`, and `fetchUpdateForMultiple`.
- Sends non-empty overrides in a JSON `POST` body while preserving the existing `GET` request for callers without overrides.
- Preserves overrides across retries without exposing their values in request URLs or Crossbar errors.
- Uses `@switchboard-xyz/common` `^5.8.5` with `@switchboard-xyz/common-legacy` `^1.1.1` so Sui consumers share the current canonical serializer while retaining the legacy signature route.

Deploy the matching Crossbar Sui update route before publishing this SDK
version so override requests are accepted end to end.

## 2026-07-29 Release

### `@switchboard-xyz/common@5.8.5`

Status: published.

- Isolates generated protobuf schemas per module so another installed Common version cannot change canonical feed serialization at runtime.
- Preserves the Rust/prost-compatible Pyth push encoding and existing feed identities.
- Adds an exact scaled-integer variance input for forwarding checksum values read from classic PullFeed accounts without changing the existing human-percent API.

### `@switchboard-xyz/common-legacy@1.1.1`

Status: published.

- Uses Common as a peer dependency instead of installing a private schema copy.
- Fixes legacy feed storage through the Common base58 codec in both ESM and CommonJS applications.

### `@switchboard-xyz/on-demand@3.10.6`

Status: published.

- Requires the corrected common-legacy package so importing on-demand cannot replace Common's canonical protobuf encoder.
- Preserves legacy PullFeed job loading, feed storage, partial updates, and fail-closed response-hash validation.
- Forwards classic PullFeed variance in its exact on-chain scaled units instead of round-tripping it through a JavaScript percentage.

The packages were published in dependency order:
`@switchboard-xyz/common@5.8.5`,
`@switchboard-xyz/common-legacy@1.1.1`, then
`@switchboard-xyz/on-demand@3.10.6`.

The replaced versions `@switchboard-xyz/common@5.8.4`,
`@switchboard-xyz/common-legacy@1.1.0`, and
`@switchboard-xyz/on-demand@3.10.5` are deprecated with upgrade guidance.

## 2026-07-25 Release Prep

### `@switchboard-xyz/common@5.8.4`

Status: published.

- Encodes OracleJob and OracleFeed protobufs in Rust/prost declaration order so feed identities are consistent across SDK, Crossbar, gateway, and oracle paths.
- Adds shared Rust/JavaScript feed-hash conformance vectors for Pyth push jobs and explicit optional defaults.
- Bounds Crossbar gateway discovery so a stalled Crossbar request cannot block the existing on-chain gateway fallback.

### `@switchboard-xyz/on-demand@3.10.5`

Status: published.

- Resolves subscription payment accounts from the SWTCH mint and price feed configured in Subscriber State.
- Adds the Jupiter-backed SWTCH/USD feed definition and guarded state-feed migration support.
- Rejects unexpected gateway feed hashes before constructing update instructions instead of substituting the default public key.
- Fixes multi-signature Ed25519 instruction serialization and position-dependent quote lookup indices that could cause Solana `InvalidDataOffsets` failures.
- Finalizes managed quote update indices automatically when building versioned transactions and exposes a finalizer for custom transaction builders.
- Passes request-scoped variable overrides through batched legacy PullFeed gateway requests.
- Clarifies the managed quote update path, legacy PullFeed compatibility APIs, and feed parameter units in the published SDK documentation.

Publish `@switchboard-xyz/common@5.8.4` before
`@switchboard-xyz/on-demand@3.10.5`; Copybara replaces workspace dependencies
with the npm `latest` version on the release branch.

### `@switchboard-xyz/cli@3.5.13`

Status: prepared; package dry-run blocked by the existing CLI lint baseline.

- Uses the Subscriber State feed for subscription oracle updates.
- Adds a cluster-aware, authority-checked SWTCH feed migration command.

## 2026-06-08 Release Prep

### `@switchboard-xyz/on-demand@3.10.4`

Status: prepared; dry-run verified.

- Fixed Solana network resolution so official Switchboard program IDs resolve to the correct cluster defaults.
- Fixed randomness oracle eligibility so healthy pull oracles are not rejected only because `enable_gateway = 0`; `enable_pull_oracle` remains the relevant eligibility gate.
- Includes the merged `sbv3#1015` randomness eligibility fix and smoke-test coverage.

### `switchboard-on-demand-client@0.6.0`

Status: prepared; dry-run verified.

- Updated the client crate for Solana 3.x crate compatibility.
- Fixed release guardrail paths so crate packaging checks use the `solana/rust/switchboard-on-demand-client` mirror layout.

### `switchboard-on-demand@0.13.0`

Status: prepared; dry-run verified.

- Bumped the crate release target to `0.13.0` for the Pinocchio `AccountView` migration and compatible Pinocchio `0.11.x` dependency range.
- Preserved Crossbar feed simulation results when building update instructions.
- Fixed Sui result deserialization and removed noisy client logs.
- Kept the SBF-safe `libsecp256k1` feature split for Solana builds.
