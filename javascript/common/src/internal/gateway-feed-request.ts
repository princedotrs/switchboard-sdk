import type { FeedRequest, FeedRequestV1 } from '../types/gateway.js';
import { serializeOracleFeed } from '../utils/oracle-feed.js';
import { serializeOracleJob } from '../utils/oracle-job.js';

export type EncodedGatewayFeedRequest =
  | {
      jobs_b64_encoded: string[];
      max_variance: number;
      min_responses: number;
    }
  | {
      feed_proto_b64: string;
    };

function encodeV1MaxVariance(config: FeedRequestV1): number {
  const hasHumanVariance = config.maxVariance !== undefined;

  if (hasHumanVariance && config.maxVarianceScaled !== undefined) {
    throw new Error(
      'FeedRequestV1 must specify only one of maxVariance or maxVarianceScaled'
    );
  }

  if (config.maxVarianceScaled !== undefined) {
    const scaledVariance = config.maxVarianceScaled;
    if (!Number.isSafeInteger(scaledVariance) || scaledVariance < 0) {
      throw new Error(
        'FeedRequestV1 maxVarianceScaled must be a non-negative safe integer'
      );
    }
    return scaledVariance;
  }

  return Math.floor(Number(config.maxVariance ?? 1) * 1e9);
}

/**
 * Build the protobuf payloads sent to a gateway.
 *
 * This module is intentionally not exported from the package entrypoint. It
 * exists so the transport boundary and conformance tests share the exact
 * production serializer path.
 */
export function encodeGatewayFeedRequests(
  feedConfigs: FeedRequest[],
  version: 'v1' | 'v2'
): EncodedGatewayFeedRequest[] {
  if (version === 'v1') {
    return feedConfigs.map(config => {
      if (!('jobs' in config)) {
        throw new Error('Expected a v1 feed request');
      }
      return {
        jobs_b64_encoded: config.jobs.map(job =>
          serializeOracleJob(job).toString('base64')
        ),
        max_variance: encodeV1MaxVariance(config),
        min_responses: config.minResponses ?? 1,
      };
    });
  }

  return feedConfigs.map(config => {
    if (!('feed' in config)) {
      throw new Error('Expected a v2 feed request');
    }
    return {
      feed_proto_b64: serializeOracleFeed(config.feed).toString('base64'),
    };
  });
}
