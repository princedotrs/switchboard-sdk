import assert from 'node:assert/strict';
import test from 'node:test';

import { Aggregator } from '../src/aggregator/index.ts';
import { Oracle } from '../src/oracle/index.ts';
import { Queue } from '../src/queue/index.ts';

const AGGREGATOR_ID = `0x${'a'.repeat(64)}`;
const ORACLE_ID = `0x${'b'.repeat(64)}`;
const QUEUE_ID = `0x${'c'.repeat(64)}`;
const SWITCHBOARD_ID = `0x${'d'.repeat(64)}`;

function transactionValueHelpers() {
  return {
    object: (value: unknown) => value,
    pure: {
      bool: (value: unknown) => value,
      u64: (value: unknown) => value,
      u128: (value: unknown) => value,
      vector: (_type: string, value: unknown) => value,
    },
  };
}

function validOracleData(oracleId = ORACLE_ID) {
  return {
    expirationTime: Date.now() + 60_000,
    id: oracleId,
    mrEnclave: '22'.repeat(32),
    oracleKey: 'oracle-key',
    queue: QUEUE_ID,
    queueKey: 'queue-key',
    secp256k1Key: '11'.repeat(64),
    validAttestations: [],
  } as any;
}

test('fetchManyUpdateTx preserves the empty-request validation', async () => {
  let splitCount = 0;
  let moveCallCount = 0;

  await assert.rejects(
    Aggregator.fetchManyUpdateTx({} as any, [], {
      splitCoins: () => {
        splitCount++;
        return [];
      },
      moveCall: () => {
        moveCallCount++;
      },
    } as any),
    /At least one aggregator ID is required/
  );

  assert.equal(splitCount, 0);
  assert.equal(moveCallCount, 0);
});

test('fetchManyUpdateTx forwards variable overrides through retries', async () => {
  const variableOverrides = { PYTH_API_KEY: 'request-scoped-test-key' };
  const calls: Array<{
    aggregatorIds: string[];
    network: string;
    options: Record<string, unknown> | undefined;
  }> = [];
  const originalFetchUpdateForMultiple = Aggregator.fetchUpdateForMultiple;
  const originalLoadData = Aggregator.prototype.loadData;
  const originalLoadQueueData = Queue.prototype.loadData;
  const originalLoadOracleData = Oracle.prototype.loadData;
  const splitCalls: unknown[][] = [];
  const moveCalls: unknown[] = [];

  Aggregator.fetchUpdateForMultiple = async (
    network,
    aggregatorIds,
    options
  ) => {
    calls.push({
      aggregatorIds,
      network,
      options: options as Record<string, unknown> | undefined,
    });

    if (calls.length === 1) {
      return {
        responses: [
          {
            fee: 0,
            feedConfigs: { feedHash: '0xfeed' },
            results: [{ signature: '00', successValue: '' }],
          } as any,
        ],
        failures: ['initial failure'],
      };
    }

    return {
      responses: [
        {
          fee: 0,
          feedConfigs: { feedHash: '0xfeed' },
          results: [
            {
              signature: '11',
              successValue: '1',
              oracleId: ORACLE_ID,
              isNegative: false,
              timestamp: 1,
            },
          ],
        } as any,
      ],
      failures: [],
    };
  };
  Aggregator.prototype.loadData = async function () {
    return { feedHash: 'feed', id: this.address, minSampleSize: 1 } as any;
  };
  Queue.prototype.loadData = async () =>
    ({ existingOracles: [{ oracleId: ORACLE_ID }] }) as any;
  Oracle.prototype.loadData = async () => validOracleData();

  try {
    const result = await Aggregator.fetchManyUpdateTx(
      {
        state: {
          mainnet: true,
          oracleQueueId: QUEUE_ID,
          switchboardAddress: SWITCHBOARD_ID,
        },
      } as any,
      [AGGREGATOR_ID],
      {
        ...transactionValueHelpers(),
        gas: {},
        splitCoins: (_coin: unknown, amounts: unknown[]) => {
          splitCalls.push(amounts);
          return amounts.map(() => ({}));
        },
        moveCall: (call: unknown) => moveCalls.push(call),
      } as any,
      {
        maxRetries: 1,
        variableOverrides,
      }
    );

    assert.equal(calls.length, 2);
    assert.deepEqual(calls[0], {
      aggregatorIds: [AGGREGATOR_ID],
      network: 'mainnet',
      options: {
        minResponsesRequired: 1,
        maxRetries: 0,
        variableOverrides,
      },
    });
    assert.deepEqual(calls[1], {
      aggregatorIds: [AGGREGATOR_ID],
      network: 'mainnet',
      options: {
        maxRetries: 0,
        minResponsesRequired: 1,
        variableOverrides,
      },
    });
    assert.deepEqual(result.failures, ['initial failure']);
    assert.deepEqual(splitCalls, [[0]]);
    assert.equal(moveCalls.length, 1);
  } finally {
    Aggregator.fetchUpdateForMultiple = originalFetchUpdateForMultiple;
    Aggregator.prototype.loadData = originalLoadData;
    Queue.prototype.loadData = originalLoadQueueData;
    Oracle.prototype.loadData = originalLoadOracleData;
  }
});

