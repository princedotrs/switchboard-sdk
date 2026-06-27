use anyhow_ext::Context;
use anyhow_ext::Error as AnyhowError;
use arrayref::array_ref;
use bytemuck;
use solana_client::nonblocking::rpc_client::RpcClient;
use solana_sdk::commitment_config::CommitmentConfig;
use std::result::Result;

#[repr(C)]
#[derive(bytemuck::Pod, bytemuck::Zeroable, Debug, Clone, Copy)]
pub struct SlotHash {
    pub slot: u64,
    pub hash: [u8; 32],
}

impl SlotHash {
    /// Returns the base58-encoded hash as a `String`.
    pub fn to_base58_hash(&self) -> String {
        bs58::encode(self.hash).into_string()
    }
}

pub struct SlotHashSysvar;
impl<'a> SlotHashSysvar {
    pub async fn get_latest_slothash(client: &RpcClient) -> Result<SlotHash, AnyhowError> {
        let slots_data = client
            .get_account_with_commitment(
                &solana_sdk::sysvar::slot_hashes::ID,
                CommitmentConfig::confirmed(),
            )
            .await
            .context("Failed to fetch slot hashes")?
            .value
            .context("Failed to fetch slot hashes")?
            .data;
        let slots: &[u8] = array_ref![slots_data, 8, 20_480];
        // 20_480 / 40 = 512
        let slots: &[SlotHash] = bytemuck::cast_slice::<u8, SlotHash>(slots);
        Ok(slots[0])
    }
}
