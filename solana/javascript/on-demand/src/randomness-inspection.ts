import {
  buildSolanaRandomnessOracleCandidate,
  Oracle,
  type OracleAccountData,
  Queue,
  Randomness,
  type SolanaRandomnessOracleCandidate,
} from './accounts/index.js';
import { AnchorUtils } from './anchor-utils/index.js';
import {
  getDefaultQueueAddress,
  getQueue,
  ON_DEMAND_DEVNET_QUEUE_PDA,
  ON_DEMAND_MAINNET_QUEUE_PDA,
} from './utils/index.js';

import { web3 } from '@coral-xyz/anchor-31';
import {
  ACTIVE_RANDOMNESS_DEPLOYMENTS,
  type ActiveRandomnessDeployment,
  buildCurrentSelectionSummary,
  CrossbarClient,
  determineRandomnessRemediation,
  type RandomnessInspectionReport,
  type RandomnessInspectionStatus,
  summarizeRandomnessOracleCandidate,
} from '@switchboard-xyz/common';
import bs58 from 'bs58';
import { Buffer } from 'buffer';

export interface InspectSolanaRandomnessArgs {
  crossbarUrl?: string;
  randomnessId: string | web3.PublicKey;
  solanaRPCUrl?: string;
}

export interface SolanaRandomnessRequestState {
  authority: string;
  currentSlot: number;
  queue: string;
  revealSlot: number;
  rpcUrl: string;
  seedSlothash: string;
  seedSlot: number;
  selectionQueue: string;
  valueHex: string;
}

function isSvmQueue(queue: web3.PublicKey): boolean {
  return (
    queue.equals(ON_DEMAND_MAINNET_QUEUE_PDA) ||
    queue.equals(ON_DEMAND_DEVNET_QUEUE_PDA)
  );
}

function decodeGatewayUrl(gatewayUri: Uint8Array): string | null {
  const gatewayUrl = Buffer.from(gatewayUri).toString().replace(/\0+$/, '');
  return gatewayUrl.length > 0 ? gatewayUrl : null;
}

function toPublicKey(randomnessId: string | web3.PublicKey): web3.PublicKey {
  return typeof randomnessId === 'string'
    ? new web3.PublicKey(randomnessId)
    : randomnessId;
}

function resolveDeployment(queue: web3.PublicKey): ActiveRandomnessDeployment {
  const queueAddress = queue.toBase58();
  const deployment = ACTIVE_RANDOMNESS_DEPLOYMENTS.find(
    candidate => candidate.queueAddress === queueAddress
  );
  if (deployment) {
    return deployment;
  }

  if (queue.equals(ON_DEMAND_DEVNET_QUEUE_PDA)) {
    return {
      id: 'svm-devnet',
      family: 'svm',
      chain: 'svm',
      stage: 'devnet',
      queueAddress,
      notes: 'SVM queue PDA derived from the Solana devnet queue.',
    };
  }

  throw new Error(`Unsupported active randomness queue ${queueAddress}`);
}

function findAssignedCandidate(
  candidates: SolanaRandomnessOracleCandidate[],
  canonicalOracleId: string
): SolanaRandomnessOracleCandidate | undefined {
  return candidates.find(candidate => candidate.oracleId === canonicalOracleId);
}

export async function inspectSolanaRandomness({
  crossbarUrl,
  randomnessId,
  solanaRPCUrl = web3.clusterApiUrl('mainnet-beta'),
}: InspectSolanaRandomnessArgs): Promise<
  RandomnessInspectionReport<SolanaRandomnessRequestState>
