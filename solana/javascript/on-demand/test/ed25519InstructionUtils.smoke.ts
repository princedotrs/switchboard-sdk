import {
  ED25519_CURRENT_INSTRUCTION_INDEX,
  Ed25519InstructionUtils,
  type Ed25519Signature,
} from '../src/instruction-utils/ed25519-instruction-utils.ts';

import assert from 'node:assert/strict';
import { Buffer } from 'buffer';
import nacl from 'tweetnacl';

const SIGNATURE_SIZE = 64;
const PUBKEY_SIZE = 32;
const OFFSETS_SIZE = 14;
const HEADER_SIZE = 2;
const SLOT_SIZE = 8;
const VERSION_SIZE = 1;
const DISCRIMINATOR_SIZE = 4;
const DEFAULT_SLOT = 123_456;
const DEFAULT_VERSION = 0;

type OffsetRecord = {
  signatureOffset: number;
  signatureInstructionIndex: number;
  publicKeyOffset: number;
  publicKeyInstructionIndex: number;
  messageOffset: number;
  messageSize: number;
  messageInstructionIndex: number;
};

type ParsedSignature = {
  pubkey: Buffer;
  signature: Buffer;
  message: Buffer;
  verifies: boolean;
};

type ParsedInstruction = {
  data: Buffer;
  count: number;
  records: OffsetRecord[];
  signatures: ParsedSignature[];
  oracleIndexes: number[];
  slot: bigint;
  version: number;
  tail: string;
};

function quoteMessage(seed: number): Buffer {
  return Buffer.concat([Buffer.alloc(32, seed), Buffer.alloc(49, seed + 1)]);
}

function keypair(seed: number): nacl.SignKeyPair {
  return nacl.sign.keyPair.fromSeed(new Uint8Array(32).fill(seed));
}

function makeSignature(params: {
  oracleIdx: number;
  seed: number;
  message: Buffer;
  signedMessage?: Buffer;
}): Ed25519Signature {
  const kp = keypair(params.seed);
  const signedMessage = params.signedMessage ?? params.message;
  return {
    pubkey: Buffer.from(kp.publicKey),
    signature: Buffer.from(
      nacl.sign.detached(new Uint8Array(signedMessage), kp.secretKey)
    ),
    message: params.message,
    oracleIdx: params.oracleIdx,
  };
}

function verify(pubkey: Buffer, signature: Buffer, message: Buffer): boolean {
  return nacl.sign.detached.verify(
    new Uint8Array(message),
    new Uint8Array(signature),
    new Uint8Array(pubkey)
  );
}

function readOffsetRecord(data: Buffer, offset: number): OffsetRecord {
  return {
    signatureOffset: data.readUInt16LE(offset),
    signatureInstructionIndex: data.readUInt16LE(offset + 2),
    publicKeyOffset: data.readUInt16LE(offset + 4),
    publicKeyInstructionIndex: data.readUInt16LE(offset + 6),
    messageOffset: data.readUInt16LE(offset + 8),
    messageSize: data.readUInt16LE(offset + 10),
    messageInstructionIndex: data.readUInt16LE(offset + 12),
  };
}

function parseInstruction(ix: { data: Buffer }): ParsedInstruction {
  const data = Buffer.from(ix.data);
  const count = data[0];
  assert.equal(data[1], 0);

  const records: OffsetRecord[] = [];
  const signatures: ParsedSignature[] = [];
  for (let i = 0; i < count; i++) {
    const record = readOffsetRecord(data, HEADER_SIZE + i * OFFSETS_SIZE);
    const pubkey = data.subarray(
      record.publicKeyOffset,
      record.publicKeyOffset + PUBKEY_SIZE
    );
    const signature = data.subarray(
      record.signatureOffset,
      record.signatureOffset + SIGNATURE_SIZE
    );
    const message = data.subarray(
      record.messageOffset,
      record.messageOffset + record.messageSize
    );
    records.push(record);
    signatures.push({
      pubkey,
      signature,
      message,
      verifies: verify(pubkey, signature, message),
    });
  }

  const firstRecord = records[0];
  const oracleIndexesOffset =
    firstRecord.messageOffset + firstRecord.messageSize;
  const oracleIndexes = Array.from(
    data.subarray(oracleIndexesOffset, oracleIndexesOffset + count)
  );
  const slotOffset = oracleIndexesOffset + count;
  const slot = data.readBigUInt64LE(slotOffset);
  const versionOffset = slotOffset + SLOT_SIZE;
  const version = data[versionOffset];
  const tail = data
    .subarray(
      versionOffset + VERSION_SIZE,
      versionOffset + VERSION_SIZE + DISCRIMINATOR_SIZE
    )
    .toString('utf8');

  return {
    data,
    count,
    records,
    signatures,
    oracleIndexes,
    slot,
    version,
    tail,
  };
}

