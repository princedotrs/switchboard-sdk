# SDK Release Notes

This file is the canonical release notes ledger for Switchboard SDK releases.
The newest release batch should stay at the top.

## Release Prep Checklist

- Follow `SDK_RELEASE_FLOW.md`; release from canonical `sbv3`, not from the `switchboard-sdk` mirror.
- Before publishing, confirm each release-note version matches the canonical `sbv3` manifest version, the final `switchboard-sdk` release-branch manifest version, and the latest published registry version.

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

## 2026-06-27 Release Prep

### `switchboard-on-demand-client@0.6.1`

Status: prepared; dry-run verified.

- Pins the legacy client crate to the Solana 1.18 SDK line it supports.
- Fixes compatibility with Solana SDK module paths used by 1.18-era consumers.
- Sends the exact on-chain `max_variance` integer through classic PullFeed gateway requests instead of truncating it to a whole percentage.
- Rejects unexpected response hashes, malformed signatures, and malformed gateway payloads before constructing update instructions.

### `switchboard-on-demand@0.13.1`

Status: prepared; dry-run verified.

- Sets the Solana 2.x support floor to 2.1 and keeps Solana 3.x support below 4.x.
- Fixes Solana 3 client feature compilation, including lookup-table message types and shared client dependencies.
- Sends the exact on-chain `max_variance` integer through classic PullFeed gateway requests instead of truncating it to a whole percentage.
- Rejects unexpected response hashes, malformed signatures, and malformed gateway payloads before constructing update instructions.
- Decodes legacy PullFeed accounts with unaligned-safe reads and returns a clean parse error for malformed account sizes.

### `sb-on-demand-schemas@0.1.4`

Status: prepared; dry-run pending.

- Aligns schema crate Solana 2.x bounds with the supported 2.1+ SDK range.
- Keeps the schema crate on the compatible `switchboard-on-demand` 0.13 release line.

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
