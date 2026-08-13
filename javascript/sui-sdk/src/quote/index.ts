// Third-party imports first, sorted alphabetically by package
// Local imports last
import type { CommonOptions, QueueData, SwitchboardClient } from '../index.js';
import {
  getFieldsFromObject,
  ObjectParsingHelper,
  Queue,
  suiQueueCache,
} from '../index.js';

import type { MoveValue } from '@mysten/sui/client';
import type {
  Transaction,
  TransactionArgument,
  TransactionResult,
} from '@mysten/sui/transactions';
import {
  fromBase64,
  fromHex,
  SUI_CLOCK_OBJECT_ID,
  SUI_TYPE_ARG,
  toHex,
} from '@mysten/sui/utils';
import type { BN } from '@switchboard-xyz/common';
import {
  AxiosUtils,
  CrossbarClient,
  V2UpdateResponse,
} from '@switchboard-xyz/common';
import bs58 from 'bs58';

// Queue IDs for Switchboard On-Demand Surge integration
export const MAINNET_QUEUE_ID =
  '0x6e43354b8ea2dfad98eadb33db94dcc9b1175e70ee82e42abc605f6b7de9e910';
export const TESTNET_QUEUE_ID =
  '0xe645d8979dac2fb901fb7c7b0ef3c9fad5dfaaf7ae2b0ce38a0b5ec63b819a99';

// Sui Oracle mapping: oracle_key (hex) -> oracle_id
interface SuiOracleMapping {
  oracle_id: string;
  oracle_key: string;
}

export interface SurgeRawGatewayResponse {
  type: string;
  feed_bundle_id?: string;
  feed_values?: Array<{
    value: string;
    feed_hash: string;
    symbol?: string;
    source?: string;
  }>;
  oracle_response?: {
    oracle_pubkey: string;
    eth_address: string;
    signature: string;
    checksum: string;
    recovery_id: number;
    oracle_idx: number;
    timestamp: number;
    timestamp_ms?: number;
    recent_hash: string;
    slot: number;
    ed25519_enclave_signer?: string;
  };
  source_ts_ms: number;
  seen_at_ts_ms: number;
  triggered_on_price_change: boolean;
  message?: string;
}

export const suiOracleMappingCache = new Map<string, string>(); // oracle_key -> oracle_id
export let lastSuiOracleFetch = 0;
export const SUI_ORACLE_CACHE_TTL = 1000 * 60 * 10; // 10 minute cache (they don't change often)

/**
 * Fetch Sui oracle mappings from Crossbar API
 */
export async function fetchSuiOracleMappings(
  forceRefresh: boolean = false,
  crossbarUrl: string = 'https://crossbar.switchboard.xyz'
): Promise<Map<string, string>> {
  const now = Date.now();

  // Return cached mappings if still valid
  if (
    !forceRefresh &&
    suiOracleMappingCache.size > 0 &&
    now - lastSuiOracleFetch < SUI_ORACLE_CACHE_TTL
  ) {
    return suiOracleMappingCache;
  }

  try {
    const response = await AxiosUtils.fetch(`${crossbarUrl}/oracles/sui`);
    const oracles: SuiOracleMapping[] = await response.json();

    // Clear old cache
    suiOracleMappingCache.clear();

    // Build new mapping: oracle_key -> oracle_id
    for (const oracle of oracles) {
      suiOracleMappingCache.set(oracle.oracle_key, oracle.oracle_id);
    }

    lastSuiOracleFetch = now;
    console.log(`Loaded ${suiOracleMappingCache.size} Sui oracle mappings`);

    return suiOracleMappingCache;
  } catch (error) {
    console.error('Failed to fetch Sui oracle mappings:', error);
    return suiOracleMappingCache; // Return stale cache on error
  }
}

/**
 * Convert oracle key (hex) to Sui oracle ID
 */
