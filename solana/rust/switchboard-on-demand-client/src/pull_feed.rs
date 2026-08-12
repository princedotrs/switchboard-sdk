use crate::gateway::{
    BatchFeedRequest, ConsensusOracleResponse, FetchSignaturesConsensusResponse,
    FetchSignaturesConsensusScaledParams, FetchSignaturesScaledParams, MedianResponse,
};
use crate::secp256k1::Secp256k1InstructionUtils;
use crate::secp256k1::SecpSignature;
use crate::Gateway;
use crate::OracleAccountData;
use crate::State;
use crate::*;
use anyhow_ext::anyhow;
use anyhow_ext::Context;
use anyhow_ext::Error as AnyhowError;
use associated_token_account::get_associated_token_address;
use associated_token_account::NATIVE_MINT;
use associated_token_account::SPL_TOKEN_PROGRAM_ID;
use base64::{engine::general_purpose::STANDARD as base64, Engine as _};
use bs58;
use bytemuck;
use dashmap::DashMap;
use rust_decimal::Decimal;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use solana_client::nonblocking::rpc_client::RpcClient;
use solana_sdk::address_lookup_table::AddressLookupTableAccount;
use solana_sdk::instruction::AccountMeta;
use solana_sdk::instruction::Instruction;
use solana_sdk::pubkey::Pubkey;
use solana_sdk::system_program;
use std::result::Result;
use std::sync::Arc;
use tokio::join;
use tokio::sync::OnceCell;

type LutCache = DashMap<Pubkey, AddressLookupTableAccount>;
type JobCache = DashMap<[u8; 32], OnceCell<Vec<OracleJob>>>;
type PullFeedCache = DashMap<Pubkey, OnceCell<PullFeedAccountData>>;

pub fn generate_combined_checksum(
    queue_key: &[u8; 32],
    feeds: &[PullFeedAccountData],
    signed_slothash: &[u8; 32],
    submission_values: &[i128],
) -> [u8; 32] {
    let mut hasher = Sha256::new();
    hasher.update(queue_key);

    for feed in feeds {
        hasher.update(feed.feed_hash);
        hasher.update(feed.max_variance.to_le_bytes());
        hasher.update(feed.min_responses.to_le_bytes());
    }

    hasher.update(signed_slothash);
    for &value in submission_values {
        hasher.update(value.to_le_bytes());
    }

    // Finalize and return the hash.
    hasher.finalize().into()
}

pub struct SbContext {
    pub lut_cache: LutCache,
    pub job_cache: JobCache,
    pub pull_feed_cache: PullFeedCache,
}
impl SbContext {
    pub fn new() -> Arc<Self> {
        Arc::new(SbContext {
            lut_cache: DashMap::new(),
            job_cache: DashMap::new(),
            pull_feed_cache: DashMap::new(),
        })
    }
}

pub async fn fetch_and_cache_luts<T: bytemuck::Pod + lut_owner::LutOwner>(
    client: &RpcClient,
    context: Arc<SbContext>,
    oracle_keys: &[Pubkey],
) -> Result<Vec<AddressLookupTableAccount>, AnyhowError> {
    let mut luts = Vec::new();
    let mut keys_to_fetch = Vec::new();

    for &key in oracle_keys {
        if let Some(cached_lut) = context.lut_cache.get(&key) {
            luts.push(cached_lut.clone());
        } else {
            keys_to_fetch.push(key);
        }
    }

    if !keys_to_fetch.is_empty() {
        let fetched_luts = load_lookup_tables::<T>(client, &keys_to_fetch).await?;
        for (key, lut) in keys_to_fetch.into_iter().zip(fetched_luts) {
            context.lut_cache.insert(key, lut.clone());
            luts.push(lut);
        }
    }

    Ok(luts)
}

#[derive(Clone, Debug)]
pub struct OracleResponse {
    pub value: Option<Decimal>,
    pub error: String,
    pub oracle: Pubkey,
    pub signature: [u8; 64],
    pub recovery_id: u8,
}

fn has_failure_error(error: &str) -> bool {
    let trimmed = error.trim();
    !trimmed.is_empty() && trimmed != "[]"
}

