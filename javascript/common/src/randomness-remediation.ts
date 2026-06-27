import type {
  ActiveRandomnessDeployment,
  RandomnessDeploymentFamily,
} from './randomness-deployments.js';
import {
  evaluateRandomnessOracleCandidate,
  isRandomnessOracleCandidateEligible,
  type RandomnessOracleSelectionEvaluation,
  type RandomnessOracleSelectionMetadata,
  type RandomnessOracleSelectionTier,
  type RandomnessOracleSelectorCandidate,
} from './randomness-selector.js';

export type RandomnessRemediationAction =
  | 'none'
  | 'retry'
  | 'reroll'
  | 'recreate';

export type RandomnessInspectionStatus =
  | 'created'
  | 'waiting'
  | 'ready'
  | 'revealed'
  | 'settled';

export interface RandomnessOracleHealthSummary {
  oracleId: string;
  gatewayUrl: string | null;
  version: string | null;
  liveHealthy: boolean;
  isEligible: boolean;
  isOnQueue: boolean;
  isVerified: boolean;
  heartbeatFresh: boolean;
  quoteFresh: boolean;
  restricted?: boolean;
  gatewayEnabled?: boolean;
  pullOracleEnabled?: boolean;
  lastHeartbeatUnix?: number;
  validUntilUnix?: number;
  activeConnections?: number;
  totalSubscriptions?: number;
  totalFeeds?: number;
  evaluation: RandomnessOracleSelectionEvaluation;
}

export interface RandomnessRecommendation {
  action: RandomnessRemediationAction;
  reason: string;
}

export interface RandomnessCurrentSelectionSummary {
  oracleId: string;
  tier: RandomnessOracleSelectionTier;
  majorityVersion: string | null;
  liveHealthyCandidateCount: number;
  fallbackCandidateCount: number;
  matchesAssignedOracle: boolean;
}

export interface RandomnessAssignedOracleSummary {
  oracleId: string;
  canonicalOracleId?: string;
  gatewayUrl: string | null;
  signingAddress?: string | null;
}

export interface RandomnessInspectionReport<
  RequestState = Record<string, unknown>,
> {
  family: RandomnessDeploymentFamily;
  deployment: Pick<
    ActiveRandomnessDeployment,
    'id' | 'chain' | 'stage' | 'chainId' | 'queueAddress' | 'switchboardAddress'
  >;
  randomnessId: string;
  status: RandomnessInspectionStatus;
  requestState: RequestState;
  assignedOracle?: RandomnessAssignedOracleSummary;
  assignedOracleHealth?: RandomnessOracleHealthSummary;
  currentSelection?: RandomnessCurrentSelectionSummary;
  selectionMetadata?: RandomnessOracleSelectionMetadata;
  recommendation: RandomnessRecommendation;
}

export interface DetermineRandomnessRemediationArgs {
  family: RandomnessDeploymentFamily;
  committed: boolean;
  ready: boolean;
  resolved: boolean;
  assignedOracleId?: string | null;
  selectedOracleId?: string | null;
  assignedOracleEligible?: boolean;
}

function normalizeOracleId(oracleId?: string | null): string | null {
  if (!oracleId) {
    return null;
  }

  const normalized = oracleId.trim();
  return normalized.length > 0 ? normalized.toLowerCase() : null;
}

export function getRandomnessOracleEvaluation(
  metadata: RandomnessOracleSelectionMetadata | undefined,
  oracleId: string
): RandomnessOracleSelectionEvaluation | undefined {
  return metadata?.evaluations.find(
    evaluation =>
      normalizeOracleId(evaluation.oracleId) === normalizeOracleId(oracleId)
  );
}

export function summarizeRandomnessOracleCandidate<
  T extends RandomnessOracleSelectorCandidate,
>(
  candidate: T,
  metadata?: RandomnessOracleSelectionMetadata
): RandomnessOracleHealthSummary {
  return {
    oracleId: candidate.oracleId,
    gatewayUrl: candidate.gatewayUrl ?? null,
    version: candidate.version ?? null,
    liveHealthy: candidate.liveHealthy,
    isEligible: isRandomnessOracleCandidateEligible(candidate),
    isOnQueue: candidate.isOnQueue,
    isVerified: candidate.isVerified,
    heartbeatFresh: candidate.heartbeatFresh,
    quoteFresh: candidate.quoteFresh,
    restricted: candidate.restricted,
    gatewayEnabled: candidate.gatewayEnabled,
    pullOracleEnabled: candidate.pullOracleEnabled,
    lastHeartbeatUnix: candidate.lastHeartbeatUnix,
    validUntilUnix: candidate.validUntilUnix,
    activeConnections: candidate.activeConnections,
    totalSubscriptions: candidate.totalSubscriptions,
    totalFeeds: candidate.totalFeeds,
    evaluation:
      getRandomnessOracleEvaluation(metadata, candidate.oracleId) ??
      evaluateRandomnessOracleCandidate(candidate),
  };
}

export function buildCurrentSelectionSummary(params: {
  assignedOracleId?: string | null;
  metadata: RandomnessOracleSelectionMetadata;
  selectedOracleId: string;
}): RandomnessCurrentSelectionSummary {
  const assignedOracleId = normalizeOracleId(params.assignedOracleId);
  const selectedOracleId = normalizeOracleId(params.selectedOracleId) ?? '';

  return {
    oracleId: params.selectedOracleId,
    tier: params.metadata.tier,
    majorityVersion: params.metadata.majorityVersion,
    liveHealthyCandidateCount: params.metadata.liveHealthyCandidateCount,
    fallbackCandidateCount: params.metadata.fallbackCandidateCount,
    matchesAssignedOracle:
      assignedOracleId !== null && assignedOracleId === selectedOracleId,
  };
}

export function determineRandomnessRemediation({
  family,
  committed,
  ready,
  resolved,
  assignedOracleId,
  selectedOracleId,
  assignedOracleEligible,
}: DetermineRandomnessRemediationArgs): RandomnessRecommendation {
  if (resolved) {
    return {
      action: 'none',
      reason: 'Randomness is already settled or revealed.',
    };
  }

  if (!committed) {
    return {
      action: 'retry',
      reason: 'Randomness has not been committed to an oracle yet.',
    };
  }

  if (!ready) {
    return {
      action: 'retry',
      reason:
        'Randomness is still waiting for its reveal or settlement window.',
    };
  }

  const normalizedAssigned = normalizeOracleId(assignedOracleId);
  const normalizedSelected = normalizeOracleId(selectedOracleId);

  if (!normalizedAssigned) {
    return {
      action: family === 'evm' ? 'reroll' : 'recreate',
      reason:
        'The request is committed but has no usable assigned oracle binding.',
    };
  }

  if (assignedOracleEligible === false) {
    return {
      action: family === 'evm' ? 'reroll' : 'recreate',
      reason:
        family === 'evm'
          ? 'The assigned oracle is no longer eligible for healthy randomness routing.'
          : 'The assigned oracle is no longer eligible for healthy randomness routing, ' +
            'and this request cannot be rerouted in place.',
    };
  }

  if (
    normalizedSelected !== null &&
    normalizedAssigned !== normalizedSelected
  ) {
    return {
      action: family === 'evm' ? 'reroll' : 'recreate',
      reason:
        family === 'evm'
          ? 'Healthy oracle selection now prefers a different oracle than the one pinned on this request.'
          : 'Healthy oracle selection now prefers a different oracle than the one pinned on this request, ' +
            'so a fresh request is needed to move away from the current binding.',
    };
  }

  return {
    action: 'retry',
    reason:
      'The assigned oracle is still the current healthy selection candidate.',
  };
}