export async function getOracleIdFromKey(
  oracleKey: string,
  forceRefresh: boolean = false,
  crossbarUrl?: string
): Promise<string | undefined> {
  const mapping = await fetchSuiOracleMappings(forceRefresh, crossbarUrl);

  console.log('🔍 Oracle key:', oracleKey);

  return mapping.get(oracleKey);
}

/**
 * Convert base58 address to hex string
 */
export function base58ToHex(base58Address: string): string {
  return Buffer.from(bs58.decode(base58Address)).toString('hex');
}

export interface QuoteVerifierInitParams extends CommonOptions {
  queue: string;
}

export interface QuoteFetchUpdateParams extends CommonOptions {
  feedHashes: string[];
  crossbarUrl?: string;
  crossbarClient?: CrossbarClient;
  feeCoin?: TransactionArgument;
  feeType?: string;
  numOracles?: number;
}

export interface QuoteData {
  id: string;
  quotes: Map<string, QuoteEntry>;
  queue: string;
}

export interface QuoteEntry {
  feedHash: string;
  value: BN;
  timestamp: number;
  slot: number;
}

export interface QuoteVerifierMoveFields {
  id: MoveValue;
  quotes: MoveValue;
  queue: MoveValue;
  [key: string]: MoveValue;
}

export interface QuoteUpdateResponse {
  feedHashes: string[];
  values: string[];
  valuesNeg: boolean[];
  minOracleSamples: number[];
  signatures: string[];
  slot: number;
  timestampSeconds: number;
  oracleIds: string[];
  queueId: string;
}

interface QuoteFeeResolution {
  feeCoin?: TransactionArgument;
  feeType?: string;
}

export class Quote {
  constructor(
    readonly client: SwitchboardClient,
    readonly address: string
  ) {}

  /**
   * Create a new Quote Verifier
   * @param client - SuiClient
   * @param tx - Transaction
   * @param options - QuoteVerifierInitParams
   * @constructor
   */
  public static async createVerifierTx(
    client: SwitchboardClient,
    tx: Transaction,
    options: QuoteVerifierInitParams
  ) {
    const { switchboardAddress } = await client.fetchState(options);

    return tx.moveCall({
      target: `${switchboardAddress}::quote::new_verifier`,
      arguments: [tx.pure.id(options.queue)],
    });
  }

  /**
   * Fetch quote update using CrossbarClient v2 update route
   * @param client - SwitchboardClient
   * @param tx - Transaction
   * @param options - QuoteFetchUpdateParams
   * @returns Promise with the move call result - a Quotes object from the move call
   */
  public static async fetchUpdateQuote(
    client: SwitchboardClient,
    tx: Transaction,
    options: QuoteFetchUpdateParams
  ): Promise<TransactionResult> {
    const { switchboardAddress, mainnet, oracleQueueId } =
      await client.fetchState(options);

    // Initialize CrossbarClient
    const crossbarClient =
      options.crossbarClient ??
      new CrossbarClient(
        options.crossbarUrl ?? 'https://crossbar.switchboard.xyz'
      );

    // Fetch v2 update data
    const updateData = await crossbarClient.fetchV2Update(options.feedHashes, {
      chain: 'sui',
      network: mainnet ? 'mainnet' : 'devnet',
      use_timestamp: true,
      num_oracles: options.numOracles,
    });

    // Process the update data
    const processedUpdate = await Quote.processV2UpdateData(updateData);

    return Quote.buildQuoteSubmitTx(
      client,
      tx,
      {
        ...options,
        oracleQueueId,
        switchboardAddress,
      },
      {
        feedHashes: processedUpdate.feedHashes,
        minOracleSamples: processedUpdate.minOracleSamples,
        oracleIds: processedUpdate.oracleIds,
        signatures: processedUpdate.signatures,
        slot: processedUpdate.slot,
        timestampSeconds: processedUpdate.timestampSeconds,
        values: processedUpdate.values,
        valuesNeg: processedUpdate.valuesNeg,
      }
    );
  }

