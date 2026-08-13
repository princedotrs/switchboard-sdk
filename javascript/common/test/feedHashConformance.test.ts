import { FeedHash } from '../src/feed-hash.js';
import { encodeGatewayFeedRequests } from '../src/internal/gateway-feed-request.js';
import type { IOracleFeed, IOracleJob } from '../src/protos.js';
import {
  deserializeOracleJob,
  serializeOracleJob,
} from '../src/utils/oracle-job.js';
import { serializeOracleFeed } from '../src/utils/oracle-feed.js';

import { Buffer } from 'buffer';
import fs from 'node:fs';
import path from 'node:path';

type JobVector = {
  queueHex: string;
  job: IOracleJob;
  expectedLengthDelimitedHex: string;
  expectedLengthDelimitedBase64?: string;
  expectedFeedHash: string;
  rejectedFeedHashes?: string[];
};

type FeedVector = {
  jobFixture: 'pythPush';
  feed: Omit<IOracleFeed, 'jobs'>;
  expectedLengthDelimitedHex: string;
  expectedLengthDelimitedBase64: string;
  expectedFeedId: string;
};

type ConformanceVectors = {
  pythPush: JobVector;
  oracleFeedV2: FeedVector;
  legacyControl: JobVector;
};

const vectors = JSON.parse(
  fs.readFileSync(
    path.resolve(
      process.cwd(),
      '..',
      '..',
      'protos',
      'fixtures',
      'feed-hash-conformance.json'
    ),
    'utf8'
  )
) as ConformanceVectors;

describe('Rust-compatible feed-hash conformance', () => {
  it('serializes the Pyth push job exactly like prost 0.13', () => {
    const bytes = serializeOracleJob(vectors.pythPush.job);
    const hash = FeedHash.compute(
      Buffer.from(vectors.pythPush.queueHex, 'hex'),
      [vectors.pythPush.job]
    ).toString('hex');

    expect(bytes).toHaveLength(287);
    expect(bytes.toString('hex')).toBe(
      vectors.pythPush.expectedLengthDelimitedHex
    );
    expect(bytes.toString('base64')).toBe(
      vectors.pythPush.expectedLengthDelimitedBase64
    );
    expect(hash).toBe(vectors.pythPush.expectedFeedHash);
    expect(vectors.pythPush.rejectedFeedHashes).not.toContain(hash);
  });

  it('preserves explicit optional defaults in the canonical bytes', () => {
    const decoded = deserializeOracleJob(
      Buffer.from(vectors.pythPush.expectedLengthDelimitedHex, 'hex')
    ).toJSON() as IOracleJob;
    const medianJob = decoded.tasks?.[0]?.medianTask?.jobs;

    expect(
      medianJob?.[1]?.tasks?.[0]?.oracleTask?.pythConfigs?.pushFeedShardId
    ).toBe(0);
    expect(
      medianJob?.[2]?.tasks?.[1]?.divideTask?.job?.tasks?.[0]?.jupiterSwapTask
        ?.directRoutesOnly
    ).toBe(false);
  });

  it('uses the same canonical nested job for OracleFeed v2', () => {
    expect(vectors.oracleFeedV2.jobFixture).toBe('pythPush');
    const feed: IOracleFeed = {
      ...vectors.oracleFeedV2.feed,
      jobs: [vectors.pythPush.job],
    };
    const bytes = serializeOracleFeed(feed);

    expect(bytes.toString('hex')).toBe(
      vectors.oracleFeedV2.expectedLengthDelimitedHex
    );
    expect(bytes.toString('base64')).toBe(
      vectors.oracleFeedV2.expectedLengthDelimitedBase64
    );
    expect(FeedHash.computeOracleFeedId(feed).toString('hex')).toBe(
      vectors.oracleFeedV2.expectedFeedId
    );
  });

  it('sends canonical v1 and v2 base64 at the gateway boundary', () => {
    const [v1] = encodeGatewayFeedRequests(
      [
        {
          jobs: [vectors.pythPush.job],
          maxVariance: 1,
          minResponses: 2,
        },
      ],
      'v1'
    );
    const feed: IOracleFeed = {
      ...vectors.oracleFeedV2.feed,
      jobs: [vectors.pythPush.job],
    };
    const [v2] = encodeGatewayFeedRequests([{ feed }], 'v2');

    expect('jobs_b64_encoded' in v1 && v1.jobs_b64_encoded[0]).toBe(
      vectors.pythPush.expectedLengthDelimitedBase64
    );
    expect('feed_proto_b64' in v2 && v2.feed_proto_b64).toBe(
      vectors.oracleFeedV2.expectedLengthDelimitedBase64
    );
  });

  it('keeps the older control job identity unchanged', () => {
    const bytes = serializeOracleJob(vectors.legacyControl.job);
    const hash = FeedHash.compute(
      Buffer.from(vectors.legacyControl.queueHex, 'hex'),
      [vectors.legacyControl.job]
    ).toString('hex');

    expect(bytes.toString('hex')).toBe(
      vectors.legacyControl.expectedLengthDelimitedHex
    );
    expect(hash).toBe(vectors.legacyControl.expectedFeedHash);
  });
});