fn decode_fixed_hex<const N: usize>(value: &str, field: &str) -> Result<[u8; N], AnyhowError> {
    let normalized = value
        .strip_prefix("0x")
        .or_else(|| value.strip_prefix("0X"))
        .unwrap_or(value);
    let bytes = hex::decode(normalized)
        .with_context(|| format!("PullFeed: gateway returned invalid {field} hex"))?;
    let actual_len = bytes.len();
    bytes.try_into().map_err(|_| {
        anyhow!("PullFeed: gateway returned {field} with invalid length {actual_len}; expected {N}")
    })
}

fn decode_fixed_base64<const N: usize>(value: &str, field: &str) -> Result<[u8; N], AnyhowError> {
    let bytes = base64
        .decode(value)
        .with_context(|| format!("PullFeed: gateway returned invalid {field} base64"))?;
    let actual_len = bytes.len();
    bytes.try_into().map_err(|_| {
        anyhow!("PullFeed: gateway returned {field} with invalid length {actual_len}; expected {N}")
    })
}

fn parse_recovery_id(value: i32) -> Result<u8, AnyhowError> {
    let recovery_id = u8::try_from(value)
        .map_err(|_| anyhow!("PullFeed: gateway returned an invalid recovery_id"))?;
    if recovery_id > 3 {
        return Err(anyhow!(
            "PullFeed: gateway returned an out-of-range recovery_id"
        ));
    }
    Ok(recovery_id)
}

fn parse_jobs(jobs_data: &serde_json::Value) -> Result<Vec<OracleJob>, AnyhowError> {
    let jobs = jobs_data
        .get("jobs")
        .cloned()
        .ok_or_else(|| anyhow!("PullFeed: Crossbar response is missing jobs"))?;
    serde_json::from_value(jobs).context("PullFeed: Failed to deserialize Crossbar jobs")
}

fn match_median_response_feeds(
    requested_feeds: &[(Pubkey, [u8; 32])],
    median_responses: &[MedianResponse],
) -> Result<Vec<Pubkey>, AnyhowError> {
    let mut matched = vec![false; requested_feeds.len()];
    let mut matched_feeds = Vec::with_capacity(median_responses.len());
    let mut returned_hashes = Vec::with_capacity(median_responses.len());
    let mut unexpected_hashes = Vec::new();

    for (response_idx, response) in median_responses.iter().enumerate() {
        let returned_hash = decode_fixed_hex::<32>(
            &response.feed_hash,
            &format!("median_responses[{response_idx}].feed_hash"),
        )?;
        returned_hashes.push(hex::encode(returned_hash));

        let match_idx = requested_feeds
            .iter()
            .enumerate()
            .find(|(idx, (_, expected_hash))| !matched[*idx] && expected_hash == &returned_hash)
            .map(|(idx, _)| idx);

        if let Some(idx) = match_idx {
            matched[idx] = true;
            matched_feeds.push(requested_feeds[idx].0);
        } else {
            unexpected_hashes.push(hex::encode(returned_hash));
        }
    }

    if !unexpected_hashes.is_empty() {
        let expected_hashes = requested_feeds
            .iter()
            .map(|(_, hash)| hex::encode(hash))
            .collect::<Vec<_>>();
        return Err(anyhow!(
            "[Switchboard] Gateway returned an unexpected median response feed hash. Expected hashes: [{}]. Returned hashes: [{}].",
            expected_hashes.join(", "),
            returned_hashes.join(", ")
        ));
    }

    Ok(matched_feeds)
}

fn parse_consensus_oracle_response(
    response: &ConsensusOracleResponse,
    response_idx: usize,
) -> Result<(Pubkey, SecpSignature), AnyhowError> {
    if response.errors.iter().any(Option::is_some) {
        return Err(anyhow!(
            "PullFeed: gateway oracle response {response_idx} contains feed errors"
        ));
    }

    let oracle = Pubkey::new_from_array(decode_fixed_hex::<32>(
        &response.oracle_pubkey,
        &format!("oracle_responses[{response_idx}].oracle_pubkey"),
    )?);
    let eth_address = decode_fixed_hex::<20>(
        &response.eth_address,
        &format!("oracle_responses[{response_idx}].eth_address"),
    )?;
    let signature = decode_fixed_base64::<64>(
        &response.signature,
        &format!("oracle_responses[{response_idx}].signature"),
    )?;
    let message = decode_fixed_base64::<32>(
        &response.checksum,
        &format!("oracle_responses[{response_idx}].checksum"),
    )?;
    let recovery_id = parse_recovery_id(response.recovery_id)?;

    Ok((
        oracle,
        SecpSignature {
            eth_address,
            signature,
            message: message.to_vec(),
            recovery_id,
        },
    ))
}