test('fetchUpdateForMultiple forwards variable overrides on every attempt', async () => {
  const variableOverrides = { PYTH_API_KEY: 'request-scoped-test-key' };
  const requests: Array<{ input: string; init?: RequestInit }> = [];
  let attempt = 0;
  const originalFetch = globalThis.fetch;

  const crossbarClient = {
    crossbarUrl: 'https://crossbar.example',
    fetchSuiUpdates: async () => {
      throw new Error('legacy GET path should not be used');
    },
  } as any;

  globalThis.fetch = (async (
    input: string | URL | Request,
    init?: RequestInit
  ) => {
    requests.push({ input: input.toString(), init });
    attempt += 1;
    return {
      ok: true,
      status: 200,
      json: async () =>
        attempt === 1
          ? { responses: [], failures: ['retry'] }
          : { responses: [{}, {}], failures: [] },
    } as Response;
  }) as typeof fetch;

  try {
    const result = await Aggregator.fetchUpdateForMultiple(
      'mainnet',
      ['0xfeed'],
      {
        crossbarClient,
        maxRetries: 1,
        minResponsesRequired: 2,
        retryDelayMs: 0,
        variableOverrides,
      }
    );

    assert.equal(result.responses.length, 2);
    assert.equal(requests.length, 2);
    for (const request of requests) {
      assert.equal(
        request.input,
        'https://crossbar.example/updates/sui/mainnet/0xfeed'
      );
      assert.equal(request.init?.method, 'POST');
      assert.deepEqual(JSON.parse(request.init?.body as string), {
        variableOverrides,
      });
      assert.equal(
        request.input.includes(variableOverrides.PYTH_API_KEY),
        false
      );
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('fetchUpdateForMultiple keeps the legacy Crossbar path without overrides', async () => {
  const calls: Array<{ network: string; aggregatorIds: string[] }> = [];
  const crossbarClient = {
    crossbarUrl: 'https://crossbar.example',
    fetchSuiUpdates: async (network: string, aggregatorIds: string[]) => {
      calls.push({ network, aggregatorIds });
      return { responses: [{}], failures: [] };
    },
  } as any;

  const result = await Aggregator.fetchUpdateForMultiple(
    'testnet',
    ['0xfeed'],
    {
      crossbarClient,
      maxRetries: 0,
      variableOverrides: {},
    }
  );

  assert.equal(result.responses.length, 1);
  assert.deepEqual(calls, [{ network: 'testnet', aggregatorIds: ['0xfeed'] }]);
});

test('Crossbar errors do not expose variable override values', async () => {
  const secret = 'request-scoped-test-key';
  const originalFetch = globalThis.fetch;

  globalThis.fetch = (async () =>
    ({
      ok: false,
      status: 502,
      text: async () => {
        throw new Error('response body should not be read');
      },
    }) as Response) as typeof fetch;

  try {
    await assert.rejects(
      Aggregator.fetchUpdateForMultiple('mainnet', ['0xfeed'], {
        crossbarClient: {
          crossbarUrl: 'https://crossbar.example',
        } as any,
        maxRetries: 0,
        variableOverrides: { PYTH_API_KEY: secret },
      }),
      error => error instanceof Error && !error.message.includes(secret)
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('invalid oracle mappings cannot contribute fees or move calls', async () => {
  const invalidOracleId = `0x${'e'.repeat(64)}`;
  const originalFetchUpdateForMultiple = Aggregator.fetchUpdateForMultiple;
  const originalLoadData = Aggregator.prototype.loadData;
  const originalLoadQueueData = Queue.prototype.loadData;
  const originalLoadOracleData = Oracle.prototype.loadData;
  const splitCalls: unknown[][] = [];
  const moveCalls: unknown[] = [];
  const objectCalls: unknown[] = [];

  Aggregator.fetchUpdateForMultiple = async () => ({
    responses: [
      {
        fee: 7,
        feedConfigs: { feedHash: '0xfeed' },
        results: [
          {
            signature: '11',
            successValue: '1',
            oracleId: invalidOracleId,
            isNegative: false,
            timestamp: 1,
          },
          {
            signature: '22',
            successValue: '2',
            oracleId: ORACLE_ID,
            isNegative: false,
            timestamp: 1,
          },
        ],
      } as any,
    ],
    failures: [],
  });
  Aggregator.prototype.loadData = async function () {
    return { feedHash: 'feed', id: this.address, minSampleSize: 1 } as any;
  };
  Queue.prototype.loadData = async () =>
    ({
      existingOracles: [{ oracleId: invalidOracleId }, { oracleId: ORACLE_ID }],
    }) as any;
  Oracle.prototype.loadData = async function () {
    if (this.address === invalidOracleId) {
      return {
        ...validOracleData(invalidOracleId),
        secp256k1Key: '00'.repeat(64),
      };
    }
    return validOracleData();
  };

  try {
    const result = await Aggregator.fetchManyUpdateTx(
      {
        state: {
          mainnet: false,
          oracleQueueId: QUEUE_ID,
          switchboardAddress: SWITCHBOARD_ID,
        },
      } as any,
      [AGGREGATOR_ID],
      {
        ...transactionValueHelpers(),
        gas: {},
        object: (value: unknown) => {
          objectCalls.push(value);
          return value;
        },
        splitCoins: (_coin: unknown, amounts: unknown[]) => {
          splitCalls.push(amounts);
          return amounts.map(() => ({}));
        },
        moveCall: (call: unknown) => moveCalls.push(call),
      } as any,
      { maxRetries: 0 }
    );

    assert.deepEqual(splitCalls, [[7]]);
    assert.equal(moveCalls.length, 1);
    assert.equal(objectCalls.includes(invalidOracleId), false);
    assert.equal(objectCalls.includes(ORACLE_ID), true);
    assert.equal(result.responses.length, 1);
    assert.deepEqual(
      result.responses[0].results.map(result => result.oracleId),
      [ORACLE_ID]
    );
  } finally {
    Aggregator.fetchUpdateForMultiple = originalFetchUpdateForMultiple;
    Aggregator.prototype.loadData = originalLoadData;
    Queue.prototype.loadData = originalLoadQueueData;
    Oracle.prototype.loadData = originalLoadOracleData;
  }
});

test('retries replace a rejected oracle mapping', async () => {
  const replacementOracleId = `0x${'f'.repeat(64)}`;
  const originalFetchUpdateForMultiple = Aggregator.fetchUpdateForMultiple;
  const originalLoadData = Aggregator.prototype.loadData;
  const originalLoadQueueData = Queue.prototype.loadData;
  const originalLoadOracleData = Oracle.prototype.loadData;
  const splitCalls: unknown[][] = [];
  const moveCalls: unknown[] = [];
  const objectCalls: unknown[] = [];
  let attempt = 0;

  Aggregator.fetchUpdateForMultiple = async () => {
    attempt++;
    const oracleId = attempt === 1 ? ORACLE_ID : replacementOracleId;
    return {
      responses: [
        {
          fee: 7,
          feedConfigs: { feedHash: '0xfeed' },
          results: [
            {
              signature: '11',
              successValue: '1',
              oracleId,
              isNegative: false,
              timestamp: 1,
            },
          ],
        } as any,
      ],
      failures: [],
    };
  };
  Aggregator.prototype.loadData = async function () {
    return { feedHash: 'feed', id: this.address, minSampleSize: 1 } as any;
  };
  Queue.prototype.loadData = async () =>
    ({
      existingOracles: [
        { oracleId: ORACLE_ID },
        { oracleId: replacementOracleId },
      ],
    }) as any;
  Oracle.prototype.loadData = async function () {
    return this.address === ORACLE_ID
      ? { ...validOracleData(), secp256k1Key: '00'.repeat(64) }
      : validOracleData(replacementOracleId);
  };

  try {
    const result = await Aggregator.fetchManyUpdateTx(
      {
        state: {
          mainnet: false,
          oracleQueueId: QUEUE_ID,
          switchboardAddress: SWITCHBOARD_ID,
        },
      } as any,
      [AGGREGATOR_ID],
      {
        ...transactionValueHelpers(),
        gas: {},
        object: (value: unknown) => {
          objectCalls.push(value);
          return value;
        },
        splitCoins: (_coin: unknown, amounts: unknown[]) => {
          splitCalls.push(amounts);
          return amounts.map(() => ({}));
        },
        moveCall: (call: unknown) => moveCalls.push(call),
      } as any,
      { maxRetries: 1, retryDelayMs: 0 }
    );

    assert.equal(attempt, 2);
    assert.deepEqual(splitCalls, [[7]]);
    assert.equal(moveCalls.length, 1);
    assert.equal(objectCalls.includes(ORACLE_ID), false);
    assert.equal(objectCalls.includes(replacementOracleId), true);
    assert.deepEqual(
      result.responses.flatMap(response =>
        response.results.map(item => item.oracleId)
      ),
      [replacementOracleId]
    );
  } finally {
    Aggregator.fetchUpdateForMultiple = originalFetchUpdateForMultiple;
    Aggregator.prototype.loadData = originalLoadData;
    Queue.prototype.loadData = originalLoadQueueData;
    Oracle.prototype.loadData = originalLoadOracleData;
  }
});

test('configured minimum sample size requires enough distinct valid oracles', async () => {
  const originalFetchUpdateForMultiple = Aggregator.fetchUpdateForMultiple;
  const originalLoadData = Aggregator.prototype.loadData;
  const originalLoadQueueData = Queue.prototype.loadData;
  const originalLoadOracleData = Oracle.prototype.loadData;
  let splitCount = 0;
  let moveCallCount = 0;

  Aggregator.fetchUpdateForMultiple = async () => ({
    responses: [
      {
        fee: 7,
        feedConfigs: { feedHash: '0xfeed' },
        results: [
          {
            signature: '11',
            successValue: '1',
            oracleId: ORACLE_ID,
            isNegative: false,
            timestamp: 1,
          },
        ],
      } as any,
    ],
    failures: [],
  });
  Aggregator.prototype.loadData = async function () {
    return { feedHash: 'feed', id: this.address, minSampleSize: 2 } as any;
  };
  Queue.prototype.loadData = async () =>
    ({ existingOracles: [{ oracleId: ORACLE_ID }] }) as any;
  Oracle.prototype.loadData = async () => validOracleData();

  try {
    await assert.rejects(
      Aggregator.fetchManyUpdateTx(
        {
          state: {
            mainnet: false,
            oracleQueueId: QUEUE_ID,
            switchboardAddress: SWITCHBOARD_ID,
          },
        } as any,
        [AGGREGATOR_ID],
        {
          gas: {},
          splitCoins: () => {
            splitCount++;
            return [];
          },
          moveCall: () => {
            moveCallCount++;
          },
        } as any,
        { maxRetries: 0 }
      ),
      error =>
        error instanceof Error &&
        error.message.includes(`${AGGREGATOR_ID} (1/2)`)
    );
    assert.equal(splitCount, 0);
    assert.equal(moveCallCount, 0);
  } finally {
    Aggregator.fetchUpdateForMultiple = originalFetchUpdateForMultiple;
    Aggregator.prototype.loadData = originalLoadData;
    Queue.prototype.loadData = originalLoadQueueData;
    Oracle.prototype.loadData = originalLoadOracleData;
  }
});

const invalidMappingCases: Array<[string, Record<string, unknown>, string[]]> =
  [
    ['wrong-length mappings', { secp256k1Key: '11'.repeat(63) }, [ORACLE_ID]],
    ['zero signer mappings', { secp256k1Key: '00'.repeat(64) }, [ORACLE_ID]],
    [
      'wrong-length measurement mappings',
      { mrEnclave: '22'.repeat(31) },
      [ORACLE_ID],
    ],
    ['zero measurement mappings', { mrEnclave: '00'.repeat(32) }, [ORACLE_ID]],
    ['expired mappings', { expirationTime: Date.now() - 1 }, [ORACLE_ID]],
    [
      'queue-mismatched mappings',
      { queue: `0x${'e'.repeat(64)}` },
      [ORACLE_ID],
    ],
    ['off-queue mappings', {}, []],
  ];

for (const [name, invalidData, existingOracleIds] of invalidMappingCases) {
  test(`${name} fail without mutating the transaction`, async () => {
    const originalFetchUpdateForMultiple = Aggregator.fetchUpdateForMultiple;
    const originalLoadData = Aggregator.prototype.loadData;
    const originalLoadQueueData = Queue.prototype.loadData;
    const originalLoadOracleData = Oracle.prototype.loadData;
    let splitCount = 0;
    let moveCallCount = 0;

    Aggregator.fetchUpdateForMultiple = async () => ({
      responses: [
        {
          fee: 7,
          feedConfigs: { feedHash: '0xfeed' },
          results: [
            {
              signature: '11',
              successValue: '1',
              oracleId: ORACLE_ID,
              isNegative: false,
              timestamp: 1,
            },
          ],
        } as any,
      ],
      failures: [],
    });
    Aggregator.prototype.loadData = async function () {
      return { feedHash: 'feed', id: this.address, minSampleSize: 1 } as any;
    };
    Queue.prototype.loadData = async () =>
      ({
        existingOracles: existingOracleIds.map(oracleId => ({ oracleId })),
      }) as any;
    Oracle.prototype.loadData = async () => ({
      ...validOracleData(),
      ...invalidData,
    });

    try {
      await assert.rejects(
        Aggregator.fetchManyUpdateTx(
          {
            state: {
              mainnet: false,
              oracleQueueId: QUEUE_ID,
              switchboardAddress: SWITCHBOARD_ID,
            },
          } as any,
          [AGGREGATOR_ID],
          {
            gas: {},
            splitCoins: () => {
              splitCount++;
              return [];
            },
            moveCall: () => {
              moveCallCount++;
            },
          } as any,
          { maxRetries: 0 }
        ),
        error =>
          error instanceof Error &&
          error.message.includes(`${AGGREGATOR_ID} (0/1)`)
      );
      assert.equal(splitCount, 0);
      assert.equal(moveCallCount, 0);
    } finally {
      Aggregator.fetchUpdateForMultiple = originalFetchUpdateForMultiple;
      Aggregator.prototype.loadData = originalLoadData;
      Queue.prototype.loadData = originalLoadQueueData;
      Oracle.prototype.loadData = originalLoadOracleData;
    }
  });
}