  /**
   * Process V2 update data into format expected by Move functions
   */
  public static async processV2UpdateData(
    updateData: V2UpdateResponse
  ): Promise<QuoteUpdateResponse> {
    // Build arrays for the Move call
    const feedHashes: string[] = [];
    const values: string[] = [];
    const valuesNeg: boolean[] = [];
    const minOracleSamples: number[] = [];
    const signatures: string[] = [];
    const oracleIds: string[] = [];

    // First, collect all unique feed hashes and their data
    const feedDataMap = new Map<
      string,
      {
        value: string;
        isNegative: boolean;
        minSamples: number;
      }
    >();

    for (const oracleResponse of updateData.oracleResponses) {
      for (const feedResponse of oracleResponse.feedResponses) {
        if (!feedDataMap.has(feedResponse.feed_hash)) {
          feedDataMap.set(feedResponse.feed_hash, {
            value: feedResponse.success_value,
            isNegative: feedResponse.success_value.startsWith('-'),
            minSamples: feedResponse.min_oracle_samples,
          });
        }
      }
    }

    // Convert feed data to arrays
    for (const [feedHash, data] of Array.from(feedDataMap.entries())) {
      feedHashes.push(feedHash);
      values.push(data.value);
      valuesNeg.push(data.isNegative);
      minOracleSamples.push(data.minSamples);
    }

    // Process oracle responses for signatures and IDs
    for (const oracleResponse of updateData.oracleResponses) {
      // Use the oracle ID directly from the response
      oracleIds.push(oracleResponse.oracleId);

      // For Sui chain, oracle-level signatures are already recovery-id appended
      // Convert from hex string to hex (it's already in hex format)
      signatures.push(oracleResponse.signature);
    }

    return {
      feedHashes,
      values,
      valuesNeg,
      minOracleSamples,
      signatures,
      slot: updateData.slot,
      timestampSeconds: updateData.timestamp,
      oracleIds,
      queueId: updateData.queue || '', // Queue ID from top-level response
    };
  }

  /**
   * Select the appropriate run function based on oracle count
   */
  private static selectRunFunction(
    oracleCount: number,
    withFee: boolean = false
  ): string {
    if (oracleCount < 1 || oracleCount > 6) {
      throw new Error(
        `Invalid oracle count: ${oracleCount}. Must be between 1 and 6.`
      );
    }
    return withFee ? `run_${oracleCount}_with_fee` : `run_${oracleCount}`;
  }

  private static getFeeCoinType(typeArg: string): string {
    return `0x2::coin::Coin<${typeArg}>`;
  }

  private static async loadQueueData(
    client: SwitchboardClient,
    queueId: string
  ): Promise<QueueData> {
    let queue = suiQueueCache.get(queueId);
    if (!queue) {
      queue = await new Queue(client, queueId).loadData();
      suiQueueCache.set(queueId, queue);
    }

    return queue;
  }

  private static async resolveQuoteFee(
    client: SwitchboardClient,
    tx: Transaction,
    queueId: string,
    options?: Pick<QuoteFetchUpdateParams, 'feeCoin' | 'feeType'>
  ): Promise<QuoteFeeResolution> {
    const queue = await Quote.loadQueueData(client, queueId);

    if (queue.fee === 0) {
      return {};
    }

    if (queue.feeTypes.includes(Quote.getFeeCoinType(SUI_TYPE_ARG))) {
      const [feeCoin] = tx.splitCoins(tx.gas, [queue.fee]);
      return {
        feeCoin,
        feeType: SUI_TYPE_ARG,
      };
    }

    if (!options?.feeCoin || !options.feeType) {
      throw new Error(
        `Queue ${queueId} requires a non-SUI fee coin. Provide both feeCoin and feeType.`
      );
    }

    if (!queue.feeTypes.includes(Quote.getFeeCoinType(options.feeType))) {
      throw new Error(
        `Fee type ${options.feeType} is not accepted by queue ${queueId}.`
      );
    }

    return {
      feeCoin: options.feeCoin,
      feeType: options.feeType,
    };
  }

