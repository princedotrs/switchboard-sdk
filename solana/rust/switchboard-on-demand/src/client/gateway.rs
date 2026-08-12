use base64::prelude::*;
use prost::Message;
use reqwest::header::CONTENT_TYPE;
use reqwest::Client;
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use std::time::Duration;
use switchboard_protos::OracleJob;

const MAX_VARIANCE_SCALE: u64 = 1_000_000_000;

fn scale_human_max_variance(max_variance: Option<u32>) -> u64 {
    u64::from(max_variance.unwrap_or(1)) * MAX_VARIANCE_SCALE
}

#[derive(Debug)]
pub(crate) struct FetchSignaturesScaledParams {
    pub recent_hash: Option<String>,
    pub encoded_jobs: Vec<String>,
    pub num_signatures: u32,
    /// Exact 1e9-scaled integer used by the gateway checksum.
    pub max_variance_scaled: u64,
    pub min_responses: Option<u32>,
    pub use_timestamp: Option<bool>,
}

#[derive(Debug, Clone)]
pub(crate) struct FetchSignaturesConsensusScaledParams {
    pub recent_hash: Option<String>,
    pub feed_configs: Vec<BatchFeedRequest>,
    pub use_timestamp: Option<bool>,
    pub num_signatures: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MedianResponse {
    pub value: String,
    pub feed_hash: String,
}

/// Parameters for the consensus route.
#[derive(Debug, Clone)]
pub struct FetchSignaturesConsensusParams {
    pub recent_hash: Option<String>,
    pub feed_configs: Vec<FeedConfig>, // Your existing FeedConfig struct
    pub use_timestamp: Option<bool>,
    pub num_signatures: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FetchSignaturesConsensusResponse {
    pub median_responses: Vec<MedianResponse>,
    pub oracle_responses: Vec<ConsensusOracleResponse>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConsensusOracleResponse {
    pub oracle_pubkey: String,
    pub eth_address: String,
    pub signature: String,
    pub checksum: String,
    pub recovery_id: i32,
    pub feed_responses: Vec<FeedEvalResponse>,
    pub errors: Vec<Option<String>>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct FeedEvalResponse {
    pub oracle_pubkey: String,
    pub queue_pubkey: String,
    pub oracle_signing_pubkey: String,
    pub feed_hash: String,
    pub recent_hash: String,
    pub failure_error: String,
    pub success_value: String,
    pub msg: String,
    pub signature: String,
    pub recovery_id: i32,
    pub recent_successes_if_failed: Vec<FeedEvalResponse>,
    pub timestamp: Option<i64>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct FeedEvalResponseSingle {
    pub responses: Vec<FeedEvalResponse>,
    pub caller: String,
    pub failures: Vec<String>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct FeedEvalManyResponse {
    pub feed_responses: Vec<FeedEvalResponse>,
    pub signature: String,
    pub recovery_id: i32,
    pub errors: Vec<Option<String>>,
}

#[derive(Serialize, Deserialize, Debug)]
pub struct FetchSignaturesMultiResponse {
    pub oracle_responses: Vec<FeedEvalManyResponse>,
    pub errors: Vec<Option<String>>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct FetchSignaturesBatchRequest {
    pub api_version: String,
    /// Chain metadata for the oracle to sign with
    pub recent_hash: String,
    /// Signing protocol for the oracle to use
    pub signature_scheme: String,
    /// Hashing scheme for the checksum used in the signature
    pub hash_scheme: String,
    pub feed_requests: Vec<BatchFeedRequest>,
    pub num_oracles: u32,
    // Whether or not to use the timestamp in the checksum
    #[serde(default)]
    pub use_timestamp: bool,
}

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
pub struct FeedEvalBatchResponse {
    pub feed_responses: Vec<FeedEvalResponse>,
    pub errors: Vec<Option<String>>,
}

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
pub struct FetchSignaturesBatchResponse {
    pub oracle_responses: Vec<FeedEvalBatchResponse>,
    pub errors: Vec<String>,
}

#[derive(Serialize, Deserialize, Debug)]
pub struct RandomnessRevealResponse {
    pub signature: String,
    pub recovery_id: i32,
    pub value: Vec<u8>,
}

#[derive(Serialize, Deserialize, Debug)]
pub struct AttestEnclaveResponse {
    pub guardian: String,
    pub signature: String,
    pub recovery_id: i32,
}

#[derive(Serialize, Deserialize, Debug)]
pub struct PingResponse {
    pub oracle_pubkey: String,
    pub oracle_authority: String,
    pub queue: String,
    pub rate_limit: i32,
    pub version: String,
    pub mr_enclave: String,
    pub is_push_oracle: bool,
    pub is_pull_oracle: bool,
    pub is_gateway: bool,
    pub is_guardian: bool,
}

#[derive(Serialize, Deserialize, Debug)]
pub struct FetchQuoteResponse {
    pub oracle_pubkey: String,
    pub queue: String,
    pub now: i64,
    pub mr_enclave: String,
    pub ed25519_pubkey: String,
    pub secp256k1_pubkey: String,
    pub quote: String,
}

#[derive(Serialize, Deserialize, Debug)]
pub struct BridgeEnclaveResponse {
    pub guardian: String,
    pub oracle: String,
    pub queue: String,
    pub mr_enclave: String,
    pub chain_hash: String,
    pub oracle_ed25519_enclave_signer: String,
    pub oracle_secp256k1_enclave_signer: String,
    pub msg: String,
    pub msg_prehash: String,
    pub signature: String,
    pub recovery_id: i32,
}

#[derive(Debug, Clone, Default)]
pub struct Gateway {
    gateway_url: String,
    client: Arc<Client>,
}

impl Gateway {
    pub fn new(gateway_url: String) -> Self {
        let client = Client::builder()
            .timeout(Duration::from_secs(10))
            // Switchboard does its own keypair authentication
            .danger_accept_invalid_certs(true)
            .build()
            .unwrap();

        Self {
            gateway_url,
            client: Arc::new(client),
        }
    }

    /// Fetches signatures from the gateway
    /// # Arguments
    /// * `params` - FetchSignaturesParams
    /// * `params.recent_hash` - The recent hash of the feed
    /// * `params.encoded_jobs` - The encoded jobs
    /// * `params.num_signatures` - The number of signatures to fetch
    /// * `params.max_variance` - The maximum variance as a human percent; scaled by 1e9 internally
    /// * `params.min_responses` - The minimum number of responses, unscaled
    /// * `params.use_timestamp` - Whether to use the timestamp
    /// # Returns
    /// * `Result<FeedEvalResponseSingle, reqwest::Error>`
    pub async fn fetch_signatures_from_encoded(
        &self,
        params: FetchSignaturesParams,
    ) -> Result<FeedEvalResponseSingle, reqwest::Error> {
        self.fetch_signatures_from_encoded_scaled(FetchSignaturesScaledParams {
            recent_hash: params.recent_hash,
            encoded_jobs: params.encoded_jobs,
            num_signatures: params.num_signatures,
            max_variance_scaled: scale_human_max_variance(params.max_variance),
            min_responses: params.min_responses,
            use_timestamp: params.use_timestamp,
        })
        .await
    }

    pub(crate) async fn fetch_signatures_from_encoded_scaled(
        &self,
        params: FetchSignaturesScaledParams,
    ) -> Result<FeedEvalResponseSingle, reqwest::Error> {
        let url = format!("{}/gateway/api/v1/fetch_signatures", self.gateway_url);
        let body = serde_json::json!({
            "api_version": "1.0.0",
            "jobs_b64_encoded": params.encoded_jobs,
            "recent_chainhash": params.recent_hash.unwrap_or_else(|| bs58::encode(vec![0; 32]).into_string()),
            "signature_scheme": "Secp256k1",
            "hash_scheme": "Sha256",
            "num_oracles": params.num_signatures,
            "max_variance": params.max_variance_scaled,
            "min_responses": params.min_responses.unwrap_or(1),
            "use_timestamp": params.use_timestamp.unwrap_or(false),
        });

        let res = self
            .client
            .post(&url)
            .header(CONTENT_TYPE, "application/json")
            .json(&body)
            .send()
            .await?
            .error_for_status()?;

        res.json::<FeedEvalResponseSingle>().await
    }

    /// Fetches signatures from the gateway using the multi-feed method
    /// # Arguments
    /// * `params` - FetchSignaturesMultiParams
    /// * `params.recent_hash` - The recent hash of the feed
    /// * `params.feed_configs` - The feed configurations
    /// * `params.num_signatures` - The number of signatures to fetch
    /// * `params.use_timestamp` - Whether to use the timestamp
    /// # Returns
    /// * `Result<FetchSignaturesMultiResponse, reqwest::Error>`
    pub async fn fetch_signatures_multi(
        &self,
        params: FetchSignaturesMultiParams,
    ) -> Result<FetchSignaturesMultiResponse, reqwest::Error> {
        let url = format!("{}/gateway/api/v1/fetch_signatures_multi", self.gateway_url);
        let mut feed_requests = vec![];

        for config in params.feed_configs {
            feed_requests.push(serde_json::json!({
                "jobs_b64_encoded": config.encoded_jobs,
                "max_variance": scale_human_max_variance(config.max_variance),
                "min_responses": config.min_responses.unwrap_or(1),
                "use_timestamp": params.use_timestamp.unwrap_or(false),
            }));
        }

        let body = serde_json::json!({
            "api_version": "1.0.0",
            "num_oracles": params.num_signatures.unwrap_or(1),
            "recent_hash": params.recent_hash.unwrap_or_else(|| bs58::encode(vec![0; 32]).into_string()),
            "signature_scheme": "Secp256k1",
            "hash_scheme": "Sha256",
            "feed_requests": feed_requests,
        });

        let res = self
            .client
            .post(&url)
            .header(CONTENT_TYPE, "application/json")
            .json(&body)
            .send()
            .await?
            .error_for_status()?;
        let res = res.json::<FetchSignaturesMultiResponse>().await?;

        Ok(res)
    }

    pub async fn fetch_signatures_batch(
        &self,
        params: FetchSignaturesBatchParams,
    ) -> Result<FetchSignaturesBatchResponse, reqwest::Error> {
        let url = format!("{}/gateway/api/v1/fetch_signatures_batch", self.gateway_url);
        let req = FetchSignaturesBatchRequest {
            api_version: "1.0.0".to_string(),
            recent_hash: params
                .recent_hash
                .clone()
                .unwrap_or_else(|| bs58::encode(vec![0; 32]).into_string()),
            signature_scheme: "Secp256k1".to_string(),
            hash_scheme: "Sha256".to_string(),
            feed_requests: params.feed_configs.clone(),
            num_oracles: params.num_signatures.unwrap_or(1),
            use_timestamp: params.use_timestamp.unwrap_or(false),
        };

        let res = self
            .client
            .post(&url)
            .header(CONTENT_TYPE, "application/json")
            .json(&req)
            .send()
            .await?
            .error_for_status()?;

        let response = res.json::<FetchSignaturesBatchResponse>().await?;
        Ok(response)
    }

    pub async fn fetch_signatures_consensus(
        &self,
        params: FetchSignaturesConsensusParams,
    ) -> Result<FetchSignaturesConsensusResponse, reqwest::Error> {
        let feed_configs = params
            .feed_configs
            .into_iter()
            .map(|config| BatchFeedRequest {
                jobs_b64_encoded: config.encoded_jobs,
                max_variance: scale_human_max_variance(config.max_variance),
                min_responses: config.min_responses.unwrap_or(1),
            })
            .collect();

        self.fetch_signatures_consensus_scaled(FetchSignaturesConsensusScaledParams {
            recent_hash: params.recent_hash,
            feed_configs,
            use_timestamp: params.use_timestamp,
            num_signatures: params.num_signatures,
        })
        .await
    }

    pub(crate) async fn fetch_signatures_consensus_scaled(
        &self,
        params: FetchSignaturesConsensusScaledParams,
    ) -> Result<FetchSignaturesConsensusResponse, reqwest::Error> {
        let url = format!(
            "{}/gateway/api/v1/fetch_signatures_consensus",
            self.gateway_url
        );
        println!("Fetching signatures from: {}", url);
        let feed_requests: Vec<serde_json::Value> = params
            .feed_configs
            .iter()
            .map(|config| {
                serde_json::json!({
                    "jobs_b64_encoded": config.jobs_b64_encoded,
                    "max_variance": config.max_variance,
                    "min_responses": config.min_responses,
                    "use_timestamp": params.use_timestamp.unwrap_or(false)
                })
            })
            .collect();

        let body = serde_json::json!({
            "api_version": "1.0.0",
            "recent_hash": params.recent_hash.unwrap_or_else(|| bs58::encode(vec![0; 32]).into_string()),
            "signature_scheme": "Secp256k1",
            "hash_scheme": "Sha256",
            "feed_requests": feed_requests,
            "num_oracles": params.num_signatures.unwrap_or(1)
        });

        let res = self
            .client
            .post(&url)
            .header(CONTENT_TYPE, "application/json")
            .json(&body)
            .send()
            .await?
            .error_for_status()?;

        let response = res.json::<FetchSignaturesConsensusResponse>().await?;
        Ok(response)
    }

    pub async fn test_gateway(&self) -> bool {
        let client = &self.client;
        // Make HTTP request
        let url = format!("{}/gateway/api/v1/test", self.gateway_url);
        let response = client.get(&url).send().await;

        // Process response
        if let Ok(resp) = response {
            if let Ok(text) = resp.text().await {
                !text.is_empty()
            } else {
                false
            }
        } else {
            false
        }
    }
}

#[derive(Debug)]
pub struct FetchSignaturesParams {
    pub recent_hash: Option<String>,
    pub encoded_jobs: Vec<String>,
    pub num_signatures: u32,
    /// Human percent; scaled by 1e9 before sending the gateway request.
    pub max_variance: Option<u32>,
    /// Unscaled job/source quorum.
    pub min_responses: Option<u32>,
    pub use_timestamp: Option<bool>,
}

#[derive(Debug, Clone)]
pub struct FeedConfig {
    pub encoded_jobs: Vec<String>,
    /// Human percent; scaled by 1e9 before sending the gateway request.
    pub max_variance: Option<u32>,
    /// Unscaled job/source quorum.
    pub min_responses: Option<u32>,
}

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
pub struct BatchFeedRequest {
    /// Vec of jobs to process. Each group is equivalent to 1 feed.
    pub jobs_b64_encoded: Vec<String>,
    /// Allowed variance in the feed values, already scaled by 1e9
    pub max_variance: u64,
    /// Minimum number of responses required for the feed, unscaled
    pub min_responses: u32,
}

#[derive(Debug)]
pub struct FetchSignaturesMultiParams {
    pub recent_hash: Option<String>,
    pub feed_configs: Vec<FeedConfig>,
    pub num_signatures: Option<u32>,
    pub use_timestamp: Option<bool>,
}

#[derive(Debug, Clone, Default)]
pub struct FetchSignaturesBatchParams {
    pub recent_hash: Option<String>,
    pub feed_configs: Vec<BatchFeedRequest>,
    pub num_signatures: Option<u32>,
    pub use_timestamp: Option<bool>,
}

pub fn encode_jobs(job_array: &[OracleJob]) -> Vec<String> {
    job_array
        .iter()
        .map(|job| BASE64_STANDARD.encode(job.encode_length_delimited_to_vec()))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::Value;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    use tokio::net::TcpListener;
    use tokio::sync::oneshot;

    async fn capture_request(
        status: &'static str,
        response_body: &'static str,
    ) -> (String, oneshot::Receiver<Value>) {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let (sender, receiver) = oneshot::channel();

        tokio::spawn(async move {
            let (mut stream, _) = listener.accept().await.unwrap();
            let mut request = Vec::new();
            let mut buffer = [0_u8; 4096];

            let body_start = loop {
                let bytes_read = stream.read(&mut buffer).await.unwrap();
                assert_ne!(bytes_read, 0, "request ended before its headers");
                request.extend_from_slice(&buffer[..bytes_read]);

                if let Some(header_end) = request.windows(4).position(|bytes| bytes == b"\r\n\r\n")
                {
                    let body_start = header_end + 4;
                    let headers = std::str::from_utf8(&request[..header_end]).unwrap();
                    let content_length = headers
                        .lines()
                        .find_map(|line| {
                            let (name, value) = line.split_once(':')?;
                            name.eq_ignore_ascii_case("content-length")
                                .then(|| value.trim().parse::<usize>().unwrap())
                        })
                        .unwrap_or(0);
                    if request.len() >= body_start + content_length {
                        break body_start;
                    }
                }
            };

            let body = serde_json::from_slice(&request[body_start..]).unwrap();
            sender.send(body).unwrap();

            let response = format!(
                "HTTP/1.1 {status}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{response_body}",
                response_body.len()
            );
            stream.write_all(response.as_bytes()).await.unwrap();
        });

        (format!("http://{address}"), receiver)
    }

    #[test]
    fn human_max_variance_scaling_preserves_existing_semantics() {
        assert_eq!(scale_human_max_variance(None), 1_000_000_000);
        assert_eq!(scale_human_max_variance(Some(0)), 0);
        assert_eq!(scale_human_max_variance(Some(1)), 1_000_000_000);
        assert_eq!(
            scale_human_max_variance(Some(u32::MAX)),
            u64::from(u32::MAX) * 1_000_000_000
        );
    }

    #[tokio::test]
    async fn scaled_single_request_preserves_exact_max_variance() {
        for max_variance in [0, 8_271_619, 1_000_000_000, 1_234_567_891, u64::MAX] {
            let (url, request) = capture_request(
                "200 OK",
                r#"{"responses":[],"caller":"test","failures":[]}"#,
            )
            .await;
            let gateway = Gateway::new(url);

            gateway
                .fetch_signatures_from_encoded_scaled(FetchSignaturesScaledParams {
                    recent_hash: Some("recent".to_string()),
                    encoded_jobs: vec!["job".to_string()],
                    num_signatures: 1,
                    max_variance_scaled: max_variance,
                    min_responses: Some(1),
                    use_timestamp: Some(false),
                })
                .await
                .unwrap();

            let request = request.await.unwrap();
            assert_eq!(request["max_variance"].as_u64(), Some(max_variance));
        }
    }

    #[tokio::test]
    async fn scaled_consensus_request_preserves_exact_max_variance() {
        let (url, request) =
            capture_request("200 OK", r#"{"median_responses":[],"oracle_responses":[]}"#).await;
        let gateway = Gateway::new(url);

        gateway
            .fetch_signatures_consensus_scaled(FetchSignaturesConsensusScaledParams {
                recent_hash: Some("recent".to_string()),
                feed_configs: vec![BatchFeedRequest {
                    jobs_b64_encoded: vec!["job".to_string()],
                    max_variance: 8_271_619,
                    min_responses: 1,
                }],
                use_timestamp: Some(false),
                num_signatures: Some(1),
            })
            .await
            .unwrap();

        let request = request.await.unwrap();
        assert_eq!(request["feed_requests"][0]["max_variance"], 8_271_619);
    }

    #[tokio::test]
    async fn gateway_http_errors_are_returned() {
        let (url, _request) = capture_request("500 Internal Server Error", "{}").await;
        let gateway = Gateway::new(url);

        let error = gateway
            .fetch_signatures_from_encoded_scaled(FetchSignaturesScaledParams {
                recent_hash: None,
                encoded_jobs: vec![],
                num_signatures: 1,
                max_variance_scaled: 0,
                min_responses: None,
                use_timestamp: None,
            })
            .await
            .unwrap_err();

        assert_eq!(
            error.status(),
            Some(reqwest::StatusCode::INTERNAL_SERVER_ERROR)
        );
    }

    #[tokio::test]
    async fn malformed_gateway_json_is_returned_as_an_error() {
        let (url, _request) = capture_request("200 OK", "not json").await;
        let gateway = Gateway::new(url);

        assert!(gateway
            .fetch_signatures_from_encoded_scaled(FetchSignaturesScaledParams {
                recent_hash: None,
                encoded_jobs: vec![],
                num_signatures: 1,
                max_variance_scaled: 0,
                min_responses: None,
                use_timestamp: None,
            })
            .await
            .is_err());
    }
}
