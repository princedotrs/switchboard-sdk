import type { OracleInfo } from './types/crossbar.js';
import type {
  HealthyOraclesResponse,
  OracleHealthData,
} from './types/gateway.js';

export type RandomnessOracleSelectionTier = 'live' | 'fallback';

export type RandomnessOracleRejectionReason =
  | 'missing-gateway'
  | 'not-on-queue'
  | 'verification-failed'
  | 'heartbeat-stale'
  | 'quote-expired'
  | 'restricted'
  | 'gateway-disabled'
  | 'pull-oracle-disabled'
  | 'version-mismatch'
  | 'health-data-unavailable';

export interface RandomnessOracleSelectorCandidate {
  oracleId: string;
  gatewayUrl?: string | null;
  version?: string | null;
  isOnQueue: boolean;
  isVerified: boolean;
  heartbeatFresh: boolean;
  quoteFresh: boolean;
  liveHealthy: boolean;
  restricted?: boolean;
  gatewayEnabled?: boolean;
  pullOracleEnabled?: boolean;
  lastHeartbeatUnix?: number;
  validUntilUnix?: number;
  activeConnections?: number;
  totalSubscriptions?: number;
  totalFeeds?: number;
}

export interface RandomnessOracleSelectionEvaluation {
  oracleId: string;
  tier?: RandomnessOracleSelectionTier;
  version?: string | null;
  rejectionReasons: RandomnessOracleRejectionReason[];
  liveHealthy: boolean;
}

export interface RandomnessOracleSelectionMetadata {
  tier: RandomnessOracleSelectionTier;
  majorityVersion: string | null;
  liveHealthyCandidateCount: number;
  fallbackCandidateCount: number;
  evaluations: RandomnessOracleSelectionEvaluation[];
}

export interface RandomnessOracleSelectionResult<
  T extends RandomnessOracleSelectorCandidate,
> {
  candidate: T;
  metadata: RandomnessOracleSelectionMetadata;
}

export interface HealthyOracleGatewaySnapshot {
  gatewayUrl: string;
  response: HealthyOraclesResponse;
}

export interface MergedHealthyOracleIndex {
  byPullOracle: Map<string, OracleHealthData>;
  bySecp256k1Key: Map<string, OracleHealthData>;
  majorityVersion: string | null;
}

function normalizeVersion(version?: string | null): string | null {
  if (!version) {
    return null;
  }

  const normalized = version.trim();
  return normalized.length > 0 ? normalized : null;
}

function computeMajorityVersion(
  candidates: Array<Pick<RandomnessOracleSelectorCandidate, 'version'>>
): string | null {
  const counts = new Map<string, number>();
  for (const candidate of candidates) {
    const version = normalizeVersion(candidate.version);
    if (!version) {
      continue;
    }
    counts.set(version, (counts.get(version) ?? 0) + 1);
  }

  let majorityVersion: string | null = null;
  let maxCount = 0;
  for (const [version, count] of counts.entries()) {
    if (count > maxCount) {
      majorityVersion = version;
      maxCount = count;
    }
  }

  return majorityVersion;
}

function uniqueCount<T>(values: T[]): number {
  return new Set(values).size;
}

function compareCandidates(
  left: RandomnessOracleSelectorCandidate,
  right: RandomnessOracleSelectorCandidate
): number {
  const numericFields: Array<
    keyof Pick<
      RandomnessOracleSelectorCandidate,
      | 'activeConnections'
      | 'totalSubscriptions'
      | 'totalFeeds'
      | 'lastHeartbeatUnix'
      | 'validUntilUnix'
    >
  > = [
    'activeConnections',
    'totalSubscriptions',
    'totalFeeds',
    'lastHeartbeatUnix',
    'validUntilUnix',
  ];

  const ascendingDefaults: Record<string, number> = {
    activeConnections: Number.MAX_SAFE_INTEGER,
    totalSubscriptions: Number.MAX_SAFE_INTEGER,
    totalFeeds: Number.MIN_SAFE_INTEGER,
    lastHeartbeatUnix: Number.MIN_SAFE_INTEGER,
    validUntilUnix: Number.MIN_SAFE_INTEGER,
  };

  for (const field of numericFields) {
    const leftValue = left[field] ?? ascendingDefaults[field];
    const rightValue = right[field] ?? ascendingDefaults[field];

    if (
      field === 'totalFeeds' ||
      field === 'lastHeartbeatUnix' ||
      field === 'validUntilUnix'
    ) {
      if (leftValue !== rightValue) {
        return rightValue - leftValue;
      }
    } else if (leftValue !== rightValue) {
      return leftValue - rightValue;
    }
  }

  return left.oracleId.localeCompare(right.oracleId);
}

