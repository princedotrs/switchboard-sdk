import assert from 'node:assert/strict';
import fs from 'node:fs';

const fixture = JSON.parse(
  fs.readFileSync(
    new URL('./feed-hash-conformance.json', import.meta.url),
    'utf8'
  )
);
const expectedHash = fixture.pythPush.expectedFeedHash;
const expectedBytesHex = fixture.pythPush.expectedLengthDelimitedHex;
const rejectedHashes = new Set(fixture.pythPush.rejectedFeedHashes);
const order = process.env.SWITCHBOARD_IMPORT_ORDER;

if (order === 'old-first') {
  await import('@switchboard-xyz/common-old');
} else if (order !== 'old-last') {
  throw new Error(`Unsupported SWITCHBOARD_IMPORT_ORDER: ${order}`);
}

const common = await import('@switchboard-xyz/common');
const { serializeOracleJob } = await import(
  '@switchboard-xyz/common/utils/oracle-job'
);
const computeIdentity = () => {
  const bytes = serializeOracleJob(fixture.pythPush.job);
  const hash = common.FeedHash.compute(
    Buffer.from(fixture.pythPush.queueHex, 'hex'),
    [fixture.pythPush.job]
  ).toString('hex');
  return { bytes, hash };
};

const before = computeIdentity();
await import('@switchboard-xyz/on-demand');
await import('@switchboard-xyz/common-legacy');
if (order === 'old-last') await import('@switchboard-xyz/common-old');
const after = computeIdentity();

for (const identity of [before, after]) {
  assert.equal(identity.bytes.length, 287);
  assert.equal(Buffer.from(identity.bytes).toString('hex'), expectedBytesHex);
  assert.equal(identity.hash, expectedHash);
  assert.ok(!rejectedHashes.has(identity.hash));
}
