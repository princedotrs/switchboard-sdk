import assert from 'node:assert/strict';
import test from 'node:test';

import { SUI_TYPE_ARG } from '@mysten/sui/utils';

import type { QueueData } from '../src/index.ts';
import { suiQueueCache } from '../src/index.ts';
import { Queue } from '../src/queue/index.ts';
import {
  convertSurgeUpdateToQuotes,
  Quote,
  suiOracleMappingCache,
  type SurgeRawGatewayResponse,
} from '../src/quote/index.ts';

const QUEUE_ID = '0xqueue';
const SWITCHBOARD_ADDRESS = '0xswitchboard';
const FEED_HASH = `0x${'11'.repeat(32)}`;
const ORACLE_ID = '0xoracle';
const SUI_COIN_TYPE = `0x2::coin::Coin<${SUI_TYPE_ARG}>`;

function createQueueData(overrides?: Partial<QueueData>): QueueData {
  return {
    authority: '0xauthority',
    existingOracles: [],
    fee: 0,
    feeRecipient: '0xrecipient',
    feeTypes: [SUI_COIN_TYPE],
    guardianQueueId: '0xguardian',
    id: QUEUE_ID,
    lastQueueOverrideMs: 0,
    minAttestations: 1,
    name: 'Quote Queue',
    oracleValidityLengthMs: 60_000,
    queueKey: '0xkey',
    ...overrides,
  };
}

function createMockClient() {
  return {
    fetchState: async () => ({
      guardianQueueId: '0xguardian',
      mainnet: true,
      oracleQueueId: QUEUE_ID,
      switchboardAddress: SWITCHBOARD_ADDRESS,
    }),
  } as any;
}

function createMockTransaction() {
  const moveCalls: any[] = [];
  const splitCalls: Array<{ amounts: unknown[]; coin: unknown }> = [];
  let splitIndex = 0;

  const tx = {
    gas: { $kind: 'GasCoin', GasCoin: true },
    object: (value: unknown) =>
      typeof value === 'string'
        ? { $kind: 'Input', Input: value, type: 'object' }
        : value,
    pure: {
      u64: (value: unknown) => ({
        $kind: 'Input',
        Input: value,
        type: 'pure',
      }),
      vector: (_type: string, value: unknown) => ({
        $kind: 'Input',
        Input: value,
        type: 'pure',
      }),
    },
    moveCall: (input: any) => {
      moveCalls.push(input);
      return { $kind: 'Result', Result: moveCalls.length - 1 };
    },
    splitCoins: (coin: unknown, amounts: unknown[]) => {
      splitCalls.push({ amounts, coin });
      const commandIndex = splitIndex++;
      return amounts.map((_, nestedIndex) => ({
        $kind: 'NestedResult',
        NestedResult: [commandIndex, nestedIndex] as [number, number],
      }));
    },
  };

  return {
    moveCalls,
    splitCalls,
    tx: tx as any,
  };
}

function createV2UpdateResponse() {
  return {
    oracleResponses: [
      {
        feedResponses: [
          {
            feed_hash: FEED_HASH,
            min_oracle_samples: 1,
            success_value: '42',
          },
        ],
        oracleId: ORACLE_ID,
        signature: '0x01020304',
      },
    ],
    queue: QUEUE_ID,
    slot: 7,
    timestamp: 9,
  } as any;
}

function createSurgeUpdate(): SurgeRawGatewayResponse {
  return {
    feed_values: [
      {
        feed_hash: FEED_HASH,
        value: '42',
      },
    ],
    message: '',
    oracle_response: {
      checksum: '',
      eth_address: '',
      oracle_idx: 0,
      oracle_pubkey: '1234',
      recent_hash: '',
      recovery_id: 1,
      signature: Buffer.from('01020304', 'hex').toString('base64'),
      slot: 7,
      timestamp: 9,
    },
    seen_at_ts_ms: 0,
    source_ts_ms: 0,
    triggered_on_price_change: false,
    type: 'surge',
  };
}

function resetCaches() {
  suiQueueCache.clear();
  suiOracleMappingCache.clear();
}

test('fetchUpdateQuote uses legacy run_n when queue fee is zero', async () => {
  resetCaches();
  suiQueueCache.set(QUEUE_ID, createQueueData({ fee: 0 }));

  const client = createMockClient();
  const { moveCalls, splitCalls, tx } = createMockTransaction();

  await Quote.fetchUpdateQuote(client, tx, {
    crossbarClient: {
      fetchV2Update: async () => createV2UpdateResponse(),
    } as any,
    feedHashes: [FEED_HASH],
  });

  assert.equal(splitCalls.length, 0);
  assert.equal(moveCalls.length, 1);
  assert.equal(
    moveCalls[0].target,
    `${SWITCHBOARD_ADDRESS}::quote_submit_action::run_1`
  );
  assert.equal(moveCalls[0].typeArguments, undefined);
});