struct ValidatedConsensusResponse {
    feed_pubkeys: Vec<Pubkey>,
    values: Vec<i128>,
    oracle_keys: Vec<Pubkey>,
    secp_signatures: Vec<SecpSignature>,
}

fn validate_consensus_response(
    response: &FetchSignaturesConsensusResponse,
    requested_feeds: &[(Pubkey, [u8; 32])],
) -> Result<ValidatedConsensusResponse, AnyhowError> {
    if response.oracle_responses.is_empty() {
        return Err(anyhow!(
            "PullFeed.fetchUpdateConsensusIx Failure: No oracle responses"
        ));
    }
    if response.median_responses.is_empty() {
        return Err(anyhow!(
            "PullFeed.fetchUpdateConsensusIx Failure: No success responses found"
        ));
    }

    let feed_pubkeys = match_median_response_feeds(requested_feeds, &response.median_responses)?;
    let values = response
        .median_responses
        .iter()
        .enumerate()
        .map(|(idx, response)| {
            response.value.parse::<i128>().with_context(|| {
                format!("PullFeed: gateway returned invalid median_responses[{idx}].value")
            })
        })
        .collect::<Result<Vec<_>, _>>()?;

    let parsed_oracles = response
        .oracle_responses
        .iter()
        .enumerate()
        .map(|(idx, response)| parse_consensus_oracle_response(response, idx))
        .collect::<Result<Vec<_>, _>>()?;
    let (oracle_keys, secp_signatures): (Vec<_>, Vec<_>) = parsed_oracles.into_iter().unzip();

    Ok(ValidatedConsensusResponse {
        feed_pubkeys,
        values,
        oracle_keys,
        secp_signatures,
    })
}

#[derive(Clone, Debug, Default)]
pub struct FetchUpdateParams {
    pub feed: Pubkey,
    pub payer: Pubkey,
    pub gateway: Gateway,
    pub crossbar: Option<CrossbarClient>,
    pub num_signatures: Option<u32>,
    pub debug: Option<bool>,
}

#[derive(Clone, Debug, Default)]
pub struct FetchUpdateManyParams {
    pub feeds: Vec<Pubkey>,
    pub payer: Pubkey,
    pub gateway: Gateway,
    pub crossbar: Option<CrossbarClient>,
    pub num_signatures: Option<u32>,
    pub debug: Option<bool>,
}

#[derive(Clone, Debug, Default)]
pub struct FetchUpdateBatchParams {
    pub feeds: Vec<Pubkey>,
    pub payer: Pubkey,
    pub gateway: Gateway,
    pub crossbar: Option<CrossbarClient>,
    pub num_signatures: Option<u32>,
    pub debug: Option<bool>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct SolanaSubmitSignaturesParams {
    pub queue: Pubkey,
    pub feed: Pubkey,
    pub payer: Pubkey,
}

/// Legacy client helpers for classic PullFeed accounts.
///
/// New Solana/SVM feed-hash integrations should use managed quote-program
/// updates and read canonical `SwitchboardQuote` accounts. These helpers
/// submit through the classic PullFeed account path and require queue/gateway
/// support for the legacy secp256k1 update flow.
pub struct PullFeed;

fn decode_pull_feed_account_data(account: &[u8]) -> Result<PullFeedAccountData, AnyhowError> {
    let data = account
        .get(8..)
        .filter(|data| data.len() == std::mem::size_of::<PullFeedAccountData>())
        .ok_or_else(|| anyhow!("PullFeed.load_data: Failed to parse data"))?;

    Ok(bytemuck::pod_read_unaligned(data))
}

impl PullFeed {
    pub async fn load_data(
        client: &RpcClient,
        key: &Pubkey,
    ) -> Result<PullFeedAccountData, AnyhowError> {
        let account = client
            .get_account_data(key)
            .await
            .map_err(|_| anyhow!("PullFeed.load_data: Account not found"))?;
        decode_pull_feed_account_data(&account)
    }

