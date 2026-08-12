import { PullFeed } from '../src/accounts/pullFeed.ts';
import { Queue } from '../src/accounts/queue.ts';

import type { Program } from '@coral-xyz/anchor-31';
import { BN, web3 } from '@coral-xyz/anchor-31';
import { LegacyCrossbarClient } from '@switchboard-xyz/common-legacy';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

const ON_DEMAND_PROGRAM_ID_HEX =
  '0673bd46f2e47e04f12bd92fb731968ecd9d9757c274da87476f465c040c6573';
const PLACEHOLDER_DISCRIMINATOR = Buffer.from('0102030405060708', 'hex');
const ON_DEMAND_PROGRAM_ID = new web3.PublicKey(
  Buffer.from(ON_DEMAND_PROGRAM_ID_HEX, 'hex')
);
const PAYER = web3.Keypair.generate().publicKey;
const QUEUE = web3.Keypair.generate().publicKey;
const FEED = web3.Keypair.generate().publicKey;
const SECOND_FEED = web3.Keypair.generate().publicKey;
const ORACLE = web3.Keypair.generate().publicKey;
const FEED_HASH = Buffer.from(new Uint8Array(32).fill(7));
const SECOND_FEED_HASH = Buffer.from(new Uint8Array(32).fill(6));
const UNEXPECTED_FEED_HASH = Buffer.from(new Uint8Array(32).fill(5));
const EXACT_MAX_VARIANCE = 8_271_619;

function anchorDiscriminator(name: string): Buffer {
  return createHash('sha256')
    .update(`global:${name}`)
    .digest()
    .subarray(0, 8);
}

function instructionWithDiscriminator(
  name: string,
  keys: web3.AccountMeta[] = []
): web3.TransactionInstruction {
  return new web3.TransactionInstruction({
    programId: ON_DEMAND_PROGRAM_ID,
    keys,
    data: Buffer.concat([anchorDiscriminator(name), Buffer.alloc(8)]),
  });
}

function assertDiscriminator(
  instruction: web3.TransactionInstruction,
  expectedName: string
): void {
  const discriminator = instruction.data.subarray(0, 8);
  assert.deepEqual(discriminator, anchorDiscriminator(expectedName));
  assert.notDeepEqual(discriminator, PLACEHOLDER_DISCRIMINATOR);
}

type MockInstructionContext = {
  accounts?: Record<string, web3.PublicKey>;
  remainingAccounts?: web3.AccountMeta[];
};

function createMockProgram(): {
  program: Program;
  calls: {
    legacy: number;
    consensus: number;
    svm: number;
    legacyContexts: MockInstructionContext[];
    consensusContexts: MockInstructionContext[];
  };
} {
  const calls = {
    legacy: 0,
    consensus: 0,
    svm: 0,
    legacyContexts: [] as MockInstructionContext[],
    consensusContexts: [] as MockInstructionContext[],
  };
  const program = {
    programId: ON_DEMAND_PROGRAM_ID,
    provider: { publicKey: PAYER },
    instruction: {
      pullFeedSubmitResponseConsensus: (
        _data: unknown,
        context: MockInstructionContext
      ) => {
        calls.consensus += 1;
        calls.consensusContexts.push(context);
        return instructionWithDiscriminator(
          'pull_feed_submit_response_consensus',
          context.remainingAccounts
        );
      },
      pullFeedSubmitResponse: (
        _data: unknown,
        context: MockInstructionContext
      ) => {
        calls.legacy += 1;
        calls.legacyContexts.push(context);
        return instructionWithDiscriminator(
          'pull_feed_submit_response',
          context.remainingAccounts
        );
      },
      pullFeedSubmitResponseSvm: () => {
        calls.svm += 1;
        throw new Error('SVM submit path should not be used');
      },
    },
  } as unknown as Program;

  return { program, calls };
}

function gatewayOracleResponse() {
  return {
    eth_address: Buffer.alloc(20, 8).toString('hex'),
    signature: Buffer.alloc(64, 9).toString('base64'),
    checksum: Buffer.alloc(32, 10).toString('base64'),
    recovery_id: 1,
    oracle_pubkey: ORACLE.toBuffer().toString('hex'),
    errors: [],
    feed_responses: [
      {
        failure_error: '',
        success_value: '42000000000000000000',
      },
    ],
  };
}

