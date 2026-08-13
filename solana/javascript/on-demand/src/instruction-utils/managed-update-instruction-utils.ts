import { QUOTE_PROGRAM_ID } from '../classes/oracleQuote.js';

import { ED25519_CURRENT_INSTRUCTION_INDEX } from './ed25519-instruction-utils.js';

import { web3 } from '@coral-xyz/anchor-31';
import { Buffer } from 'buffer';

const ED25519_HEADER_SIZE = 2;
const ED25519_OFFSETS_SIZE = 14;
const ED25519_SIGNATURE_SIZE = 64;
const ED25519_PUBKEY_SIZE = 32;
const MAX_ED25519_SIGNATURES = 8;
const QUOTE_METADATA_SIZE = 13;
const QUOTE_HEADER_SIZE = 32;
const QUOTE_FEED_INFO_SIZE = 49;
const VERIFIED_UPDATE_OPCODE = 0;
const VERIFIED_UPDATE_DATA_SIZE = 3;
const MAX_QUOTE_INSTRUCTION_INDEX = 0xff;
const SWITCHBOARD_QUOTE_DISCRIMINATOR = Buffer.from('SBOD');

type ParsedSwitchboardEd25519Instruction = {
  signatureCount: number;
};

/**
 * Finalizes Switchboard managed-update instruction indices after the complete
 * transaction instruction order is known.
 *
 * The returned instructions are clones. Switchboard Ed25519 offset records use
 * Solana's current-instruction sentinel, while each adjacent quote-program
 * verified update receives the Ed25519 instruction's absolute transaction
 * index. Non-Switchboard instructions are left unchanged.
 *
 * Keep each managed-update pair adjacent for automatic resolution and call
 * this helper immediately before compiling a custom transaction. Legacy
 * non-adjacent pairs remain supported when their encoded index is already
 * correct. {@link InstructionUtils.asV0TxWithComputeIxs} calls this helper
 * automatically.
 */
export function finalizeManagedUpdateInstructions(
  instructions: readonly web3.TransactionInstruction[]
): web3.TransactionInstruction[] {
  const finalized = instructions.map(cloneInstruction);
  const switchboardEd25519Indexes = new Set<number>();

  for (let index = 0; index < finalized.length; index++) {
    const parsed = parseSwitchboardEd25519Instruction(finalized[index]);
    if (parsed === null) {
      continue;
    }

    setCurrentInstructionReferences(
      finalized[index].data,
      parsed.signatureCount
    );
    switchboardEd25519Indexes.add(index);
  }

  for (let index = 0; index < finalized.length; index++) {
    const instruction = finalized[index];
    if (
      !instruction.programId.equals(QUOTE_PROGRAM_ID) ||
      instruction.data.length === 0 ||
      instruction.data[0] !== VERIFIED_UPDATE_OPCODE
    ) {
      continue;
    }

    if (instruction.data.length !== VERIFIED_UPDATE_DATA_SIZE) {
      throw new Error(
        `Invalid Switchboard verified-update instruction at index ${index}: expected ${VERIFIED_UPDATE_DATA_SIZE} data bytes.`
      );
    }

    const adjacentEd25519Index = index - 1;
    const encodedEd25519Index = instruction.data[1];
    const ed25519Index = switchboardEd25519Indexes.has(adjacentEd25519Index)
      ? adjacentEd25519Index
      : encodedEd25519Index;
    if (!switchboardEd25519Indexes.has(ed25519Index)) {
      throw new Error(
        `Invalid Switchboard managed-update instructions at index ${index}: place the verified update immediately after its Ed25519 quote instruction or provide its correct absolute index.`
      );
    }
    if (ed25519Index > MAX_QUOTE_INSTRUCTION_INDEX) {
      throw new Error(
        `Switchboard Ed25519 instruction index ${ed25519Index} exceeds the quote program's u8 limit.`
      );
    }

    instruction.data[1] = ed25519Index;
  }

  return finalized;
}

function cloneInstruction(
  instruction: web3.TransactionInstruction
): web3.TransactionInstruction {
  return new web3.TransactionInstruction({
    programId: instruction.programId,
    keys: instruction.keys.map(key => ({ ...key })),
    data: Buffer.from(instruction.data),
  });
}

function parseSwitchboardEd25519Instruction(
  instruction: web3.TransactionInstruction
): ParsedSwitchboardEd25519Instruction | null {
  if (!instruction.programId.equals(web3.Ed25519Program.programId)) {
    return null;
  }

  const data = instruction.data;
  if (
    data.length < ED25519_HEADER_SIZE ||
    !data
      .subarray(-SWITCHBOARD_QUOTE_DISCRIMINATOR.length)
      .equals(SWITCHBOARD_QUOTE_DISCRIMINATOR)
  ) {
    return null;
  }

  const signatureCount = data[0];
  if (
    signatureCount < 1 ||
    signatureCount > MAX_ED25519_SIGNATURES ||
    data[1] !== 0
  ) {
    return null;
  }

  const offsetsEnd =
    ED25519_HEADER_SIZE + signatureCount * ED25519_OFFSETS_SIZE;
  const suffixStart = data.length - signatureCount - QUOTE_METADATA_SIZE;
  if (offsetsEnd > suffixStart) {
    return null;
  }

  let messageOffset = -1;
  let messageSize = -1;
  const dataRanges: Array<[number, number]> = [];
  for (let i = 0; i < signatureCount; i++) {
    const recordOffset = ED25519_HEADER_SIZE + i * ED25519_OFFSETS_SIZE;
    const signatureOffset = data.readUInt16LE(recordOffset);
    const publicKeyOffset = data.readUInt16LE(recordOffset + 4);
    const currentMessageOffset = data.readUInt16LE(recordOffset + 8);
    const currentMessageSize = data.readUInt16LE(recordOffset + 10);

    if (i === 0) {
      messageOffset = currentMessageOffset;
      messageSize = currentMessageSize;
    } else if (
      currentMessageOffset !== messageOffset ||
      currentMessageSize !== messageSize
    ) {
      return null;
    }

    dataRanges.push(
      [signatureOffset, signatureOffset + ED25519_SIGNATURE_SIZE],
      [publicKeyOffset, publicKeyOffset + ED25519_PUBKEY_SIZE]
    );
  }

  if (
    messageOffset < offsetsEnd ||
    messageSize < QUOTE_HEADER_SIZE ||
    (messageSize - QUOTE_HEADER_SIZE) % QUOTE_FEED_INFO_SIZE !== 0 ||
    messageOffset + messageSize !== suffixStart
  ) {
    return null;
  }

  dataRanges.sort((a, b) => a[0] - b[0]);
  let previousEnd = offsetsEnd;
  for (const [start, end] of dataRanges) {
    if (start < previousEnd || end > messageOffset) {
      return null;
    }
    previousEnd = end;
  }

  return { signatureCount };
}

function setCurrentInstructionReferences(
  data: Buffer,
  signatureCount: number
): void {
  for (let i = 0; i < signatureCount; i++) {
    const recordOffset = ED25519_HEADER_SIZE + i * ED25519_OFFSETS_SIZE;
    data.writeUInt16LE(ED25519_CURRENT_INSTRUCTION_INDEX, recordOffset + 2);
    data.writeUInt16LE(ED25519_CURRENT_INSTRUCTION_INDEX, recordOffset + 6);
    data.writeUInt16LE(ED25519_CURRENT_INSTRUCTION_INDEX, recordOffset + 12);
  }
}