export function evaluateRandomnessOracleCandidate(
  candidate: RandomnessOracleSelectorCandidate
): RandomnessOracleSelectionEvaluation {
  const rejectionReasons: RandomnessOracleRejectionReason[] = [];
  if (!candidate.gatewayUrl) {
    rejectionReasons.push('missing-gateway');
  }
  if (!candidate.isOnQueue) {
    rejectionReasons.push('not-on-queue');
  }
  if (!candidate.isVerified) {
    rejectionReasons.push('verification-failed');
  }
  if (!candidate.heartbeatFresh) {
    rejectionReasons.push('heartbeat-stale');
  }
  if (!candidate.quoteFresh) {
    rejectionReasons.push('quote-expired');
  }
  if (candidate.restricted) {
    rejectionReasons.push('restricted');
  }
  if (candidate.gatewayEnabled === false) {
    rejectionReasons.push('gateway-disabled');
  }
  if (candidate.pullOracleEnabled === false) {
    rejectionReasons.push('pull-oracle-disabled');
  }
  if (!candidate.liveHealthy) {
    rejectionReasons.push('health-data-unavailable');
  }

  return {
    oracleId: candidate.oracleId,
    version: normalizeVersion(candidate.version),
    rejectionReasons,
    liveHealthy: candidate.liveHealthy,
  };
}

export function isRandomnessOracleCandidateEligible(
  candidate: RandomnessOracleSelectorCandidate
): boolean {
  return (
    Boolean(candidate.gatewayUrl) &&
    candidate.isOnQueue &&
    candidate.isVerified &&
    candidate.heartbeatFresh &&
    candidate.quoteFresh &&
    candidate.restricted !== true &&
    candidate.gatewayEnabled !== false &&
    candidate.pullOracleEnabled !== false
  );
}

export function selectRandomnessOracle<
  T extends RandomnessOracleSelectorCandidate,
>(candidates: T[]): RandomnessOracleSelectionResult<T> {
  if (candidates.length === 0) {
    throw new Error('No randomness oracle candidates were provided');
  }

  const evaluations = candidates.map(evaluateRandomnessOracleCandidate);
  const baseEligible = candidates.filter(isRandomnessOracleCandidateEligible);

  if (baseEligible.length === 0) {
    throw new Error('No eligible randomness oracle candidates were found');
  }

  const liveCandidates = baseEligible.filter(
    candidate => candidate.liveHealthy
  );
  const fallbackCandidates = [...baseEligible];
  const selectionPool =
    liveCandidates.length > 0 ? liveCandidates : fallbackCandidates;
  const tier: RandomnessOracleSelectionTier =
    liveCandidates.length > 0 ? 'live' : 'fallback';
  const majorityVersion = computeMajorityVersion(selectionPool);
  const preferredCandidates =
    majorityVersion === null
      ? selectionPool
      : selectionPool.filter(
          candidate => normalizeVersion(candidate.version) === majorityVersion
        );
  const sortableCandidates =
    preferredCandidates.length > 0 ? preferredCandidates : selectionPool;
  const selectedCandidate = [...sortableCandidates].sort(compareCandidates)[0];

  for (const evaluation of evaluations) {
    if (evaluation.oracleId === selectedCandidate.oracleId) {
      evaluation.tier = tier;
    } else if (
      majorityVersion !== null &&
      evaluation.version !== null &&
      evaluation.version !== majorityVersion
    ) {
      evaluation.rejectionReasons = [
        ...evaluation.rejectionReasons,
        'version-mismatch',
      ];
    }
  }

  return {
    candidate: selectedCandidate,
    metadata: {
      tier,
      majorityVersion,
      liveHealthyCandidateCount: liveCandidates.length,
      fallbackCandidateCount: fallbackCandidates.length,
      evaluations,
    },
  };
}