function feedEvalResponse() {
  return {
    queue_pubkey: QUEUE.toBuffer().toString('hex'),
    oracle_pubkey: ORACLE.toBuffer().toString('hex'),
    success_value: '42000000000000000000',
    signature: Buffer.alloc(64, 9).toString('base64'),
    recovery_id: 1,
  };
}

async function testFetchUpdateManyUsesConsensusDiscriminator(): Promise<void> {
  const { program, calls } = createMockProgram();
  const feed = new PullFeed(program, FEED);
  feed.data = {
    queue: QUEUE,
    maxVariance: new BN(EXACT_MAX_VARIANCE),
    minResponses: 1,
    feedHash: FEED_HASH,
  } as any;

  const originalLegacyFetch = LegacyCrossbarClient.prototype.fetch;
  const originalFetchSignaturesConsensus = Queue.fetchSignaturesConsensus;
  const variableOverrides = { PYTH_API_KEY: 'request-scoped-test-key' };
  let forwardedOverrides: Record<string, string> | undefined;
  let forwardedFeedConfigs: any[] | undefined;

  try {
    LegacyCrossbarClient.prototype.fetch = async () => ({ jobs: [] });
    Queue.fetchSignaturesConsensus = (async (_program: Program, params: any) => {
      forwardedOverrides = params.variableOverrides;
      forwardedFeedConfigs = params.feedConfigs;
      return {
        oracle_responses: [gatewayOracleResponse()],
        median_responses: [
          {
            feed_hash: FEED_HASH.toString('hex'),
            value: '42000000000000000000',
          },
        ],
        slot: 150,
      };
    }) as typeof Queue.fetchSignaturesConsensus;

    const [instructions] = await PullFeed.fetchUpdateManyIx(program, {
      feeds: [feed],
      numSignatures: 1,
      payer: PAYER,
      crossbarClient: { crossbarUrl: 'http://localhost' } as any,
      variableOverrides,
    });

    const submitIx = instructions.find(instruction =>
      instruction.programId.equals(ON_DEMAND_PROGRAM_ID)
    );
    assert.ok(submitIx);
    assert.equal(calls.consensus, 1);
    assert.equal(calls.legacy, 0);
    assert.deepEqual(forwardedOverrides, variableOverrides);
    assert.equal(
      forwardedFeedConfigs?.[0]?.maxVarianceScaled,
      EXACT_MAX_VARIANCE
    );
    assert.notEqual(
      forwardedFeedConfigs?.[0]?.maxVarianceScaled,
      EXACT_MAX_VARIANCE - 1
    );
    assert.equal(
      Object.hasOwn(forwardedFeedConfigs?.[0] ?? {}, 'maxVariance'),
      false
    );
    assertDiscriminator(submitIx, 'pull_feed_submit_response_consensus');
  } finally {
    LegacyCrossbarClient.prototype.fetch = originalLegacyFetch;
    Queue.fetchSignaturesConsensus = originalFetchSignaturesConsensus;
  }
}

