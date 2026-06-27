import {
  mergeHealthyOracleSnapshots,
  selectRandomnessOracle,
  type HealthyOracleGatewaySnapshot,
} from '../src/randomness-selector.js';

describe('RandomnessOracleSelector', () => {
  test('prefers live healthy candidates before fallback candidates', () => {
    const selection = selectRandomnessOracle([
      {
        oracleId: 'fallback-oracle',
        gatewayUrl: 'https://fallback.gateway',
        version: 'v1',
        isOnQueue: true,
        isVerified: true,
        heartbeatFresh: true,
        quoteFresh: true,
        liveHealthy: false,
        lastHeartbeatUnix: 10,
        validUntilUnix: 10,
      },
      {
        oracleId: 'live-oracle',
        gatewayUrl: 'https://live.gateway',
        version: 'v2',
        isOnQueue: true,
        isVerified: true,
        heartbeatFresh: true,
        quoteFresh: true,
        liveHealthy: true,
        activeConnections: 1,
        totalSubscriptions: 1,
        totalFeeds: 50,
        lastHeartbeatUnix: 20,
        validUntilUnix: 20,
      },
    ]);

    expect(selection.candidate.oracleId).toBe('live-oracle');
    expect(selection.metadata.tier).toBe('live');
    expect(selection.metadata.liveHealthyCandidateCount).toBe(1);
  });

  test('falls back to verified non-stale gateway-bearing candidates', () => {
    const selection = selectRandomnessOracle([
      {
        oracleId: 'stale-oracle',
        gatewayUrl: 'https://stale.gateway',
        version: 'v1',
        isOnQueue: true,
        isVerified: true,
        heartbeatFresh: false,
        quoteFresh: true,
        liveHealthy: false,
      },
      {
        oracleId: 'fallback-oracle',
        gatewayUrl: 'https://fallback.gateway',
        version: 'v2',
        isOnQueue: true,
        isVerified: true,
        heartbeatFresh: true,
        quoteFresh: true,
        liveHealthy: false,
        lastHeartbeatUnix: 30,
        validUntilUnix: 40,
      },
    ]);

    expect(selection.candidate.oracleId).toBe('fallback-oracle');
    expect(selection.metadata.tier).toBe('fallback');
  });

  test('rejects candidates missing required safety properties', () => {
    expect(() =>
      selectRandomnessOracle([
        {
          oracleId: 'missing-gateway',
          gatewayUrl: null,
          version: 'v1',
          isOnQueue: true,
          isVerified: true,
          heartbeatFresh: true,
          quoteFresh: true,
          liveHealthy: true,
        },
      ])
    ).toThrow('No eligible randomness oracle candidates were found');
  });

  test('merges healthy oracle snapshots by pull oracle and secp256k1 key', () => {
    const snapshots: HealthyOracleGatewaySnapshot[] = [
      {
        gatewayUrl: 'https://gateway-a',
        response: {
          count: 1,
          oracles: [
            {
              oracle_url: 'https://oracle-a',
              active_connections: 5,
              unique_ips: 1,
              total_subscriptions: 10,
              active_monitors: 2,
              total_symbols: 20,
              total_feeds: 30,
              oracle_config: {
                pull_oracle: 'pull-a',
                secp256k1_pubkey: 'secp-a',
                version: 'rc-1',
              },
            },
          ],
        },
      },
      {
        gatewayUrl: 'https://gateway-b',
        response: {
          count: 1,
          oracles: [
            {
              oracle_url: 'https://oracle-a',
              active_connections: 1,
              unique_ips: 1,
              total_subscriptions: 5,
              active_monitors: 2,
              total_symbols: 20,
              total_feeds: 40,
              oracle_config: {
                pull_oracle: 'pull-a',
                secp256k1_pubkey: 'secp-a',
                version: 'rc-1',
              },
            },
          ],
        },
      },
    ];

    const merged = mergeHealthyOracleSnapshots(snapshots);

    expect(merged.byPullOracle.get('pull-a')?.active_connections).toBe(1);
    expect(merged.bySecp256k1Key.get('secp-a')?.total_feeds).toBe(40);
    expect(merged.majorityVersion).toBe('rc-1');
  });
});
