import { Gateway } from '@switchboard-xyz/common/gateway';

import assert from 'node:assert/strict';
import { createServer } from 'node:http';

const bodies = [];
const server = createServer((request, response) => {
  const chunks = [];
  request.on('data', chunk => chunks.push(Buffer.from(chunk)));
  request.on('end', () => {
    bodies.push(JSON.parse(Buffer.concat(chunks).toString('utf8')));
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

await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const address = server.address();
assert.ok(address && typeof address === 'object');

try {
  const gateway = new Gateway(`http://127.0.0.1:${address.port}`);
  await gateway.fetchSignaturesConsensus({
    feedConfigs: [{ jobs: [], maxVariance: 1 }],
    numSignatures: 1,
  });
  await gateway.fetchSignaturesConsensus({
    feedConfigs: [{ jobs: [], maxVarianceScaled: 8_271_619 }],
    numSignatures: 1,
  });

  assert.equal(bodies[0].feed_requests[0].max_variance, 1_000_000_000);
  assert.equal(bodies[1].feed_requests[0].max_variance, 8_271_619);
} finally {
  await new Promise((resolve, reject) =>
    server.close(error => (error ? reject(error) : resolve()))
  );
}

console.log('Packed Common ESM variance transport probe passed');
