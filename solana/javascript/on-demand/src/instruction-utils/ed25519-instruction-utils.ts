import { web3 } from '@coral-xyz/anchor-31';
import { NonEmptyArrayUtils } from '@switchboard-xyz/common';

// The serialized size of an ED25519 signature
const ED25519_SIGNATURE_SERIALIZED_SIZE = 64;
// The serialized size of an ED25519 pubkey
const ED25519_PUBKEY_SERIALIZED_SIZE = 32;
// The serialized size of the signature offsets
const ED25519_SIGNATURE_OFFSETS_SERIALIZED_SIZE = 14;

// Message format constants
const OFFSET_FIELD_SIZE = 2; // Each offset field is 2 bytes (LE)
const SLOT_SIZE = 8; // Recent slot is 8 bytes (u64 LE)
const VERSION_SIZE = 1; // Version is 1 byte (u8)
const DISCRIMINATOR_SIZE = 4; // "SBOD" discriminator
const ORACLE_INDEX_SIZE = 1; // Each oracle index is 1 byte
const PADDING_SIZE = 1; // Single padding byte in instruction format
const MAX_ED25519_SIGNATURES = 8;
const MAX_U8 = 0xff;
const MAX_U16 = 0xffff;

/**
 * Solana Ed25519 precompile sentinel for reading data from the current
 * Ed25519 instruction rather than an absolute transaction instruction index.
 */
export const ED25519_CURRENT_INSTRUCTION_INDEX = MAX_U16;

export type Ed25519Signature = {
  pubkey: Buffer; // 32-byte ED25519 public key
  signature: Buffer; // 64-byte ED25519 signature
  message: Buffer; // Variable length message (no 32-byte constraint!)
  oracleIdx: number; // Index of the oracle in the queue
};

export class Ed25519InstructionUtils {
  /**
   *  Disable instantiation of the InstructionUtils class
   */
  private constructor() {}