async function testFetchUpdateManyRejectsUnexpectedFeedHash(): Promise<void> {
  const { program, calls } = createMockProgram();
  const feed = new PullFeed(program, FEED);
  feed.data = {
    queue: QUEUE,
    maxVariance: new BN(EXACT_MAX_VARIANCE),
    minResponses: 1,
    feedHash: FEED_HASH,
  } as any;

  const originalLegacyFetch = LegacyCrossbarClient.prototype.fetch;
  const originalFetchSignaturesConsensus = Queue.fetchSignaturesConsensus;

  try {
    LegacyCrossbarClient.prototype.fetch = async () => ({ jobs: [] });
    Queue.fetchSignaturesConsensus = (async () => ({
      oracle_responses: [gatewayOracleResponse()],
      median_responses: [
        {
          feed_hash: UNEXPECTED_FEED_HASH.toString('hex'),
          value: '42000000000000000000',
        },
      ],
      slot: 150,
    })) as typeof Queue.fetchSignaturesConsensus;

    await assert.rejects(
      PullFeed.fetchUpdateManyIx(program, {
        feeds: [feed],
        numSignatures: 1,
        payer: PAYER,
        crossbarClient: { crossbarUrl: 'http://localhost' } as any,
      }),
      error => {
        assert.match(
          String(error),
          /unexpected median response feed hash/i
        );
        assert.match(String(error), new RegExp(FEED_HASH.toString('hex')));
        assert.match(
          String(error),
          new RegExp(UNEXPECTED_FEED_HASH.toString('hex'))
        );
        return true;
      }
    );
    assert.equal(calls.consensus, 0);
  } finally {
    LegacyCrossbarClient.prototype.fetch = originalLegacyFetch;
    Queue.fetchSignaturesConsensus = originalFetchSignaturesConsensus;
  }
}

async function testFetchUpdateManyLightRejectsUnexpectedFeedHash(): Promise<void> {
  const { program, calls } = createMockProgram();
  const feed = new PullFeed(program, FEED);
  feed.data = {
    queue: QUEUE,
    maxVariance: new BN(EXACT_MAX_VARIANCE),
    minResponses: 1,
    feedHash: FEED_HASH,
  } as any;
  feed.loadJobs = async () => [];

  const originalLoadMany = PullFeed.loadMany;
  const originalFetchSignaturesConsensus = Queue.fetchSignaturesConsensus;
  let forwardedFeedConfigs: any[] | undefined;

  try {
    PullFeed.loadMany = (async () => [
      feed.data,
    ]) as typeof PullFeed.loadMany;
    Queue.fetchSignaturesConsensus = (async (_program: Program, params: any) => {
      forwardedFeedConfigs = params.feedConfigs;
      return {
        oracle_responses: [gatewayOracleResponse()],
        median_responses: [
          {
            feed_hash: UNEXPECTED_FEED_HASH.toString('hex'),
            value: '42000000000000000000',
          },
        ],
        slot: 150,
      };
    }) as typeof Queue.fetchSignaturesConsensus;

    await assert.rejects(
      PullFeed.fetchUpdateManyLightIx(program, {
        feeds: [feed],
        numSignatures: 1,
        payer: PAYER,
        crossbarClient: { crossbarUrl: 'http://localhost' } as any,
      }),
      error => {
        assert.match(
          String(error),
          /unexpected median response feed hash/i
        );
        assert.match(String(error), new RegExp(FEED_HASH.toString('hex')));
        assert.match(
          String(error),
          new RegExp(UNEXPECTED_FEED_HASH.toString('hex'))
        );
        return true;
      }
    );
    assert.equal(calls.consensus, 0);
    assert.equal(
      forwardedFeedConfigs?.[0]?.maxVarianceScaled,
      EXACT_MAX_VARIANCE
    );
    assert.notEqual(
      forwardedFeedConfigs?.[0]?.maxVarianceScaled,
      EXACT_MAX_VARIANCE - 1
    );
    assert.equal(
      Object.hasOwn(forwardedFeedConfigs?.[0] ?? {}, 'maxVariance'),
      false
    );
  } finally {
    PullFeed.loadMany = originalLoadMany;
    Queue.fetchSignaturesConsensus = originalFetchSignaturesConsensus;
  }
}

