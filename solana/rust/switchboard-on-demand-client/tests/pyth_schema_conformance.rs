use prost::Message;
use protos::{OracleFeed, OracleJob};
use serde::Deserialize;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Vectors {
    pyth_push: JobVector,
    oracle_feed_v2: FeedVector,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct JobVector {
    expected_length_delimited_hex: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct FeedVector {
    expected_length_delimited_hex: String,
}

#[test]
fn pyth_schema_fields_survive_sdk_decode_and_reencode() {
    let vectors: Vectors = serde_json::from_str(protos::FEED_HASH_CONFORMANCE_JSON).unwrap();

    let job_bytes = hex::decode(vectors.pyth_push.expected_length_delimited_hex).unwrap();
    let job = OracleJob::decode_length_delimited(job_bytes.as_slice()).unwrap();
    assert_eq!(job.encode_length_delimited_to_vec(), job_bytes);

    let job_json = serde_json::to_value(job).unwrap();
    assert_eq!(
        job_json.pointer("/tasks/0/medianTask/jobs/1/tasks/0/oracleTask/pythPushFeedId"),
        Some(&serde_json::json!(
            "0xef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d"
        ))
    );
    assert_eq!(
        job_json
            .pointer("/tasks/0/medianTask/jobs/1/tasks/0/oracleTask/pythConfigs/pushFeedShardId"),
        Some(&serde_json::json!(0))
    );
    assert_eq!(
        job_json.pointer("/tasks/0/medianTask/jobs/1/tasks/0/oracleTask/pythConfigs/apiKey"),
        Some(&serde_json::json!("${PYTH_API_KEY}"))
    );

    let feed_bytes = hex::decode(vectors.oracle_feed_v2.expected_length_delimited_hex).unwrap();
    let feed = OracleFeed::decode_length_delimited(feed_bytes.as_slice()).unwrap();
    assert_eq!(feed.encode_length_delimited_to_vec(), feed_bytes);
}
