/**
 * @module @switchboard-xyz/on-demand
 *
 * Switchboard On-Demand Oracle SDK for Solana
 *
 * This SDK provides a complete toolkit for integrating Switchboard's
 * next-generation oracle solution into your Solana programs. On-Demand
 * oracles offer significant advantages over traditional oracle models:
 *
 * ## Key Benefits
 *
 * - **90% Lower Costs**: Eliminate crank turner fees and reduce transaction size
 * - **Sub-second Latency**: Get fresh price updates with minimal delay
 * - **No Maintenance**: No need to manage feed accounts or crank turners
 * - **Flexible Integration**: Use bundles for efficiency or feeds for persistence
 *
 * ## Architecture Overview
 *
 * Switchboard On-Demand uses a pull-based model where oracle data is fetched
 * on-demand rather than continuously pushed on-chain:
 *
 * 1. **Oracle Operators**: Sign price data off-chain with low latency
 * 2. **Crossbar Network**: Distributes signed data to consumers
 * 3. **Bundle Verification**: On-chain verification ensures data authenticity
 * 4. **Your Program**: Consumes verified prices in your business logic
 *
 * ## Quick Start
 *
 * ### Bundle-Based Updates (Recommended)
 *
 * ```typescript
 * import * as sb from '@switchboard-xyz/on-demand';
 *
 * // Fetch and verify price in your transaction
 * const pullIx = await queue.fetchQuoteIx(
 *   gateway,
 *   crossbar,
 *   ['0xabc123...'], // Feed hashes
 *   {
 *     numSignatures: 1,
 *     variableOverrides: {},
 *     instructionIdx: 0
 *   }
 * );
 *
 * // Add to your transaction
 * const tx = await sb.asV0Tx({
 *   connection,
 *   ixs: [pullIx, yourProgramIx],
 *   signers: [keypair],
 * });
 * ```
 *
 * ### Current Feed-Hash Updates
 *
 * ```typescript
 * import * as sb from '@switchboard-xyz/on-demand';
 * import { CrossbarClient } from '@switchboard-xyz/common';
 *
 * const crossbar = CrossbarClient.default();
 * const queue = await sb.Queue.loadDefault(program);
 * const feedHash = '0xef0d8b6fcd0104e3e75096912fc8e1e432893da4f18faedaacca7e5875da620f';
 *
 * // Derive the quote-program account for reading after the managed update lands.
 * const [quoteAccount] = sb.OracleQuote.getCanonicalPubkey(queue.pubkey, [feedHash]);
 *
 * // Fetch Ed25519 verification and quote-program update instructions.
 * const updateIxs = await queue.fetchManagedUpdateIxs(crossbar, [feedHash], {
 *   numSignatures: 3,
 *   payer: payer.publicKey,
 * });
 * ```
 *
 * Classic PullFeed account updates use legacy compatibility APIs such as
 * `PullFeed.fetchUpdateIx()` and require queue/gateway support for the
 * backward-compatible secp256k1 flow.
 *
 * ## Core Concepts
 *
 * - **Queue**: Contains authorized oracle signers and configuration
 * - **Feed**: On-chain account storing price history (optional)
 * - **Bundle**: Signed oracle data passed directly to your program
 * - **Crossbar**: High-performance network for oracle data delivery
 *
 * @packageDocumentation
 */

import { InstructionUtils } from './instruction-utils/index.js';

export * from './accounts/index.js';
export * from './anchor-utils/index.js';
export * from './classes/index.js';
export * from './constants.js';
export * from './event-utils/index.js';
export * as EVM from './evm/index.js';
export * from './instruction-utils/index.js';
export * from './oracle-interfaces/index.js';
export * from './randomness-inspection.js';
export * from './sysvars/index.js';
export * from './utils/index.js';
// export type {
//   SignatureAuthConfig,
//   SignedAuthData,
// } from './utils/signatureAuth.js';
// export { SignatureAuth } from './utils/signatureAuth.js';

/**
 * Convenience function for creating versioned transactions
 *
 * This is an alias for `InstructionUtils.asV0TxWithComputeIxs` that
 * automatically adds compute budget instructions and uses address
 * lookup tables for optimal transaction size.
 *
 * @example
 * ```typescript
 * const tx = await asV0Tx({
 *   connection,
 *   ixs: [updateIx, userIx],
 *   signers: [payer],
 *   computeUnitPrice: 10_000,
 *   computeUnitLimitMultiple: 1.3,
 * });
 * ```
 */
export const asV0Tx = InstructionUtils.asV0TxWithComputeIxs;