    fn get_solana_submit_signatures_ix(
        slot: u64,
        responses: Vec<OracleResponse>,
        params: SolanaSubmitSignaturesParams,
    ) -> Result<Instruction, AnyhowError> {
        let mut submissions = Vec::new();
        for resp in &responses {
            let mut value_i128 = i128::MAX;
            if let Some(mut val) = resp.value {
                val.rescale(18);
                value_i128 = val.mantissa();
            }
            submissions.push(Submission {
                value: value_i128,
                signature: resp.signature,
                recovery_id: resp.recovery_id,
                offset: 0,
            });
        }
        let mut remaining_accounts = Vec::new();
        for resp in &responses {
            remaining_accounts.push(AccountMeta::new_readonly(resp.oracle, false));
        }
        for resp in responses {
            let stats_key = OracleAccountData::stats_key(&resp.oracle);
            remaining_accounts.push(AccountMeta::new(stats_key, false));
        }
        let mut submit_ix = Instruction {
            program_id: get_switchboard_on_demand_program_id(),
            data: PullFeedSubmitResponseParams { slot, submissions }.data(),
            accounts: PullFeedSubmitResponse {
                feed: params.feed,
                queue: params.queue,
                program_state: State::key(),
                recent_slothashes: solana_sdk::sysvar::slot_hashes::ID,
                payer: params.payer,
                system_program: system_program::ID,
                reward_vault: get_associated_token_address(&params.queue, &NATIVE_MINT),
                token_program: *SPL_TOKEN_PROGRAM_ID,
                token_mint: *NATIVE_MINT,
            }
            .to_account_metas(None),
        };
        submit_ix.accounts.extend(remaining_accounts);
        Ok(submit_ix)
    }

    /// Fetches an update instruction for a classic PullFeed account.
    ///
    /// This is a legacy compatibility path that submits to the classic
    /// PullFeed program account. New feed-hash integrations should use managed
    /// quote-program updates and canonical `SwitchboardQuote` accounts.
    pub async fn fetch_update_ix(
        context: Arc<SbContext>,
        client: &RpcClient,
        params: FetchUpdateParams,
    ) -> Result<
        (
            Instruction,
            Vec<OracleResponse>,
            usize,
            Vec<AddressLookupTableAccount>,
        ),
        AnyhowError,
    > {
        let latest_slot = SlotHashSysvar::get_latest_slothash(client)
            .await
            .context("PullFeed.fetchUpdateIx: Failed to fetch latest slot")?;

        let feed_data = *context
            .pull_feed_cache
            .entry(params.feed)
            .or_insert_with(OnceCell::new)
            .get_or_try_init(|| PullFeed::load_data(client, &params.feed))
            .await?;

        let feed_hash = feed_data.feed_hash;
        let jobs = context
            .job_cache
            .entry(feed_hash)
            .or_insert_with(OnceCell::new)
            .get_or_try_init(|| {
                let crossbar = params.crossbar.clone().unwrap_or_default();
                async move {
                    let jobs_data = crossbar
                        .fetch(&hex::encode(feed_hash))
                        .await
                        .context("PullFeed.fetchUpdateIx: Failed to fetch jobs")?;

                    parse_jobs(&jobs_data)
                }
            })
            .await?
            .clone();

        let encoded_jobs = encode_jobs(&jobs);
        let gateway = params.gateway;

        let num_signatures = params.num_signatures.unwrap_or_else(|| {
            (feed_data.min_sample_size as f64 + ((feed_data.min_sample_size as f64) / 3.0).ceil())
                as u32
        });

        let price_signatures = gateway
            .fetch_signatures_from_encoded_scaled(FetchSignaturesScaledParams {
                recent_hash: Some(bs58::encode(latest_slot.hash).into_string()),
                encoded_jobs: encoded_jobs.clone(),
                num_signatures,
                max_variance_scaled: feed_data.max_variance,
                min_responses: Some(feed_data.min_responses),
                use_timestamp: Some(false),
            })
            .await
            .context("PullFeed.fetchUpdateIx: Failed to fetch signatures")?;

        let returned_hashes = price_signatures
            .responses
            .iter()
            .enumerate()
            .map(|(idx, response)| {
                decode_fixed_hex::<32>(&response.feed_hash, &format!("responses[{idx}].feed_hash"))
            })
            .collect::<Result<Vec<_>, _>>()?;
        if returned_hashes
            .iter()
            .any(|returned_hash| returned_hash != &feed_hash)
        {
            return Err(anyhow!(
                "[Switchboard] Gateway returned an unexpected feed hash. Expected hashes: [{}]. Returned hashes: [{}].",
                hex::encode(feed_hash),
                returned_hashes
                    .iter()
                    .map(hex::encode)
                    .collect::<Vec<_>>()
                    .join(", ")
            ));
        }

        let oracle_responses: Vec<OracleResponse> = price_signatures
            .responses
            .iter()
            .enumerate()
            .map(|(idx, response)| {
                let x = response;
                let value = x.success_value.parse::<i128>().ok();
                Ok(OracleResponse {
                    value: value.map(|val| Decimal::from_i128_with_scale(val, 18)),
                    error: x.failure_error.clone(),
                    oracle: Pubkey::new_from_array(decode_fixed_hex::<32>(
                        &x.oracle_pubkey,
                        &format!("responses[{idx}].oracle_pubkey"),
                    )?),
                    recovery_id: parse_recovery_id(x.recovery_id)?,
                    signature: decode_fixed_base64::<64>(
                        &x.signature,
                        &format!("responses[{idx}].signature"),
                    )?,
                })
            })
            .collect::<Result<Vec<_>, AnyhowError>>()?;

        let usable_oracle_responses: Vec<OracleResponse> = oracle_responses
            .iter()
            .filter(|response| response.value.is_some() && !has_failure_error(&response.error))
            .cloned()
            .collect();
        let num_successes = usable_oracle_responses.len();

        if params.debug.unwrap_or(false) {
            println!("priceSignatures: {:?}", price_signatures);
        }

        if num_successes == 0 {
            return Err(anyhow_ext::Error::msg(
                "PullFeed.fetchUpdateIx Failure: No successful responses".to_string(),
            ));
        }

        let submit_signatures_ix = PullFeed::get_solana_submit_signatures_ix(
            latest_slot.slot,
            usable_oracle_responses.clone(),
            SolanaSubmitSignaturesParams {
                feed: params.feed,
                queue: feed_data.queue,
                payer: params.payer,
            },
        )
        .context("PullFeed.fetchUpdateIx: Failed to create submit signatures instruction")?;

        let oracle_keys: Vec<Pubkey> = usable_oracle_responses.iter().map(|x| x.oracle).collect();
        let feed_key = [params.feed];
        let queue_key = [feed_data.queue];

        let (oracle_luts, pull_feed_lut, queue_lut) = join!(
            fetch_and_cache_luts::<OracleAccountData>(client, context.clone(), &oracle_keys),
            fetch_and_cache_luts::<PullFeedAccountData>(client, context.clone(), &feed_key),
            fetch_and_cache_luts::<QueueAccountData>(client, context.clone(), &queue_key)
        );
        let oracle_luts = oracle_luts?;
        let pull_feed_lut = pull_feed_lut?;
        let queue_lut = queue_lut?;

        let mut luts = oracle_luts;
        luts.extend(pull_feed_lut);
        luts.extend(queue_lut);

        Ok((submit_signatures_ix, oracle_responses, num_successes, luts))
    }

