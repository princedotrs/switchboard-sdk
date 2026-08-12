import assert from 'node:assert/strict';
import test from 'node:test';

import { Queue } from '../src/queue/index.ts';

const VALID_SIGNER = '11'.repeat(64);
const VALID_MEASUREMENT = '22'.repeat(32);

test('loadData keeps the queue parent fixed while paginating dynamic fields', async () => {
  const queueId = `0x${'a'.repeat(64)}`;
  const dynamicFieldParent = `0x${'b'.repeat(64)}`;
  const oracleIds = [`0x${'c'.repeat(64)}`, `0x${'d'.repeat(64)}`];
  const dynamicFieldCalls: Array<{
    parentId: string;
    cursor?: string | null;
  }> = [];

  const moveObject = (fields: Record<string, unknown>) => ({
    data: {
      content: {
        dataType: 'moveObject',
        fields,
      },
    },
  });

  const queue = new Queue(
    {
      client: {
        getObject: async () =>
          moveObject({
            authority: queueId,
            existing_oracles: {
              fields: { id: { id: dynamicFieldParent } },
            },
            fee: '0',
            fee_recipient: queueId,
            fee_types: [],
            guardian_queue_id: queueId,
            id: { id: queueId },
            last_queue_override_ms: '0',
            min_attestations: '1',
            name: 'test queue',
            oracle_validity_length_ms: '60000',
            queue_key: new Array(32).fill(1),
          }),
        getDynamicFields: async (request: {
          parentId: string;
          cursor?: string | null;
        }) => {
          dynamicFieldCalls.push(request);
          return request.cursor
            ? {
                data: [{ objectId: 'dynamic-field-2' }],
                hasNextPage: false,
                nextCursor: null,
              }
            : {
                data: [{ objectId: 'dynamic-field-1' }],
                hasNextPage: true,
                nextCursor: 'cursor-2',
              };
        },
        multiGetObjects: async () =>
          oracleIds.map((oracleId, index) =>
            moveObject({
              value: {
                fields: {
                  oracle_id: oracleId,
                  oracle_key: new Array(32).fill(index + 1),
                },
              },
            })
          ),
      },
    } as any,
    queueId
  );

  const result = await queue.loadData();

  assert.deepEqual(dynamicFieldCalls, [
    { parentId: dynamicFieldParent, cursor: undefined },
    { parentId: dynamicFieldParent, cursor: 'cursor-2' },
  ]);
  assert.deepEqual(
    result.existingOracles.map(oracle => oracle.oracleId),
    oracleIds
  );
});

for (const [name, values, expectedMessage] of [
  [
    'short signer',
    { secp256k1Key: '11'.repeat(63), mrEnclave: VALID_MEASUREMENT },
    'secp256k1Key must be a 64-byte hex value',
  ],
  [
    'zero signer',
    { secp256k1Key: '00'.repeat(64), mrEnclave: VALID_MEASUREMENT },
    'secp256k1Key must not be all zero',
  ],
  [
    'short measurement',
    { secp256k1Key: VALID_SIGNER, mrEnclave: '22'.repeat(31) },
    'mrEnclave must be a 32-byte hex value',
  ],
  [
    'zero measurement',
    { secp256k1Key: VALID_SIGNER, mrEnclave: '00'.repeat(32) },
    'mrEnclave must not be all zero',
  ],
] as const) {
  test(`overrideOracleTx rejects ${name} before transaction construction`, async () => {
    let stateFetches = 0;
    let moveCalls = 0;
    const queue = new Queue(
      {
        fetchState: async () => {
          stateFetches++;
          return { switchboardAddress: `0x${'a'.repeat(64)}` };
        },
      } as any,
      `0x${'b'.repeat(64)}`
    );

    await assert.rejects(
      queue.overrideOracleTx(
        {
          moveCall: () => {
            moveCalls++;
          },
        } as any,
        {
          oracle: `0x${'c'.repeat(64)}`,
          expirationTimeMs: Date.now() + 60_000,
          ...values,
        }
      ),
      new RegExp(expectedMessage)
    );

    assert.equal(stateFetches, 0);
    assert.equal(moveCalls, 0);
  });
}