test('fetchUpdateQuote splits gas and uses run_n_with_fee when SUI fees are enabled', async () => {
  resetCaches();
  suiQueueCache.set(QUEUE_ID, createQueueData({ fee: 7 }));

  const client = createMockClient();
  const { moveCalls, splitCalls, tx } = createMockTransaction();

  await Quote.fetchUpdateQuote(client, tx, {
    crossbarClient: {
      fetchV2Update: async () => createV2UpdateResponse(),
    } as any,
    feedHashes: [FEED_HASH],
  });

  assert.equal(splitCalls.length, 1);
  assert.deepEqual(splitCalls[0].amounts, [7]);
  assert.equal(
    moveCalls[0].target,
    `${SWITCHBOARD_ADDRESS}::quote_submit_action::run_1_with_fee`
  );
  assert.deepEqual(moveCalls[0].typeArguments, [SUI_TYPE_ARG]);
  assert.equal(moveCalls[0].arguments.length, 11);
});

test('fetchUpdateQuote rejects non-SUI paid queues without caller supplied fee objects', async () => {
  resetCaches();
  suiQueueCache.set(
    QUEUE_ID,
    createQueueData({
      fee: 7,
      feeTypes: ['0x2::coin::Coin<0xabc::usd::USD>'],
    })
  );

  const client = createMockClient();
  const { tx } = createMockTransaction();

  await assert.rejects(
    Quote.fetchUpdateQuote(client, tx, {
      crossbarClient: {
        fetchV2Update: async () => createV2UpdateResponse(),
      } as any,
      feedHashes: [FEED_HASH],
    }),
    /requires a non-SUI fee coin/i
  );
});

test('convertSurgeUpdateToQuotes uses the paid path when SUI fees are enabled', async () => {
  resetCaches();
  suiQueueCache.set(QUEUE_ID, createQueueData({ fee: 5 }));
  suiOracleMappingCache.set('0x1234', ORACLE_ID);

  const originalDateNow = Date.now;
  Date.now = () => 1;

  try {
    const client = createMockClient();
    const { moveCalls, splitCalls, tx } = createMockTransaction();

    await convertSurgeUpdateToQuotes(client, tx, createSurgeUpdate());

    assert.equal(splitCalls.length, 1);
    assert.deepEqual(splitCalls[0].amounts, [5]);
    assert.equal(
      moveCalls[0].target,
      `${SWITCHBOARD_ADDRESS}::quote_submit_action::run_1_with_fee`
    );
    assert.deepEqual(moveCalls[0].typeArguments, [SUI_TYPE_ARG]);
  } finally {
    Date.now = originalDateNow;
  }
});

test('queue fee type parsing normalizes padded type names from chain responses', async () => {
  const queue = new Queue(
    {
      client: {
        getDynamicFields: async () => ({
          data: [],
          hasNextPage: false,
        }),
        getObject: async () => ({
          data: {
            content: {
              dataType: 'moveObject',
              fields: {
                authority: '0xauthority',
                existing_oracles: {
                  fields: {
                    id: {
                      id: '0xtable',
                    },
                    size: '0',
                  },
                },
                fee: '7',
                fee_recipient: '0xrecipient',
                fee_types: [
                  {
                    fields: {
                      name: '0000000000000000000000000000000000000000000000000000000000000002::coin::Coin<0000000000000000000000000000000000000000000000000000000000000002::sui::SUI>',
                    },
                    type: '0x1::type_name::TypeName',
                  },
                ],
                guardian_queue_id: '0xguardian',
                id: {
                  id: QUEUE_ID,
                },
                last_queue_override_ms: '0',
                min_attestations: '1',
                name: 'Quote Queue',
                oracle_validity_length_ms: '60000',
                queue_key: [1, 2, 3],
                version: 1,
              },
              hasPublicTransfer: false,
              type: '0xqueue::Queue',
            },
          },
        }),
        multiGetObjects: async () => [],
      },
    } as any,
    QUEUE_ID
  );

  const data = await queue.loadData();
  assert.deepEqual(data.feeTypes, [SUI_COIN_TYPE]);
});