async function testFetchUpdateIxUsesExactScaledVariance(): Promise<void> {
  const { program } = createMockProgram();
  const feed = new PullFeed(program, FEED);
  feed.data = {
    queue: QUEUE,
    maxVariance: new BN(EXACT_MAX_VARIANCE),
    minResponses: 1,
    feedHash: FEED_HASH,
    minSampleSize: 1,
  } as any;

  const originalLegacyFetch = LegacyCrossbarClient.prototype.fetch;
  const originalFetchSignaturesConsensus = Queue.fetchSignaturesConsensus;
  let forwardedFeedConfigs: any[] | undefined;

  try {
    LegacyCrossbarClient.prototype.fetch = async () => ({ jobs: [] });
    Queue.fetchSignaturesConsensus = (async (_program: Program, params: any) => {
      forwardedFeedConfigs = params.feedConfigs;
      return {
        oracle_responses: [gatewayOracleResponse()],
        median_responses: [
          {
            feed_hash: FEED_HASH.toString('hex'),
            value: '42000000000000000000',
          },
        ],
        slot: 150,
      };
    }) as typeof Queue.fetchSignaturesConsensus;

    const [instructions, , numSuccesses] = await PullFeed.fetchUpdateIx({
      pullFeed: feed,
      numSignatures: 1,
      crossbarClient: { crossbarUrl: 'http://localhost' } as any,
      payer: PAYER,
    });

    assert.ok(instructions);
    assert.equal(numSuccesses, 1);
    assert.equal(
      forwardedFeedConfigs?.[0]?.maxVarianceScaled,
      EXACT_MAX_VARIANCE
    );
    assert.notEqual(
      forwardedFeedConfigs?.[0]?.maxVarianceScaled,
      EXACT_MAX_VARIANCE - 1
    );
    assert.equal(
      Object.hasOwn(forwardedFeedConfigs?.[0] ?? {}, 'maxVariance'),
      false
    );
  } finally {
    LegacyCrossbarClient.prototype.fetch = originalLegacyFetch;
    Queue.fetchSignaturesConsensus = originalFetchSignaturesConsensus;
  }
}

async function testFetchUpdateManyRejectsUnsafeScaledVarianceBeforeNetwork(): Promise<void> {
  const { program } = createMockProgram();
  const feed = new PullFeed(program, FEED);
  feed.data = {
    queue: QUEUE,
    maxVariance: new BN(Number.MAX_SAFE_INTEGER.toString()).addn(1),
    minResponses: 1,
    feedHash: FEED_HASH,
  } as any;

  const originalLegacyFetch = LegacyCrossbarClient.prototype.fetch;
  const originalFetchSignaturesConsensus = Queue.fetchSignaturesConsensus;
  let crossbarCalls = 0;
  let gatewayCalls = 0;

  try {
    LegacyCrossbarClient.prototype.fetch = async () => {
      crossbarCalls += 1;
      return { jobs: [] };
    };
    Queue.fetchSignaturesConsensus = (async () => {
      gatewayCalls += 1;
      throw new Error('gateway must not be called');
    }) as typeof Queue.fetchSignaturesConsensus;

    await assert.rejects(
      PullFeed.fetchUpdateManyIx(program, {
        feeds: [feed],
        numSignatures: 1,
        payer: PAYER,
        crossbarClient: { crossbarUrl: 'http://localhost' } as any,
      }),
      /safe-integer range/
    );
    assert.equal(crossbarCalls, 0);
    assert.equal(gatewayCalls, 0);
  } finally {
    LegacyCrossbarClient.prototype.fetch = originalLegacyFetch;
    Queue.fetchSignaturesConsensus = originalFetchSignaturesConsensus;
  }
}

async function testFetchUpdateManyAllowsPartialSuccess(): Promise<void> {
  const { program, calls } = createMockProgram();
  const firstFeed = new PullFeed(program, FEED);
  firstFeed.data = {
    queue: QUEUE,
    maxVariance: new BN(0),
    minResponses: 1,
    feedHash: FEED_HASH,
  } as any;
  const secondFeed = new PullFeed(program, SECOND_FEED);
  secondFeed.data = {
    queue: QUEUE,
    maxVariance: new BN(0),
    minResponses: 1,
    feedHash: SECOND_FEED_HASH,
  } as any;

  const originalLegacyFetch = LegacyCrossbarClient.prototype.fetch;
  const originalFetchSignaturesConsensus = Queue.fetchSignaturesConsensus;

  try {
    LegacyCrossbarClient.prototype.fetch = async () => ({ jobs: [] });
    Queue.fetchSignaturesConsensus = (async () => ({
      oracle_responses: [gatewayOracleResponse()],
      median_responses: [
        {
          feed_hash: SECOND_FEED_HASH.toString('hex'),
          value: '42000000000000000000',
        },
      ],
      slot: 150,
    })) as typeof Queue.fetchSignaturesConsensus;

    await PullFeed.fetchUpdateManyIx(program, {
      feeds: [firstFeed, secondFeed],
      numSignatures: 1,
      payer: PAYER,
      crossbarClient: { crossbarUrl: 'http://localhost' } as any,
    });

    assert.equal(calls.consensus, 1);
    assert.ok(
      calls.consensusContexts[0]?.remainingAccounts?.[0]?.pubkey.equals(
        SECOND_FEED
      )
    );
  } finally {
    LegacyCrossbarClient.prototype.fetch = originalLegacyFetch;
    Queue.fetchSignaturesConsensus = originalFetchSignaturesConsensus;
  }
}