> {
  const connection = new web3.Connection(solanaRPCUrl, 'confirmed');
  const program = await AnchorUtils.loadProgramFromConnection(connection);
  const randomnessPubkey = toPublicKey(randomnessId);
  const randomness = new Randomness(program, randomnessPubkey);
  const randomnessData = await randomness.loadData();
  const deployment = resolveDeployment(randomnessData.queue);
  const crossbarClient = crossbarUrl
    ? new CrossbarClient(crossbarUrl)
    : CrossbarClient.default();

  const selectionQueue = isSvmQueue(randomnessData.queue)
    ? await getQueue({
        program,
        queueAddress: getDefaultQueueAddress(
          randomnessData.queue.equals(ON_DEMAND_MAINNET_QUEUE_PDA)
        ),
      })
    : new Queue(program, randomnessData.queue);
  const selection =
    await selectionQueue.inspectRandomnessOracles(crossbarClient);

  const assignedOracle = new Oracle(program, randomnessData.oracle);
  const assignedOracleId = randomnessData.oracle.toBase58();
  let canonicalOracleId = assignedOracleId;
  let assignedOracleData: OracleAccountData;

  if (isSvmQueue(randomnessData.queue)) {
    const resolvedOracle = await assignedOracle.findSolanaOracleFromPDA();
    canonicalOracleId = resolvedOracle.oracle.toBase58();
    assignedOracleData = resolvedOracle.oracleData;
  } else {
    assignedOracleData = await assignedOracle.loadData();
  }

  const assignedCandidate =
    findAssignedCandidate(selection.candidates, canonicalOracleId) ??
    buildSolanaRandomnessOracleCandidate({
      oracle: new Oracle(
        selectionQueue.program,
        new web3.PublicKey(canonicalOracleId)
      ),
      data: assignedOracleData,
      liveOracleHealth:
        selection.liveHealth.byPullOracle.get(canonicalOracleId),
      queueData: selection.queueData,
      version: selection.liveHealth.majorityVersion ?? undefined,
    });

  const currentSlot = await program.provider.connection.getSlot('confirmed');
  const seedSlot = randomnessData.seedSlot.toNumber();
  const revealSlot = randomnessData.revealSlot.toNumber();
  const committed = seedSlot > 0;
  const resolved = revealSlot > 0;
  const ready = committed && currentSlot > seedSlot;
  const status: RandomnessInspectionStatus = resolved
    ? 'revealed'
    : !committed
      ? 'created'
      : ready
        ? 'ready'
        : 'waiting';
  const assignedOracleHealth = summarizeRandomnessOracleCandidate(
    assignedCandidate,
    selection.metadata
  );
  const recommendation = determineRandomnessRemediation({
    family: deployment.family,
    committed,
    ready,
    resolved,
    assignedOracleEligible: assignedOracleHealth.isEligible,
    assignedOracleId: canonicalOracleId,
    selectedOracleId: selection.selectedCandidate.oracleId,
  });

  return {
    family: deployment.family,
    deployment: {
      id: deployment.id,
      chain: deployment.chain,
      stage: deployment.stage,
      chainId: deployment.chainId,
      queueAddress: deployment.queueAddress,
      switchboardAddress: deployment.switchboardAddress,
    },
    randomnessId: randomnessPubkey.toBase58(),
    status,
    requestState: {
      authority: randomnessData.authority.toBase58(),
      currentSlot,
      queue: randomnessData.queue.toBase58(),
      revealSlot,
      rpcUrl: solanaRPCUrl,
      seedSlothash: bs58.encode(randomnessData.seedSlothash),
      seedSlot,
      selectionQueue: selectionQueue.pubkey.toBase58(),
      valueHex: Buffer.from(randomnessData.value).toString('hex'),
    },
    assignedOracle: {
      oracleId: assignedOracleId,
      canonicalOracleId:
        assignedOracleId === canonicalOracleId ? undefined : canonicalOracleId,
      gatewayUrl: decodeGatewayUrl(assignedOracleData.gatewayUri),
    },
    assignedOracleHealth,
    currentSelection: buildCurrentSelectionSummary({
      assignedOracleId: canonicalOracleId,
      metadata: selection.metadata,
      selectedOracleId: selection.selectedCandidate.oracleId,
    }),
    selectionMetadata: selection.metadata,
    recommendation,
  };
}
