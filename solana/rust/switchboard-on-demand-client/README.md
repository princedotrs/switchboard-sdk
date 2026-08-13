# Switchboard-On-Demand-Client

This crate is designed to interact with Switchboard on-demand, the Crossbar service, and queue gateways.

## Installation

```toml
[dependencies]
switchboard-on-demand-client = "0.6.1"
```

## Request-scoped task variables

Keep API keys and other credentials out of stored `OracleJob` definitions. Put a
placeholder such as `${PYTH_API_KEY}` in the job, then supply its value only for
the request that needs it:

```rust
use std::collections::HashMap;

let pyth_api_key = std::env::var("PYTH_API_KEY")?;
let overrides = HashMap::from([(
    "PYTH_API_KEY".to_string(),
    pyth_api_key,
)]);

let simulation = crossbar
    .simulate_proto_with_variable_overrides(
        &oracle_feed,
        true,
        Some("mainnet"),
        overrides,
    )
    .await?;
```

The same override map is accepted by the `_with_variable_overrides` gateway
signature helpers and by `PullFeed::fetch_update_ix_with_variable_overrides`
and `PullFeed::fetch_update_consensus_ix_with_variable_overrides`. Existing
methods remain available for requests that do not need overrides.

## Crossbar
A middleman service to fetch oracle jobs from IPFS and to return feed price simulations. This is useful for updating a price constantly instead of sending requests directly to oracles.

## Release guardrail

Before publishing this crate to crates.io, commit the release changes to `main` or create a release tag that points at the release commit, then run:

```bash
rust/switchboard-on-demand-client/scripts/verify-crate-release.sh
```

The script refuses to package from a dirty tree, refuses non-`main` branches unless the commit is tagged, and verifies the generated crate's `.cargo_vcs_info.json` has `dirty = false` and points at the release commit. Do not publish if this check fails.

## Gateways
The frontend to interact with Switchboard oracles.

Gateway helper parameters named `max_variance` accept human percentages and scale by `1e9` before sending gateway requests. Raw v2 `OracleFeed.max_job_range_pct` values are already scaled integers, so `1_000_000_000` means `1%`. `min_job_responses` and `min_oracle_samples` are unscaled counts. See [Feed Parameter Units](https://docs.switchboard.xyz/custom-feeds/advanced-feed-configuration/feed-parameter-units).

## Solana/SVM quote-program path

New Solana/SVM feed-hash integrations should update canonical quote-program
accounts with the managed Ed25519 update path, then read the stored
`SwitchboardQuote` account. Stored quote accounts are variable-length; parse
them with the SDK account types instead of hard-coding byte offsets.

For on-chain reads, use the `switchboard-on-demand` crate's
`SwitchboardQuote`, `PackedFeedInfo`, and `QuoteVerifier` types. Each
`PackedFeedInfo` exposes the feed ID, raw `feed_value`, decimal `value()`, and
`min_oracle_samples`.

## Legacy PullFeed account example

The examples below are for classic PullFeed accounts only. They submit through
the legacy PullFeed program path and require queue/gateway support for the
classic secp256k1 update flow. Do not use these examples for new feed-hash
custom-feed integrations.

```rust
#[tokio::main]
async fn main() {
    let client = RpcClient::new("https://api.devnet.solana.com".to_string());
    let queue_key = Pubkey::from_str("FfD96yeXs4cxZshoPPSKhSPgVQxLAJUT3gefgh84m1Di").unwrap();
    let feed = Pubkey::from_str("7Zi7LkGGARDKhUEFPBUQDsVZ9L965LPEv2rBRdmSXCWh").unwrap();
    let kp = read_keypair_file("authority.json").unwrap();

    let queue = QueueAccountData::load(&client, &queue_key).await.unwrap();
    let gw = &queue.fetch_gateways(&client).await.unwrap()[0];
    let crossbar = CrossbarClient::default();
    let feed_data = PullFeed::load_data(&client, &feed).await.unwrap();
    let feed_hash = feed_data.feed_hash();

    let simulation = crossbar.simulate_feeds(&[&feed_hash]).await.unwrap();
    println!("simulation: {:#?}", simulation);

    let ctx = SbContext::new();
    let (ix, responses, num_success, luts) = PullFeed::fetch_update_ix(
        ctx.clone(),
        &client,
        FetchUpdateParams {
            feed,
            payer: kp.pubkey(),
            gateway: gw.clone(),
            crossbar: Some(crossbar),
            ..Default::default()
        },
    )
    .await
    .unwrap();

    let blockhash = client.get_latest_blockhash().await.unwrap();
    let msg = Message::try_compile(
        &kp.pubkey(),
        &[
            ComputeBudgetInstruction::set_compute_unit_limit(1_400_000),
            ComputeBudgetInstruction::set_compute_unit_price(35_000),
            ix.clone()
        ],
        &luts,
        blockhash)
    .unwrap();

    let versioned_tx = VersionedTransaction::try_new(V0(msg), &[&kp]).unwrap();
    let result: Response<RpcSimulateTransactionResult> = client
        .simulate_transaction(&versioned_tx)
        .await
        .unwrap();
    println!("ix: {:#?}", result);
}
```

## Updating many legacy PullFeed accounts at once

This path is also legacy PullFeed compatibility only. New Solana/SVM
integrations should use managed quote-program updates and canonical
`SwitchboardQuote` accounts.

```rust
async fn main() {
    let ctx = SbContext::new();
    let client = RpcClient::new("===".to_string());
    let queue_key = Pubkey::from_str("A43DyUGA7s8eXPxqEjJY6EBu1KKbNgfxF8h17VAHn13w").unwrap();
    let mut feeds = Vec::new();
    feeds.push(Pubkey::from_str("FwzcymbxHJ7CArSmAwnguzyEBakLq2h3TZjHsz1r51rr").unwrap());
    feeds.push(Pubkey::from_str("ceuXtwYhAd3hs9xFfcrZZq6byY1s9b1NfsPckVkVyuC").unwrap());
    feeds.push(Pubkey::from_str("HhNHzSJjQuhni5GwaVkhqBQrMz1EZAW5Nt32RKnZAL2g").unwrap());
    let kp = read_keypair_file("authority.json").unwrap();

    let queue = QueueAccountData::load(&client, &queue_key).await.unwrap();
    let gw = &queue.fetch_gateways(&client).await.unwrap()[0];
    let slothash = SlotHashSysvar::get_latest_slothash(&client).await.unwrap();
    let (ixs, luts) = PullFeed::fetch_update_consensus_ix(
        sb_context,
        &client,
        FetchUpdateManyParams {
            feeds: feeds,
            payer: kp.pubkey(),
            gateway: gw.clone(),
            crossbar: Some(crossbar),
            num_signatures: Some(1),
            ..Default::default()
        },
    )
    .await
    .unwrap();

    let blockhash = client.get_latest_blockhash().await.unwrap();
    let msg = Message::try_compile(
        &kp.pubkey(),
        &[
            ixs[0].clone(), // secp256k1 instruction
            ixs[1].clone(), // fetch update intsruction
            ComputeBudgetInstruction::set_compute_unit_limit(1_400_000),
            ComputeBudgetInstruction::set_compute_unit_price(69_000),
            
        ],
        &luts,
        blockhash,
    )
    .unwrap();

    let versioned_tx = VersionedTransaction::try_new(V0(msg), &[&kp]).unwrap();
    let result = client.simulate_transaction(&versioned_tx).await.unwrap();
    println!(
        "Simulation logs: {:#?}",
        result.value.logs.unwrap_or(vec![])
    );

}
```
