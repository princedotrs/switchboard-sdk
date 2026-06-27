# SDK Release Notes

This file is the canonical release notes ledger for Switchboard SDK releases.
The newest release batch should stay at the top.

## Release Prep Checklist

- Follow `SDK_RELEASE_FLOW.md`; release from canonical `sbv3`, not from the `switchboard-sdk` mirror.
- Before publishing, confirm each release-note version matches the canonical `sbv3` manifest version, the final `switchboard-sdk` release-branch manifest version, and the latest published registry version.

## 2026-06-27 Release Prep

### `switchboard-on-demand-client@0.6.1`

Status: prepared; dry-run verified.

- Pins the legacy client crate to the Solana 1.18 SDK line it supports.
- Fixes compatibility with Solana SDK module paths used by 1.18-era consumers.

### `switchboard-on-demand@0.13.1`

Status: prepared; dry-run pending.

- Sets the Solana 2.x support floor to 2.1 and keeps Solana 3.x support below 4.x.
- Fixes Solana 3 client feature compilation, including lookup-table message types and shared client dependencies.

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