  /**
   * Build ED25519 instruction for variable length messages
   * Unlike secp256k1, ED25519 can sign messages of any length safely
   */
  static buildEd25519Instruction(
    signatures: Ed25519Signature[],
    instructionIndex: number = ED25519_CURRENT_INSTRUCTION_INDEX,
    recentSlot?: number,
    version?: number
  ): web3.TransactionInstruction {
    // Add null/undefined check before array validation
    if (!signatures || !Array.isArray(signatures)) {
      throw new Error('Invalid `signatures` parameter: must be an array');
    }

    if (
      !Number.isInteger(instructionIndex) ||
      instructionIndex < 0 ||
      instructionIndex > MAX_U16
    ) {
      throw new Error('Invalid instruction index');
    } else if (!NonEmptyArrayUtils.safeValidate(signatures)) {
      throw new Error(
        'Invalid `signatures` array: cannot be empty. All oracles failed to provide valid signatures.'
      );
    }

    const hasRecentSlot = recentSlot !== undefined;
    const hasVersion = version !== undefined;
    if (hasRecentSlot !== hasVersion) {
      throw new Error(
        'Invalid Ed25519 quote metadata: recent slot and version must be provided together.'
      );
    }
    if (
      recentSlot !== undefined &&
      (!Number.isSafeInteger(recentSlot) || recentSlot < 0)
    ) {
      throw new Error(
        'Invalid Ed25519 quote recent slot: expected a non-negative safe integer.'
      );
    }
    if (
      version !== undefined &&
      (!Number.isInteger(version) || version < 0 || version > MAX_U8)
    ) {
      throw new Error(
        `Invalid Ed25519 quote version: expected an integer between 0 and ${MAX_U8}.`
      );
    }

    if (signatures.length > MAX_ED25519_SIGNATURES) {
      throw new Error(
        `Too many Ed25519 signatures: received ${signatures.length}, maximum supported is ${MAX_ED25519_SIGNATURES}.`
      );
    }

    const seenOracleIndexes = new Set<number>();
    for (let i = 0; i < signatures.length; i++) {
      const sig = signatures[i];
      if (
        !Buffer.isBuffer(sig.pubkey) ||
        sig.pubkey.length !== ED25519_PUBKEY_SERIALIZED_SIZE
      ) {
        throw new Error(
          `Signature at index ${i} has invalid Ed25519 pubkey length: expected ${ED25519_PUBKEY_SERIALIZED_SIZE} bytes.`
        );
      }
      if (
        !Buffer.isBuffer(sig.signature) ||
        sig.signature.length !== ED25519_SIGNATURE_SERIALIZED_SIZE
      ) {
        throw new Error(
          `Signature at index ${i} has invalid Ed25519 signature length: expected ${ED25519_SIGNATURE_SERIALIZED_SIZE} bytes.`
        );
      }
      if (!Buffer.isBuffer(sig.message)) {
        throw new Error(`Signature at index ${i} has invalid message buffer.`);
      }
      if (sig.message.length > MAX_U16) {
        throw new Error(
          `Signature at index ${i} has invalid message length: maximum supported is ${MAX_U16} bytes.`
        );
      }
      if (
        !Number.isInteger(sig.oracleIdx) ||
        sig.oracleIdx < 0 ||
        sig.oracleIdx > MAX_U8
      ) {
        throw new Error(
          `Signature at index ${i} has invalid oracleIdx: expected an integer between 0 and ${MAX_U8}.`
        );
      }
      if (seenOracleIndexes.has(sig.oracleIdx)) {
        throw new Error(
          `Duplicate oracleIdx ${sig.oracleIdx} in Ed25519 signatures.`
        );
      }
      seenOracleIndexes.add(sig.oracleIdx);
    }

    // Sort signatures by oracleIdx to match queue order - CRITICAL for verification
    // The Rust verification code expects signatures in the same order as oracle_keys
    const sortedSignatures = [...signatures].sort(
      (a, b) => a.oracleIdx - b.oracleIdx
    );

    const diffIdx = sortedSignatures.findIndex(
      sig => !sig.message.equals(sortedSignatures[0].message)
    );
    if (diffIdx !== -1) {
      throw new Error(
        'All signatures must share the same message. ' +
          `Signature at index ${diffIdx} differs from the first signature.`
      );
    }

    const commonMessage = sortedSignatures[0].message;
    const commonMessageSize = commonMessage.length;

    const numSignatures = sortedSignatures.length;
    const offsetsStart = ORACLE_INDEX_SIZE + PADDING_SIZE;
    const dataStart =
      offsetsStart + numSignatures * ED25519_SIGNATURE_OFFSETS_SERIALIZED_SIZE;
    const signatureOffset = dataStart;
    const pubkeyOffset =
      signatureOffset + numSignatures * ED25519_SIGNATURE_SERIALIZED_SIZE;
    const messageOffset =
      pubkeyOffset + numSignatures * ED25519_PUBKEY_SERIALIZED_SIZE;

    const signatureOffsets: Uint8Array[] = [];

    for (let i = 0; i < sortedSignatures.length; i++) {
      // Create a new Uint8Array to store the signature offsets
      const offsetsBytes = new Uint8Array(
        ED25519_SIGNATURE_OFFSETS_SERIALIZED_SIZE
      );
      let position = 0;

      // Calculate offsets for this signature (for multiple signatures, adjust accordingly)
      const currentSignatureOffset =
        signatureOffset + i * ED25519_SIGNATURE_SERIALIZED_SIZE;
      const currentPubkeyOffset =
        pubkeyOffset + i * ED25519_PUBKEY_SERIALIZED_SIZE;

      // Write signature offset (2 bytes LE)
      offsetsBytes.set(writeUInt16LE(currentSignatureOffset), position);
      position += OFFSET_FIELD_SIZE;

      // Write signature instruction index (2 bytes LE) - changed from 1 byte to 2 bytes!
      offsetsBytes.set(writeUInt16LE(instructionIndex), position);
      position += OFFSET_FIELD_SIZE;

      // Write pubkey offset (2 bytes LE)
      offsetsBytes.set(writeUInt16LE(currentPubkeyOffset), position);
      position += OFFSET_FIELD_SIZE;

      // Write pubkey instruction index (2 bytes LE) - changed from 1 byte to 2 bytes!
      offsetsBytes.set(writeUInt16LE(instructionIndex), position);
      position += OFFSET_FIELD_SIZE;

      // Write message offset (2 bytes LE)
      offsetsBytes.set(writeUInt16LE(messageOffset), position);
      position += OFFSET_FIELD_SIZE;

      // Write message size (2 bytes LE)
      offsetsBytes.set(writeUInt16LE(commonMessageSize), position);
      position += OFFSET_FIELD_SIZE;

      // Write message instruction index (2 bytes LE) - changed from 1 byte to 2 bytes!
      offsetsBytes.set(writeUInt16LE(instructionIndex), position);

      // Append the signature offsets to the list of signature offsets
      signatureOffsets.push(offsetsBytes);
    }

    const metadataSize =
      recentSlot !== undefined && version !== undefined
        ? SLOT_SIZE + VERSION_SIZE + DISCRIMINATOR_SIZE
        : 0;
    const totalSize =
      messageOffset + commonMessage.length + numSignatures + metadataSize;
    const instrData = new Uint8Array(totalSize);
    let position = 0;

    // 1. Write count byte
    instrData[position] = numSignatures;
    position += ORACLE_INDEX_SIZE;

    // 2. Write padding byte
    instrData[position] = 0;
    position += PADDING_SIZE;

    // 3. Write offsets area
    for (const offs of signatureOffsets) {
      instrData.set(offs, position);
      position += ED25519_SIGNATURE_OFFSETS_SERIALIZED_SIZE;
    }

    // 4. Write signature blocks at correct offsets
    for (let i = 0; i < sortedSignatures.length; i++) {
      const sig = sortedSignatures[i];
      const currentSignatureOffset =
        signatureOffset + i * ED25519_SIGNATURE_SERIALIZED_SIZE;
      const currentPubkeyOffset =
        pubkeyOffset + i * ED25519_PUBKEY_SERIALIZED_SIZE;

      instrData.set(sig.signature, currentSignatureOffset);
      instrData.set(sig.pubkey, currentPubkeyOffset);
    }

    // 5. Write common message at message offset
    instrData.set(commonMessage, messageOffset);

    // 6. append a list of bytes for all oracle indexes
    const oracleIndexes = new Uint8Array(numSignatures);
    for (let i = 0; i < numSignatures; i++) {
      oracleIndexes[i] = sortedSignatures[i].oracleIdx;
    }
    instrData.set(oracleIndexes, messageOffset + commonMessage.length);

    // 7. Append recent_slot and version (NEW FORMAT)
    if (recentSlot !== undefined && version !== undefined) {
      const slotOffset = messageOffset + commonMessage.length + numSignatures; // After oracle indexes
      const versionOffset = slotOffset + SLOT_SIZE;

      // Write recent_slot as little-endian u64 (8 bytes)
      const slotBuffer = Buffer.alloc(SLOT_SIZE);
      slotBuffer.writeBigUInt64LE(BigInt(recentSlot), 0);
      instrData.set(slotBuffer, slotOffset);

      // Write version as u8 (1 byte)
      instrData[versionOffset] = version;

      const discriminatorOffset = versionOffset + 1;
      const discriminator = Buffer.from('SBOD');
      instrData.set(discriminator, discriminatorOffset);
    }

    return new web3.TransactionInstruction({
      programId: web3.Ed25519Program.programId,
      data: Buffer.from(instrData),
      keys: [],
    });
  }
}

function writeUInt16LE(value: number): Uint8Array {
  const arr = new Uint8Array(OFFSET_FIELD_SIZE);
  arr[0] = value & 0xff;
  arr[1] = (value >> 8) & 0xff;
  return arr;
}