function assertMetadata(
  parsed: ParsedInstruction,
  oracleIndexes: number[]
): void {
  assert.deepEqual(parsed.oracleIndexes, oracleIndexes);
  assert.equal(parsed.slot, BigInt(DEFAULT_SLOT));
  assert.equal(parsed.version, DEFAULT_VERSION);
  assert.equal(parsed.tail, 'SBOD');
}

function assertAllVerify(parsed: ParsedInstruction): void {
  assert.equal(
    parsed.signatures.every(sig => sig.verifies),
    true
  );
}

function build(
  signatures: Ed25519Signature[],
  instructionIndex?: number
): ParsedInstruction {
  return parseInstruction(
    Ed25519InstructionUtils.buildEd25519Instruction(
      signatures,
      instructionIndex,
      DEFAULT_SLOT,
      DEFAULT_VERSION
    )
  );
}

function assertRecord(
  actual: OffsetRecord,
  expected: OffsetRecord
): void {
  assert.deepEqual(actual, expected);
}

function run(): void {
  const message = quoteMessage(1);

  const oneSig = makeSignature({ oracleIdx: 4, seed: 4, message });
  const parsedOne = build([oneSig]);
  assert.equal(parsedOne.count, 1);
  assertRecord(parsedOne.records[0], {
    signatureOffset: 16,
    signatureInstructionIndex: ED25519_CURRENT_INSTRUCTION_INDEX,
    publicKeyOffset: 80,
    publicKeyInstructionIndex: ED25519_CURRENT_INSTRUCTION_INDEX,
    messageOffset: 112,
    messageSize: message.length,
    messageInstructionIndex: ED25519_CURRENT_INSTRUCTION_INDEX,
  });
  assertAllVerify(parsedOne);
  assertMetadata(parsedOne, [4]);

  const twoSigs = [
    makeSignature({ oracleIdx: 2, seed: 2, message }),
    makeSignature({ oracleIdx: 5, seed: 5, message }),
  ];
  const parsedTwo = build(twoSigs, 1);
  assert.equal(parsedTwo.count, 2);
  assertRecord(parsedTwo.records[0], {
    signatureOffset: 30,
    signatureInstructionIndex: 1,
    publicKeyOffset: 158,
    publicKeyInstructionIndex: 1,
    messageOffset: 222,
    messageSize: message.length,
    messageInstructionIndex: 1,
  });
  assertRecord(parsedTwo.records[1], {
    signatureOffset: 94,
    signatureInstructionIndex: 1,
    publicKeyOffset: 190,
    publicKeyInstructionIndex: 1,
    messageOffset: 222,
    messageSize: message.length,
    messageInstructionIndex: 1,
  });
  assert.equal(HEADER_SIZE + parsedTwo.count * OFFSETS_SIZE, 30);
  assert.equal(parsedTwo.records[1].signatureOffset, 30 + SIGNATURE_SIZE);
  assert.equal(parsedTwo.records[0].publicKeyOffset, 30 + 2 * SIGNATURE_SIZE);
  assert.equal(
    parsedTwo.records[0].messageOffset,
    30 + 2 * SIGNATURE_SIZE + 2 * PUBKEY_SIZE
  );
  assertAllVerify(parsedTwo);
  assertMetadata(parsedTwo, [2, 5]);

  const unsortedSigs = [
    makeSignature({ oracleIdx: 7, seed: 7, message }),
    makeSignature({ oracleIdx: 2, seed: 2, message }),
    makeSignature({ oracleIdx: 5, seed: 5, message }),
  ];
  const parsedThree = build(unsortedSigs);
  assert.equal(parsedThree.count, 3);
  assert.deepEqual(parsedThree.oracleIndexes, [2, 5, 7]);
  assert.equal(
    parsedThree.records.every(
      record =>
        record.signatureInstructionIndex ===
          ED25519_CURRENT_INSTRUCTION_INDEX &&
        record.publicKeyInstructionIndex ===
          ED25519_CURRENT_INSTRUCTION_INDEX &&
        record.messageInstructionIndex ===
          ED25519_CURRENT_INSTRUCTION_INDEX
    ),
    true
  );
  assert.equal(parsedThree.records[0].signatureOffset, 44);
  assert.equal(parsedThree.records[0].publicKeyOffset, 236);
  assert.equal(parsedThree.records[0].messageOffset, 332);
  assert.deepEqual(parsedThree.signatures.map(sig => sig.pubkey), [
    Buffer.from(keypair(2).publicKey),
    Buffer.from(keypair(5).publicKey),
    Buffer.from(keypair(7).publicKey),
  ]);
  assertAllVerify(parsedThree);
  assertMetadata(parsedThree, [2, 5, 7]);

  const invalidSignature = makeSignature({
    oracleIdx: 2,
    seed: 2,
    message,
    signedMessage: quoteMessage(9),
  });
  const parsedInvalid = build([
    makeSignature({ oracleIdx: 1, seed: 1, message }),
    invalidSignature,
  ]);
  assert.deepEqual(
    parsedInvalid.signatures.map(sig => sig.verifies),
    [true, false]
  );

  assert.throws(
    () =>
      Ed25519InstructionUtils.buildEd25519Instruction(
        [
          makeSignature({ oracleIdx: 1, seed: 1, message }),
          makeSignature({ oracleIdx: 2, seed: 2, message: quoteMessage(3) }),
        ],
        0,
        DEFAULT_SLOT,
        DEFAULT_VERSION
      ),
    /same message/
  );

  assert.throws(
    () =>
      Ed25519InstructionUtils.buildEd25519Instruction(
        Array.from({ length: 9 }, (_, i) =>
          makeSignature({ oracleIdx: i, seed: i + 1, message })
        ),
        0,
        DEFAULT_SLOT,
        DEFAULT_VERSION
      ),
    /maximum supported is 8/
  );

  assert.throws(
    () =>
      Ed25519InstructionUtils.buildEd25519Instruction(
        [makeSignature({ oracleIdx: 1, seed: 1, message })],
        65_536,
        DEFAULT_SLOT,
        DEFAULT_VERSION
      ),
    /Invalid instruction index/
  );

  const validSignature = makeSignature({ oracleIdx: 1, seed: 1, message });

  assert.throws(
    () =>
      Ed25519InstructionUtils.buildEd25519Instruction(
        [{ ...validSignature, pubkey: Buffer.alloc(31) }],
        0,
        DEFAULT_SLOT,
        DEFAULT_VERSION
      ),
    /pubkey length/
  );

  assert.throws(
    () =>
      Ed25519InstructionUtils.buildEd25519Instruction(
        [{ ...validSignature, signature: Buffer.alloc(63) }],
        0,
        DEFAULT_SLOT,
        DEFAULT_VERSION
      ),
    /signature length/
  );

  assert.throws(
    () =>
      Ed25519InstructionUtils.buildEd25519Instruction(
        [{ ...validSignature, message: Buffer.alloc(65_536) }],
        0,
        DEFAULT_SLOT,
        DEFAULT_VERSION
      ),
    /message length/
  );

  assert.throws(
    () =>
      Ed25519InstructionUtils.buildEd25519Instruction(
        [{ ...validSignature, oracleIdx: 256 }],
        0,
        DEFAULT_SLOT,
        DEFAULT_VERSION
      ),
    /oracleIdx/
  );

  assert.throws(
    () =>
      Ed25519InstructionUtils.buildEd25519Instruction(
        [
          validSignature,
          makeSignature({
            oracleIdx: validSignature.oracleIdx,
            seed: 2,
            message,
          }),
        ],
        0,
        DEFAULT_SLOT,
        DEFAULT_VERSION
      ),
    /Duplicate oracleIdx/
  );

  assert.throws(
    () =>
      Ed25519InstructionUtils.buildEd25519Instruction(
        [validSignature],
        undefined,
        DEFAULT_SLOT
      ),
    /must be provided together/
  );

  assert.throws(
    () =>
      Ed25519InstructionUtils.buildEd25519Instruction(
        [validSignature],
        undefined,
        -1,
        DEFAULT_VERSION
      ),
    /recent slot/
  );

  assert.throws(
    () =>
      Ed25519InstructionUtils.buildEd25519Instruction(
        [validSignature],
        undefined,
        DEFAULT_SLOT,
        256
      ),
    /version/
  );
}

run();
console.log('ed25519 instruction utils smoke test passed');