  public static async buildQuoteSubmitTx(
    client: SwitchboardClient,
    tx: Transaction,
    options: Pick<QuoteFetchUpdateParams, 'feeCoin' | 'feeType'> & {
      oracleQueueId: string;
      switchboardAddress: string;
    },
    processedUpdate: Omit<QuoteUpdateResponse, 'queueId'>
  ): Promise<TransactionResult> {
    const feeResolution = await Quote.resolveQuoteFee(
      client,
      tx,
      options.oracleQueueId,
      options
    );
    const runFunction = Quote.selectRunFunction(
      processedUpdate.oracleIds.length,
      Boolean(feeResolution.feeCoin)
    );
    const oracleArgs = processedUpdate.oracleIds.map(id => tx.object(id));
    const argumentsList: TransactionArgument[] = [
      tx.pure.vector(
        'vector<u8>',
        processedUpdate.feedHashes.map(hash => Array.from(fromHex(hash)))
      ),
      tx.pure.vector('u128', processedUpdate.values),
      tx.pure.vector('bool', processedUpdate.valuesNeg),
      tx.pure.vector('u8', processedUpdate.minOracleSamples),
      tx.pure.vector(
        'vector<u8>',
        processedUpdate.signatures.map(sig => Array.from(fromHex(sig)))
      ),
      tx.pure.u64(processedUpdate.slot),
      tx.pure.u64(processedUpdate.timestampSeconds),
      ...oracleArgs,
      tx.object(options.oracleQueueId),
      tx.object(SUI_CLOCK_OBJECT_ID),
    ];

    if (feeResolution.feeCoin) {
      argumentsList.push(feeResolution.feeCoin);
    }

    return tx.moveCall({
      target: `${options.switchboardAddress}::quote_submit_action::${runFunction}`,
      arguments: argumentsList,
      ...(feeResolution.feeType
        ? { typeArguments: [feeResolution.feeType] }
        : {}),
    });
  }

  /**
   * Get the quote verifier data object
   */
  public async loadData(): Promise<QuoteData> {
    const quoteData = (await this.client.client
      .getObject({
        id: this.address,
        options: {
          showContent: true,
          showType: false,
        },
      })
      .then(getFieldsFromObject)) as QuoteVerifierMoveFields;

    // Build the data object
    const data: QuoteData = {
      id: ObjectParsingHelper.asId(quoteData.id),
      quotes: new Map(), // TODO: Parse quotes table if needed
      queue: ObjectParsingHelper.asString(quoteData.queue),
    };

    return data;
  }
}

/**
 * Standalone function to fetch quote updates
 * @param client - SwitchboardClient
 * @param feedHashes - Array of feed hashes to fetch
 * @param options - Optional parameters
 * @returns Promise with processed quote update data
 */
export async function fetchQuoteUpdate(
  client: SwitchboardClient,
  feedHashes: string[],
  transaction: Transaction,
  options?: Omit<QuoteFetchUpdateParams, 'feedHashes'>
): Promise<TransactionResult> {
  return Quote.fetchUpdateQuote(client, transaction, {
    feedHashes,
    ...options,
  });
}

/**
 * Emit a quote verified event
 * @param client - SwitchboardClient
 * @param feedHashes - Array of feed hashes to fetch
 * @param transaction - Transaction
 * @param options - Optional parameters
 * @returns Promise with the move call result - a Quotes object from the move call
 */
export async function emitQuoteVerified(
  client: SwitchboardClient,
  feedHashes: string[],
  transaction: Transaction,
  options?: Omit<QuoteFetchUpdateParams, 'feedHashes'>
): Promise<TransactionResult> {
  const { switchboardAddress } = await client.fetchState(options);
  const quotes = await Quote.fetchUpdateQuote(client, transaction, {
    feedHashes,
    ...options,
  });
  return transaction.moveCall({
    target: `${switchboardAddress}::quote_emit_result_action::run`,
    arguments: [quotes],
  });
}