export async function fetchHealthyOracleSnapshots(
  gatewayUrls: string[]
): Promise<HealthyOracleGatewaySnapshot[]> {
  const { Gateway } = await import('./gateway.js');
  const snapshots = await Promise.allSettled(
    Array.from(new Set(gatewayUrls)).map(async gatewayUrl => ({
      gatewayUrl,
      response: await new Gateway(gatewayUrl).fetchHealthyOracles(),
    }))
  );

  return snapshots
    .filter(
      (
        snapshot
      ): snapshot is PromiseFulfilledResult<HealthyOracleGatewaySnapshot> =>
        snapshot.status === 'fulfilled'
    )
    .map(snapshot => snapshot.value);
}

export function mergeHealthyOracleSnapshots(
  snapshots: HealthyOracleGatewaySnapshot[]
): MergedHealthyOracleIndex {
  const byPullOracle = new Map<string, OracleHealthData>();
  const bySecp256k1Key = new Map<string, OracleHealthData>();
  const versionCandidates: Array<{ version?: string | null }> = [];

  for (const snapshot of snapshots) {
    for (const oracle of snapshot.response.oracles) {
      if (!oracle.oracle_config) {
        continue;
      }

      const version = normalizeVersion(oracle.oracle_config.version);
      versionCandidates.push({ version });

      const pullOracle = oracle.oracle_config.pull_oracle;
      if (pullOracle) {
        const previous = byPullOracle.get(pullOracle);
        if (!previous || compareHealthData(oracle, previous) < 0) {
          byPullOracle.set(pullOracle, oracle);
        }
      }

      const secp256k1Key = oracle.oracle_config.secp256k1_pubkey;
      if (secp256k1Key) {
        const previous = bySecp256k1Key.get(secp256k1Key);
        if (!previous || compareHealthData(oracle, previous) < 0) {
          bySecp256k1Key.set(secp256k1Key, oracle);
        }
      }
    }
  }

  return {
    byPullOracle,
    bySecp256k1Key,
    majorityVersion:
      versionCandidates.length > 0
        ? computeMajorityVersion(versionCandidates)
        : null,
  };
}

function compareHealthData(
  left: OracleHealthData,
  right: OracleHealthData
): number {
  const leftScore = [
    left.active_connections ?? Number.MAX_SAFE_INTEGER,
    left.total_subscriptions ?? Number.MAX_SAFE_INTEGER,
    -(left.total_feeds ?? 0),
    -(left.priority_pairs_status
      ? uniqueCount(Object.keys(left.priority_pairs_status))
      : 0),
  ];
  const rightScore = [
    right.active_connections ?? Number.MAX_SAFE_INTEGER,
    right.total_subscriptions ?? Number.MAX_SAFE_INTEGER,
    -(right.total_feeds ?? 0),
    -(right.priority_pairs_status
      ? uniqueCount(Object.keys(right.priority_pairs_status))
      : 0),
  ];

  for (let i = 0; i < leftScore.length; i += 1) {
    if (leftScore[i] !== rightScore[i]) {
      return leftScore[i] - rightScore[i];
    }
  }

  return left.oracle_url.localeCompare(right.oracle_url);
}

export function createFallbackOracleInfo(
  oracle: OracleInfo
): RandomnessOracleSelectorCandidate {
  return {
    oracleId: oracle.signingAddress ?? oracle.secp256k1Key,
    gatewayUrl: oracle.gatewayUrl,
    version: oracle.version,
    isOnQueue: true,
    isVerified: true,
    heartbeatFresh: true,
    quoteFresh: true,
    liveHealthy: false,
    restricted: oracle.restricted,
    gatewayEnabled: oracle.gatewayUrl !== undefined,
    pullOracleEnabled: true,
  };
}
