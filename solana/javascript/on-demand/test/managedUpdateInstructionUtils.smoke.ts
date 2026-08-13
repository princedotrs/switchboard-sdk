import { QUOTE_PROGRAM_ID } from '../src/classes/oracleQuote.ts';
import {
  ED25519_CURRENT_INSTRUCTION_INDEX,
  Ed25519InstructionUtils,
  type Ed25519Signature,
} from '../src/instruction-utils/ed25519-instruction-utils.ts';
import {
  finalizeManagedUpdateInstructions,
  InstructionUtils,
} from '../src/index.ts';

import assert from 'node:assert/strict';
import { Buffer } from 'buffer';

import { web3 } from '@coral-xyz/anchor-31';
import nacl from 'tweetnacl';

const OFFSETS_SIZE = 14;
const HEADER_SIZE = 2;
const DEFAULT_SLOT = 123_456;
const DEFAULT_VERSION = 0;

function makeSignature(seed: number, oracleIdx: number): Ed25519Signature {
  const keypair = nacl.sign.keyPair.fromSeed(new Uint8Array(32).fill(seed));
  const message = Buffer.concat([Buffer.alloc(32, 7), Buffer.alloc(49, 8)]);
  return {
    pubkey: Buffer.from(keypair.publicKey),
    signature: Buffer.from(
      nacl.sign.detached(new Uint8Array(message), keypair.secretKey)
    ),
    message,
    oracleIdx,
  };
}

function makeEd25519Instruction(
  signatureCount = 1,
  instructionIndex = 0
): web3.TransactionInstruction {
  return Ed25519InstructionUtils.buildEd25519Instruction(
    Array.from({ length: signatureCount }, (_, index) =>
      makeSignature(index + 1, index)
    ),
    instructionIndex,
    DEFAULT_SLOT,
    DEFAULT_VERSION
  );
}

function makeQuoteInstruction(
  instructionIndex = 0,
  bump = 9
): web3.TransactionInstruction {
  return new web3.TransactionInstruction({
    programId: QUOTE_PROGRAM_ID,
    keys: [],
    data: Buffer.from([0, instructionIndex, bump]),
  });
}

function makePrefixInstruction(seed: number): web3.TransactionInstruction {
  return new web3.TransactionInstruction({
    programId: web3.SystemProgram.programId,
    keys: [],
    data: Buffer.from([seed]),
  });
}

function readReferenceIndexes(data: Buffer): number[] {
  const signatureCount = data[0];
  const indexes: number[] = [];
  for (let i = 0; i < signatureCount; i++) {
    const recordOffset = HEADER_SIZE + i * OFFSETS_SIZE;
    indexes.push(
      data.readUInt16LE(recordOffset + 2),
      data.readUInt16LE(recordOffset + 6),
      data.readUInt16LE(recordOffset + 12)
    );
  }
  return indexes;
}

function assertCurrentInstructionReferences(data: Buffer): void {
  assert.equal(
    readReferenceIndexes(data).every(
      index => index === ED25519_CURRENT_INSTRUCTION_INDEX
    ),
    true
  );
}

function assertInstructionArraysEqual(
  actual: web3.TransactionInstruction[],
  expected: web3.TransactionInstruction[]
): void {
  assert.equal(actual.length, expected.length);
  for (let i = 0; i < actual.length; i++) {
    assert.equal(actual[i].programId.equals(expected[i].programId), true);
    assert.deepEqual(actual[i].keys, expected[i].keys);
    assert.deepEqual(actual[i].data, expected[i].data);
  }
}