/**
 * Convert a Surge update to Quotes format for Sui transactions
 * @param sb - SwitchboardClient
 * @param tx - Transaction to add the move call to
 * @param surgeUpdate - The SurgeUpdate from Switchboard Surge
 * @param options - CommonOptions & { crossbarUrl?: string }
 * @returns TransactionResult with the formatted quotes ready for use
 */
export async function convertSurgeUpdateToQuotes(
  sb: SwitchboardClient,
  tx: Transaction,
  surgeUpdate: SurgeRawGatewayResponse,
  options?: CommonOptions & {
    crossbarUrl?: string;
    feeCoin?: TransactionArgument;
    feeType?: string;
  }
): Promise<TransactionResult> {
  const { switchboardAddress, oracleQueueId } = await sb.fetchState(options);

  // Extract feed data
  const feedHashes =
    surgeUpdate.feed_values?.map(value => value.feed_hash) ?? [];
  const values = surgeUpdate.feed_values?.map(value => value.value) ?? [];
  const timestampSeconds = surgeUpdate.oracle_response?.timestamp ?? 0;
  const slot = surgeUpdate.oracle_response?.slot ?? 0;
  const signature = surgeUpdate.oracle_response?.signature ?? '';
  const recoveryId = surgeUpdate.oracle_response?.recovery_id ?? 0;
  const oraclePubkey = surgeUpdate.oracle_response?.oracle_pubkey ?? '';

  // Oracle pubkey is already in hex format from surge update
  const oracleKeyHex = appendHexPrefix(oraclePubkey);
  const oracleId = await getOracleIdFromKey(
    oracleKeyHex,
    false,
    options?.crossbarUrl
  );

  if (!oracleId) {
    throw new Error(`Oracle ID not found for oracle key: ${oracleKeyHex}`);
  }

  // Convert signature from base64 to hex and append recovery ID
  const signatureHex = toHex(fromBase64(signature));
  const recoveryIdHex = recoveryId.toString(16).padStart(2, '0');
  const fullSignatureHex = `${signatureHex}${recoveryIdHex}`;

  // Convert to array format for Move call
  const processedValues: string[] = [];
  const valuesNeg: boolean[] = [];
  const minOracleSamples: number[] = [];

  for (const value of values) {
    const bigIntValue = BigInt(value);
    const isNegative = bigIntValue < BigInt(0);

    processedValues.push(isNegative ? value.substring(1) : value);
    valuesNeg.push(isNegative);
    minOracleSamples.push(1); // Surge provides single oracle data
  }

  return Quote.buildQuoteSubmitTx(
    sb,
    tx,
    {
      feeCoin: options?.feeCoin,
      feeType: options?.feeType,
      oracleQueueId,
      switchboardAddress,
    },
    {
      feedHashes,
      minOracleSamples,
      oracleIds: [oracleId],
      signatures: [fullSignatureHex],
      slot,
      timestampSeconds,
      values: processedValues,
      valuesNeg,
    }
  );
}

/**
 * Emit a surge update as a quote on Sui
 * @param sb - SwitchboardClient
 * @param surgeUpdate - The SurgeUpdate from Switchboard Surge
 * @param options - CommonOptions & { crossbarUrl?: string }
 * @returns Promise with the transaction result
 */
export async function emitSurgeQuote(
  sb: SwitchboardClient,
  transaction: Transaction,
  surgeUpdate: SurgeRawGatewayResponse,
  options?: CommonOptions & {
    crossbarUrl?: string;
    feeCoin?: TransactionArgument;
    feeType?: string;
  }
): Promise<TransactionResult> {
  const { switchboardAddress } = await sb.fetchState(options);

  // Convert surge update to quotes
  const quotes = await convertSurgeUpdateToQuotes(
    sb,
    transaction,
    surgeUpdate,
    options
  );

  return transaction.moveCall({
    target: `${switchboardAddress}::quote_emit_result_action::run`,
    arguments: [quotes],
  });
}

function appendHexPrefix(hex: string): string {
  return hex.startsWith('0x') ? hex : `0x${hex}`;
}
