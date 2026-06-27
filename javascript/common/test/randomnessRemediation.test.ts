import {
  buildCurrentSelectionSummary,
  determineRandomnessRemediation,
  summarizeRandomnessOracleCandidate,
} from '../src/randomness-remediation.js';

describe('RandomnessRemediation', () => {
  test('returns none when randomness is already resolved', () => {
    expect(
      determineRandomnessRemediation({
        family: 'solana',
        committed: true,
        ready: true,
        resolved: true,
        assignedOracleId: 'oracle-a',
        selectedOracleId: 'oracle-a',
        assignedOracleEligible: true,
      })
    ).toEqual({
      action: 'none',
      reason: 'Randomness is already settled or revealed.',
    });
  });

  test('recommends recreate for non-EVM requests when healthy selection changes', () => {
    expect(
      determineRandomnessRemediation({
        family: 'starknet',
        committed: true,
        ready: true,
        resolved: false,
        assignedOracleId: 'oracle-a',
        selectedOracleId: 'oracle-b',
        assignedOracleEligible: true,
      }).action
    ).toBe('recreate');
  });

  test('recommends reroll for EVM requests when healthy selection changes', () => {
    expect(
      determineRandomnessRemediation({
        family: 'evm',
        committed: true,
        ready: true,
        resolved: false,
        assignedOracleId: '0xoracle-a',
        selectedOracleId: '0xoracle-b',
        assignedOracleEligible: true,
      }).action
    ).toBe('reroll');
  });

  test('summarizes candidate eligibility and current selection metadata', () => {
    const candidate = {
      oracleId: 'oracle-a',
      gatewayUrl: 'https://gateway-a',
      version: 'rc-1',
      isOnQueue: true,
      isVerified: true,
      heartbeatFresh: true,
      quoteFresh: true,
      liveHealthy: true,
      activeConnections: 1,
      totalSubscriptions: 2,
      totalFeeds: 3,
    };
    const metadata = {
      tier: 'live' as const,
      majorityVersion: 'rc-1',
      liveHealthyCandidateCount: 1,
      fallbackCandidateCount: 1,
      evaluations: [
        {
          oracleId: 'oracle-a',
          tier: 'live' as const,
          version: 'rc-1',
          rejectionReasons: [],
          liveHealthy: true,
        },
      ],
    };

    expect(summarizeRandomnessOracleCandidate(candidate, metadata)).toMatchObject(
      {
        oracleId: 'oracle-a',
        gatewayUrl: 'https://gateway-a',
        isEligible: true,
        liveHealthy: true,
      }
    );
    expect(
      buildCurrentSelectionSummary({
        assignedOracleId: 'oracle-a',
        metadata,
        selectedOracleId: 'oracle-a',
      })
    ).toMatchObject({
      oracleId: 'oracle-a',
      matchesAssignedOracle: true,
      tier: 'live',
    });
  });
});