    /// Fetch the oracle responses for multiple legacy PullFeed accounts via the consensus endpoint,
    /// build the necessary secp256k1 verification instruction and the feed update instruction,
    /// and return these instructions along with the required lookup tables.
    ///
    /// This is a legacy compatibility path that requires queue/gateway support
    /// for the classic secp256k1 PullFeed update flow. New feed-hash
    /// integrations should use managed quote-program updates and canonical
    /// `SwitchboardQuote` accounts.
    ///
    /// # Arguments
    /// * `context` - Shared context holding caches for feeds, jobs, and lookup tables.
    /// * `client` - The RPC client for connecting to the cluster.
    /// * `params` - Parameters for fetching updates, including:
    ///     - `feeds`: A vector of feed public keys.
    ///     - `payer`: The payer public key.
    ///     - `gateway`: A Gateway instance for the API calls.
    ///     - `crossbar`: Optional CrossbarClient instance.
    ///     - `num_signatures`: Optional override for the number of signatures to fetch.
    ///     - `debug`: Optional flag to print debug logs.
    ///
    /// # Returns
    /// A tuple containing:
    ///   1. A vector of two Instructions (first is secp256k1 verification, second is the feed update).
    ///   2. A vector of AddressLookupTableAccount to include in the transaction.
    pub async fn fetch_update_consensus_ix(
        context: Arc<SbContext>,
        client: &RpcClient,
        params: FetchUpdateManyParams,
    ) -> Result<(Vec<Instruction>, Vec<AddressLookupTableAccount>), AnyhowError> {
        if params.feeds.is_empty() {
            return Err(anyhow!(
                "PullFeed.fetchUpdateConsensusIx Failure: feeds cannot be empty"
            ));
        }

        let gateway = params.gateway;
        let mut num_signatures = params.num_signatures.unwrap_or(1);
        let mut feed_configs = Vec::new();
        let mut queue = None;
        let mut requested_feeds = Vec::with_capacity(params.feeds.len());
        // For each feed, load its on-chain data and build its configuration (jobs, encoded jobs, etc.)
        for feed in &params.feeds {
            let data = *context
                .pull_feed_cache
                .entry(*feed)
                .or_insert_with(OnceCell::new)
                .get_or_try_init(|| PullFeed::load_data(client, feed))
                .await?;
            if let Some(expected_queue) = queue {
                if expected_queue != data.queue {
                    return Err(anyhow!(
                        "PullFeed.fetchUpdateConsensusIx Failure: all feeds must use the same queue"
                    ));
                }
            } else {
                queue = Some(data.queue);
            }
            requested_feeds.push((*feed, data.feed_hash));
            let num_sig_lower_bound =
                data.min_sample_size as u32 + ((data.min_sample_size as f64) / 3.0).ceil() as u32;
            if num_signatures < num_sig_lower_bound {
                num_signatures = num_sig_lower_bound;
            }
            // Fetch jobs from the crossbar (or use cache) and encode them.
            let jobs = context
                .job_cache
                .entry(data.feed_hash)
                .or_insert_with(OnceCell::new)
                .get_or_try_init(|| {
                    let crossbar = params.crossbar.clone().unwrap_or_default();
                    async move {
                        let jobs_data = crossbar
                            .fetch(&hex::encode(data.feed_hash))
                            .await
                            .context("PullFeed.fetchUpdateIx: Failed to fetch jobs")?;

                        parse_jobs(&jobs_data)
                    }
                })
                .await?
                .clone();
            let encoded_jobs = encode_jobs(&jobs);
            feed_configs.push(BatchFeedRequest {
                jobs_b64_encoded: encoded_jobs,
                max_variance: data.max_variance,
                min_responses: data.min_responses,
            });
        }
        let queue = queue.ok_or_else(|| {
            anyhow!("PullFeed.fetchUpdateConsensusIx Failure: feeds cannot be empty")
        })?;

        // Get the latest slot.
        let latest_slot = SlotHashSysvar::get_latest_slothash(client)
            .await
            .context("PullFeed.fetchUpdateIx: Failed to fetch latest slot")?;

        // Call the gateway consensus endpoint and fetch signatures
        let price_signatures = gateway
            .fetch_signatures_consensus_scaled(FetchSignaturesConsensusScaledParams {
                recent_hash: Some(bs58::encode(latest_slot.hash).into_string()),
                num_signatures: Some(num_signatures),
                feed_configs,
                use_timestamp: Some(false),
            })
            .await
            .context("PullFeed.fetchUpdateIx: fetch signatures consensus failure")?;
        if params.debug.unwrap_or(false) {
            println!("priceSignatures: {:?}", price_signatures);
        }

        let validated = validate_consensus_response(&price_signatures, &requested_feeds)?;
        // Build the consensus Ix data.
        let consensus_ix_data = PullFeedSubmitResponseConsensusParams {
            slot: latest_slot.slot,
            values: validated.values,
        };
        let mut remaining_accounts = Vec::new();

        // Build the secp256k1 instruction:
        let secp_ix =
            Secp256k1InstructionUtils::build_secp256k1_instruction(&validated.secp_signatures, 0)
                .map_err(|_| {
                anyhow!("Feed failed to produce signatures: Failed to build secp256k1 instruction")
            })?;

        // Attach feed accounts and oracle accounts (plus their stats accounts) as remaining accounts.
        for feed in &validated.feed_pubkeys {
            remaining_accounts.push(AccountMeta::new(*feed, false));
        }
        for oracle in validated.oracle_keys.iter() {
            remaining_accounts.push(AccountMeta::new_readonly(*oracle, false));
            let stats_key = OracleAccountData::stats_key(oracle);
            remaining_accounts.push(AccountMeta::new(stats_key, false));
        }
        // Load lookup tables for oracle, feed, and queue accounts concurrently.
        let queue_key = [queue];
        let (oracle_luts_result, pull_feed_luts_result, queue_lut_result) = join!(
            fetch_and_cache_luts::<OracleAccountData>(
                client,
                context.clone(),
                &validated.oracle_keys
            ),
            fetch_and_cache_luts::<PullFeedAccountData>(client, context.clone(), &params.feeds),
            fetch_and_cache_luts::<QueueAccountData>(client, context.clone(), &queue_key)
        );

        // Handle the results after they are all awaited
        let oracle_luts = oracle_luts_result?;
        let pull_feed_luts = pull_feed_luts_result?;
        let queue_lut = queue_lut_result?;

        let mut luts = oracle_luts;
        luts.extend(pull_feed_luts);
        luts.extend(queue_lut);

        // Construct the instruction that updates the feed consensus using the consensus payload.
        let mut submit_ix = Instruction {
            program_id: get_switchboard_on_demand_program_id(),
            data: consensus_ix_data.data(),
            accounts: PullFeedSubmitResponseConsensus {
                queue,
                program_state: State::key(),
                recent_slothashes: solana_sdk::sysvar::slot_hashes::ID,
                payer: params.payer,
                system_program: system_program::ID,
                reward_vault: get_associated_token_address(&queue, &NATIVE_MINT),
                token_program: *SPL_TOKEN_PROGRAM_ID,
                token_mint: *NATIVE_MINT,
            }
            .to_account_metas(None),
        };
        submit_ix.accounts.extend(remaining_accounts);
        let ixs = vec![secp_ix, submit_ix];

        Ok((ixs, luts))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use bytemuck::Zeroable;

    fn median_response(feed_hash: [u8; 32], value: &str) -> MedianResponse {
        MedianResponse {
            value: value.to_string(),
            feed_hash: hex::encode(feed_hash),
        }
    }

    fn oracle_response() -> ConsensusOracleResponse {
        ConsensusOracleResponse {
            oracle_pubkey: hex::encode([0x11; 32]),
            eth_address: hex::encode([0x22; 20]),
            signature: base64.encode([0x33; 64]),
            checksum: base64.encode([0x44; 32]),
            recovery_id: 1,
            feed_responses: vec![],
            errors: vec![None],
        }
    }

    fn consensus_response(
        median_responses: Vec<MedianResponse>,
    ) -> FetchSignaturesConsensusResponse {
        FetchSignaturesConsensusResponse {
            median_responses,
            oracle_responses: vec![oracle_response()],
        }
    }

    #[test]
    fn has_failure_error_ignores_blank_and_bracket_wrapped_values() {
        assert!(!has_failure_error(""));
        assert!(!has_failure_error("   "));
        assert!(!has_failure_error("[]"));
        assert!(has_failure_error("Stale submission"));
    }

    #[test]
    fn usable_response_count_requires_an_actual_value_and_no_failure_error() {
        let oracle = Pubkey::new_unique();
        let responses = [
            OracleResponse {
                value: Some(Decimal::from_i128_with_scale(1, 0)),
                error: String::new(),
                oracle,
                signature: [0; 64],
                recovery_id: 0,
            },
            OracleResponse {
                value: Some(Decimal::from_i128_with_scale(2, 0)),
                error: "Stale submission".to_string(),
                oracle,
                signature: [0; 64],
                recovery_id: 0,
            },
            OracleResponse {
                value: None,
                error: String::new(),
                oracle,
                signature: [0; 64],
                recovery_id: 0,
            },
        ];

        let usable = responses
            .iter()
            .filter(|response| response.value.is_some() && !has_failure_error(&response.error))
            .count();

        assert_eq!(usable, 1);
    }

    #[test]
    fn median_response_matching_allows_valid_partial_success() {
        let first_feed = Pubkey::new_unique();
        let second_feed = Pubkey::new_unique();
        let requested = vec![(first_feed, [0x11; 32]), (second_feed, [0x22; 32])];
        let response = MedianResponse {
            value: "1".to_string(),
            feed_hash: format!("0X{}", hex::encode_upper([0x22; 32])),
        };

        assert_eq!(
            match_median_response_feeds(&requested, &[response]).unwrap(),
            vec![second_feed]
        );
    }

    #[test]
    fn median_response_matching_rejects_unexpected_and_duplicate_hashes() {
        let feed = Pubkey::new_unique();
        let requested = vec![(feed, [0x11; 32])];

        let unexpected =
            match_median_response_feeds(&requested, &[median_response([0x22; 32], "1")])
                .unwrap_err()
                .to_string();
        assert!(unexpected.contains(&hex::encode([0x11; 32])));
        assert!(unexpected.contains(&hex::encode([0x22; 32])));

        let duplicate = median_response([0x11; 32], "1");
        assert!(match_median_response_feeds(&requested, &[duplicate.clone(), duplicate]).is_err());
    }

    #[test]
    fn consensus_response_validation_parses_exact_values_and_crypto_fields() {
        let feed = Pubkey::new_unique();
        let response = consensus_response(vec![median_response([0x11; 32], "-123")]);

        let validated = validate_consensus_response(&response, &[(feed, [0x11; 32])]).unwrap();
        assert_eq!(validated.feed_pubkeys, vec![feed]);
        assert_eq!(validated.values, vec![-123]);
        assert_eq!(
            validated.oracle_keys,
            vec![Pubkey::new_from_array([0x11; 32])]
        );
        assert_eq!(validated.secp_signatures.len(), 1);
    }

    #[test]
    fn consensus_response_validation_rejects_malformed_or_failed_responses() {
        let feed = Pubkey::new_unique();
        let requested = [(feed, [0x11; 32])];

        let invalid_value = consensus_response(vec![median_response([0x11; 32], "not-an-i128")]);
        assert!(validate_consensus_response(&invalid_value, &requested).is_err());

        let mut invalid_oracle = oracle_response();
        invalid_oracle.oracle_pubkey = "not-hex".to_string();
        let response = FetchSignaturesConsensusResponse {
            median_responses: vec![median_response([0x11; 32], "1")],
            oracle_responses: vec![invalid_oracle],
        };
        assert!(validate_consensus_response(&response, &requested).is_err());

        let mut invalid_signature = oracle_response();
        invalid_signature.signature = base64.encode([0x33; 63]);
        let response = FetchSignaturesConsensusResponse {
            median_responses: vec![median_response([0x11; 32], "1")],
            oracle_responses: vec![invalid_signature],
        };
        assert!(validate_consensus_response(&response, &requested).is_err());

        let mut invalid_recovery = oracle_response();
        invalid_recovery.recovery_id = 4;
        let response = FetchSignaturesConsensusResponse {
            median_responses: vec![median_response([0x11; 32], "1")],
            oracle_responses: vec![invalid_recovery],
        };
        assert!(validate_consensus_response(&response, &requested).is_err());

        let mut failed_oracle = oracle_response();
        failed_oracle.errors = vec![Some("feed failed".to_string())];
        let response = FetchSignaturesConsensusResponse {
            median_responses: vec![median_response([0x11; 32], "1")],
            oracle_responses: vec![failed_oracle],
        };
        assert!(validate_consensus_response(&response, &requested).is_err());
    }

    #[test]
    fn crossbar_jobs_must_be_present() {
        assert!(parse_jobs(&serde_json::json!({})).is_err());
    }

    #[test]
    fn pull_feed_account_decoder_accepts_unaligned_anchor_data() {
        let mut expected = PullFeedAccountData::zeroed();
        expected.feed_hash = [0x5a; 32];
        expected.max_variance = 1_234_567_890;
        expected.min_responses = 7;

        let account_len = 8 + std::mem::size_of::<PullFeedAccountData>();
        let alignment = std::mem::align_of::<PullFeedAccountData>();
        let mut storage = vec![0_u8; account_len + alignment];
        let base_address = storage.as_ptr() as usize;
        let start = (0..alignment)
            .find(|offset| ((base_address + offset + 8) & (alignment - 1)) != 0)
            .expect("PullFeedAccountData must support a deliberately unaligned fixture");
        let account = &mut storage[start..start + account_len];
        account[..8].copy_from_slice(&[196, 27, 108, 196, 10, 215, 219, 40]);
        account[8..].copy_from_slice(bytemuck::bytes_of(&expected));

        assert_ne!(
            account[8..].as_ptr() as usize % alignment,
            0,
            "fixture must exercise an unaligned account payload"
        );

        let decoded = decode_pull_feed_account_data(account).unwrap();
        assert_eq!(bytemuck::bytes_of(&decoded), bytemuck::bytes_of(&expected));
    }

    #[test]
    fn pull_feed_account_decoder_rejects_invalid_account_lengths() {
        let valid_len = 8 + std::mem::size_of::<PullFeedAccountData>();
        for invalid_len in [0, 7, valid_len - 1, valid_len + 1] {
            let account = vec![0_u8; invalid_len];
            assert!(
                decode_pull_feed_account_data(&account).is_err(),
                "account length {invalid_len} should be rejected"
            );
        }
    }
}