async function run(): Promise<void> {
  const prefix = makePrefixInstruction(1);
  const ed25519 = makeEd25519Instruction(2);
  const quote = makeQuoteInstruction(0, 17);
  const original = [prefix, ed25519, quote];
  const finalized = finalizeManagedUpdateInstructions(original);

  assert.notEqual(finalized, original);
  assert.notEqual(finalized[1], original[1]);
  assertCurrentInstructionReferences(finalized[1].data);
  assert.equal(finalized[2].data[1], 1);
  assert.equal(finalized[2].data[2], 17);
  assert.deepEqual(readReferenceIndexes(original[1].data), [0, 0, 0, 0, 0, 0]);
  assert.equal(original[2].data[1], 0);

  const finalizedAgain = finalizeManagedUpdateInstructions(finalized);
  assertInstructionArraysEqual(finalizedAgain, finalized);

  const directEd25519 = finalizeManagedUpdateInstructions([
    makePrefixInstruction(2),
    makeEd25519Instruction(),
  ]);
  assertCurrentInstructionReferences(directEd25519[1].data);

  const multiplePairs = finalizeManagedUpdateInstructions([
    makePrefixInstruction(3),
    makeEd25519Instruction(),
    makeQuoteInstruction(),
    makePrefixInstruction(4),
    makeEd25519Instruction(2),
    makeQuoteInstruction(),
  ]);
  assert.equal(multiplePairs[2].data[1], 1);
  assert.equal(multiplePairs[5].data[1], 4);
  assertCurrentInstructionReferences(multiplePairs[1].data);
  assertCurrentInstructionReferences(multiplePairs[4].data);

  const unrelatedEd25519 = new web3.TransactionInstruction({
    programId: web3.Ed25519Program.programId,
    keys: [],
    data: Buffer.from([0, 0]),
  });
  const authorityQuote = new web3.TransactionInstruction({
    programId: QUOTE_PROGRAM_ID,
    keys: [],
    data: Buffer.from([1, 2, 3]),
  });
  const unrelated = finalizeManagedUpdateInstructions([
    unrelatedEd25519,
    authorityQuote,
  ]);
  assert.deepEqual(unrelated[0].data, unrelatedEd25519.data);
  assert.deepEqual(unrelated[1].data, authorityQuote.data);

  assert.throws(
    () => finalizeManagedUpdateInstructions([makeQuoteInstruction()]),
    /place the verified update immediately/
  );

  const legacyNonAdjacent = finalizeManagedUpdateInstructions([
    makeEd25519Instruction(),
    makePrefixInstruction(5),
    makeQuoteInstruction(0),
  ]);
  assert.equal(legacyNonAdjacent[2].data[1], 0);
  assertCurrentInstructionReferences(legacyNonAdjacent[0].data);

  assert.throws(
    () =>
      finalizeManagedUpdateInstructions([
        makePrefixInstruction(6),
        makeEd25519Instruction(),
        makePrefixInstruction(7),
        makeQuoteInstruction(),
      ]),
    /place the verified update immediately/
  );

  const malformedEd25519 = makeEd25519Instruction();
  malformedEd25519.data.writeUInt16LE(
    malformedEd25519.data.readUInt16LE(HEADER_SIZE + 10) + 1,
    HEADER_SIZE + 10
  );
  assert.throws(
    () =>
      finalizeManagedUpdateInstructions([
        malformedEd25519,
        makeQuoteInstruction(),
      ]),
    /place the verified update immediately/
  );

  const malformedQuote = makeQuoteInstruction();
  malformedQuote.data = Buffer.from([0, 0]);
  assert.throws(
    () =>
      finalizeManagedUpdateInstructions([
        makeEd25519Instruction(),
        malformedQuote,
      ]),
    /expected 3 data bytes/
  );

  assert.throws(
    () =>
      finalizeManagedUpdateInstructions([
        ...Array.from({ length: 256 }, (_, index) =>
          makePrefixInstruction(index)
        ),
        makeEd25519Instruction(),
        makeQuoteInstruction(),
      ]),
    /exceeds the quote program's u8 limit/
  );

  let simulatedTransaction: web3.VersionedTransaction | undefined;
  const connection = {
    getLatestBlockhash: async () => ({
      blockhash: web3.PublicKey.default.toBase58(),
      lastValidBlockHeight: 1,
    }),
    simulateTransaction: async (transaction: web3.VersionedTransaction) => {
      simulatedTransaction = transaction;
      return {
        context: { slot: 1 },
        value: {
          err: null,
          logs: [],
          unitsConsumed: 100_000,
        },
      };
    },
  } as unknown as web3.Connection;
  const transaction = await InstructionUtils.asV0TxWithComputeIxs({
    connection,
    ixs: [
      makePrefixInstruction(6),
      makeEd25519Instruction(),
      makeQuoteInstruction(),
    ],
    payer: new web3.PublicKey(Buffer.alloc(32, 9)),
  });

  assert.ok(simulatedTransaction);
  assertCurrentInstructionReferences(
    Buffer.from(simulatedTransaction.message.compiledInstructions[1].data)
  );
  assert.equal(
    simulatedTransaction.message.compiledInstructions[2].data[1],
    1
  );
  assertCurrentInstructionReferences(
    Buffer.from(transaction.message.compiledInstructions[1].data)
  );
  assert.equal(transaction.message.compiledInstructions[2].data[1], 1);
}

run()
  .then(() => {
    console.log('managed update instruction utils smoke test passed');
  })
  .catch(error => {
    console.error(error);
    process.exitCode = 1;
  });
