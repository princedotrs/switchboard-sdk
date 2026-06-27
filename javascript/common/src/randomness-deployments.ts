export type RandomnessDeploymentFamily = 'solana' | 'svm' | 'starknet' | 'evm';
export type RandomnessDeploymentStage = 'mainnet' | 'devnet' | 'testnet';

export interface ActiveRandomnessDeployment {
  id: string;
  family: RandomnessDeploymentFamily;
  chain: string;
  stage: RandomnessDeploymentStage;
  chainId?: number;
  queueAddress?: string;
  switchboardAddress?: string;
  notes?: string;
}

export const ACTIVE_RANDOMNESS_DEPLOYMENTS: ActiveRandomnessDeployment[] = [
  {
    id: 'solana-mainnet',
    family: 'solana',
    chain: 'solana',
    stage: 'mainnet',
    queueAddress: 'A43DyUGA7s8eXPxqEjJY6EBu1KKbNgfxF8h17VAHn13w',
  },
  {
    id: 'solana-devnet',
    family: 'solana',
    chain: 'solana',
    stage: 'devnet',
    queueAddress: 'EYiAmGSdsQTuCw413V5BzaruWuCCSDgTPtBGvLkXHbe7',
  },
  {
    id: 'eclipse-mainnet',
    family: 'svm',
    chain: 'eclipse',
    stage: 'mainnet',
    queueAddress: 'A2e1o9wWo6HWaCXrbjM6o3zq4QbD1LzYBSSMSmc5Qw3z',
    notes: 'SVM queue PDA derived from the Solana mainnet queue.',
  },
  {
    id: 'starknet-mainnet',
    family: 'starknet',
    chain: 'starknet',
    stage: 'mainnet',
    switchboardAddress:
      '0x068cc3c8e1d1ae4683ee7844454a11bc32ae0aa6188f268d73f7fff8004be68d',
  },
  {
    id: 'starknet-testnet',
    family: 'starknet',
    chain: 'starknet',
    stage: 'testnet',
    switchboardAddress:
      '0x02d880dd4a1fb6f61fc13b1ea767187b9b85f97460a2997abb537fb100cbc439',
  },
  {
    id: 'monad-mainnet',
    family: 'evm',
    chain: 'monad',
    stage: 'mainnet',
    chainId: 143,
  },
  {
    id: 'monad-testnet',
    family: 'evm',
    chain: 'monad',
    stage: 'testnet',
    chainId: 10143,
  },
  {
    id: 'base-sepolia',
    family: 'evm',
    chain: 'base',
    stage: 'testnet',
    chainId: 84532,
  },
  {
    id: 'hyperliquid-mainnet',
    family: 'evm',
    chain: 'hyperliquid',
    stage: 'mainnet',
    chainId: 999,
  },
];

export const ACTIVE_RANDOMNESS_EVM_DEPLOYMENTS =
  ACTIVE_RANDOMNESS_DEPLOYMENTS.filter(
    deployment =>
      deployment.family === 'evm' && deployment.chainId !== undefined
  );

export function getActiveRandomnessEvmDeployment(
  chainId: number
): ActiveRandomnessDeployment | undefined {
  return ACTIVE_RANDOMNESS_EVM_DEPLOYMENTS.find(
    deployment => deployment.chainId === chainId
  );
}

export function getCrossbarOracleNetworkForEvmChainId(
  chainId: number
): 'mainnet' | 'devnet' {
  const deployment = getActiveRandomnessEvmDeployment(chainId);
  if (!deployment) {
    throw new Error(
      `Unsupported active randomness EVM deployment for chainId ${chainId}`
    );
  }

  return deployment.stage === 'mainnet' ? 'mainnet' : 'devnet';
}