function testLowerLevelSubmitHelperUsesLegacyDiscriminator(): void {
  const { program, calls } = createMockProgram();
  const feed = new PullFeed(program, FEED);
  const instruction = feed.getSolanaSubmitSignaturesIx({
    resps: [feedEvalResponse() as any],
    offsets: [0],
    slot: new BN(150),
    payer: PAYER,
  });

  assert.equal(calls.legacy, 1);
  assert.equal(calls.consensus, 0);
  assert.equal(calls.svm, 0);
  assertDiscriminator(instruction, 'pull_feed_submit_response');
}

function testNonSolanaSubmitHelperUsesLegacyInstructionWithPdas(): void {
  const { program, calls } = createMockProgram();
  const feed = new PullFeed(program, FEED);
  const instruction = feed.getSolanaSubmitSignaturesIx({
    resps: [feedEvalResponse() as any],
    offsets: [0],
    slot: new BN(150),
    payer: PAYER,
    chain: 'aptos',
  });

  const [queuePda] = web3.PublicKey.findProgramAddressSync(
    [Buffer.from('Queue'), QUEUE.toBuffer()],
    ON_DEMAND_PROGRAM_ID
  );
  const [oraclePda] = web3.PublicKey.findProgramAddressSync(
    [Buffer.from('Oracle'), queuePda.toBuffer(), ORACLE.toBuffer()],
    ON_DEMAND_PROGRAM_ID
  );
  const [oracleStatsPda] = web3.PublicKey.findProgramAddressSync(
    [Buffer.from('OracleStats'), oraclePda.toBuffer()],
    ON_DEMAND_PROGRAM_ID
  );

  assert.equal(calls.legacy, 1);
  assert.equal(calls.consensus, 0);
  assert.equal(calls.svm, 0);
  assertDiscriminator(instruction, 'pull_feed_submit_response');

  const legacyContext = calls.legacyContexts[0];
  assert.ok(legacyContext);
  assert.ok(legacyContext.accounts?.queue.equals(queuePda));
  assert.ok(!legacyContext.accounts?.queue.equals(QUEUE));
  assert.deepEqual(
    legacyContext.remainingAccounts?.map(account => ({
      pubkey: account.pubkey.toBase58(),
      isSigner: account.isSigner,
      isWritable: account.isWritable,
    })),
    [
      {
        pubkey: oraclePda.toBase58(),
        isSigner: false,
        isWritable: false,
      },
      {
        pubkey: oracleStatsPda.toBase58(),
        isSigner: false,
        isWritable: true,
      },
    ]
  );
}

async function run(): Promise<void> {
  await testFetchUpdateManyUsesConsensusDiscriminator();
  await testFetchUpdateManyRejectsUnexpectedFeedHash();
  await testFetchUpdateManyLightRejectsUnexpectedFeedHash();
  await testFetchUpdateIxUsesExactScaledVariance();
  await testFetchUpdateManyRejectsUnsafeScaledVarianceBeforeNetwork();
  await testFetchUpdateManyAllowsPartialSuccess();
  testLowerLevelSubmitHelperUsesLegacyDiscriminator();
  testNonSolanaSubmitHelperUsesLegacyInstructionWithPdas();
}

run()
  .then(() => console.log('pullFeed discriminator smoke test passed'))
  .catch(error => {
    console.error(error);
    process.exitCode = 1;
  });
