'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const fixture = JSON.parse(
  fs.readFileSync(path.join(__dirname, 'feed-hash-conformance.json'), 'utf8')
);
const expectedHash = fixture.pythPush.expectedFeedHash;
const expectedBytesHex = fixture.pythPush.expectedLengthDelimitedHex;
const rejectedHashes = new Set(fixture.pythPush.rejectedFeedHashes);
const order = process.env.SWITCHBOARD_IMPORT_ORDER;

if (order === 'old-first') {
  require('@switchboard-xyz/common-old');
} else if (order !== 'old-last') {
  throw new Error(`Unsupported SWITCHBOARD_IMPORT_ORDER: ${order}`);
}

const common = require('@switchboard-xyz/common');
const {
  serializeOracleJob,
} = require('@switchboard-xyz/common/utils/oracle-job');
const computeIdentity = () => {
  const bytes = serializeOracleJob(fixture.pythPush.job);
  const hash = common.FeedHash.compute(
    Buffer.from(fixture.pythPush.queueHex, 'hex'),
    [fixture.pythPush.job]
  ).toString('hex');
  return { bytes, hash };
};

const before = computeIdentity();
require('@switchboard-xyz/on-demand');
require('@switchboard-xyz/common-legacy');
if (order === 'old-last') require('@switchboard-xyz/common-old');
const after = computeIdentity();

for (const identity of [before, after]) {
  assert.equal(identity.bytes.length, 287);
  assert.equal(Buffer.from(identity.bytes).toString('hex'), expectedBytesHex);
  assert.equal(identity.hash, expectedHash);
  assert.ok(!rejectedHashes.has(identity.hash));
}
