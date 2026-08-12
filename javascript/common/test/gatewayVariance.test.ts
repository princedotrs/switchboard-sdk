import { Gateway } from '../src/gateway.js';
import type { FeedRequestV1 } from '../src/types/gateway.js';

import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';

type GatewayRequestBody = {
  feed_requests: Array<{
    max_variance: number;
  }>;
};

describe('Gateway v1 variance encoding', () => {
  it('preserves legacy percent inputs and exact scaled inputs at the HTTP boundary', async () => {
    const bodies: GatewayRequestBody[] = [];
    const server = createServer((request, response) => {
      const chunks: Buffer[] = [];
      request.on('data', chunk => chunks.push(Buffer.from(chunk)));
      request.on('end', () => {
        bodies.push(
          JSON.parse(Buffer.concat(chunks).toString('utf8')) as GatewayRequestBody
        );
        response.writeHead(200, { 'Content-Type': 'application/json' });
        response.end(
          JSON.stringify({
            oracle_responses: [],
            median_responses: [],
            slot: 0,
          })
        );
      });
    });

    await new Promise<void>(resolve =>
      server.listen(0, '127.0.0.1', resolve)
    );
    const { port } = server.address() as AddressInfo;
    const gateway = new Gateway(`http://127.0.0.1:${port}`);

    const request = async (config: FeedRequestV1): Promise<number> => {
      await gateway.fetchSignaturesConsensus({
        feedConfigs: [config],
        numSignatures: 1,
      });
      return bodies.at(-1)?.feed_requests[0]?.max_variance as number;
    };

    try {
      await expect(request({ jobs: [] })).resolves.toBe(1_000_000_000);
      await expect(
        request({ jobs: [], maxVariance: 0 })
      ).resolves.toBe(0);
      await expect(
        request({ jobs: [], maxVariance: 1 })
      ).resolves.toBe(1_000_000_000);
      await expect(
        request({ jobs: [], maxVariance: 0.008271619 })
      ).resolves.toBe(
        Math.floor(Number(0.008271619) * 1_000_000_000)
      );

      for (const maxVarianceScaled of [
        0,
        8_271_619,
        1_234_567_891,
        Number.MAX_SAFE_INTEGER,
      ]) {
        await expect(
          request({ jobs: [], maxVarianceScaled })
        ).resolves.toBe(maxVarianceScaled);
      }

      const validRequestCount = bodies.length;
      for (const maxVarianceScaled of [
        -1,
        1.5,
        Number.NaN,
        Number.POSITIVE_INFINITY,
        Number.MAX_SAFE_INTEGER + 1,
      ]) {
        await expect(
          request({ jobs: [], maxVarianceScaled })
        ).rejects.toThrow(/non-negative safe integer/);
      }
      await expect(
        request({
          jobs: [],
          maxVariance: 1,
          maxVarianceScaled: 1_000_000_000,
        })
      ).rejects.toThrow(/only one of maxVariance or maxVarianceScaled/);
      assert.equal(
        bodies.length,
        validRequestCount,
        'invalid variance requests must fail before network activity'
      );
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close(error => (error ? reject(error) : resolve()))
      );
    }
  });
});
