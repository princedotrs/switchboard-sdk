// Third-party imports first, sorted alphabetically by package
// Local imports last
import type { CommonOptions, OracleData, SwitchboardClient } from '../index.js';
import {
  getFieldsFromObject,
  ObjectParsingHelper,
  Oracle,
  Queue,
  suiQueueCache,
} from '../index.js';

import type { MoveValue } from '@mysten/sui/client';
import type { SuiGraphQLClient } from '@mysten/sui/graphql';
import { graphql } from '@mysten/sui/graphql/schemas/2024.4';
import type { Transaction } from '@mysten/sui/transactions';
import {
  fromBase64,
  fromHex,
  SUI_CLOCK_OBJECT_ID,
  SUI_TYPE_ARG,
  toBase58,
  toHex,
} from '@mysten/sui/utils';
import type { BN } from '@switchboard-xyz/common';
import { CrossbarClient, OracleJob } from '@switchboard-xyz/common';
import { LegacyCrossbarClient } from '@switchboard-xyz/common-legacy';

export interface AggregatorInitParams extends CommonOptions {
  authority: string;
  name: string;
  feedHash: string;
  minSampleSize: number;
  maxStalenessSeconds: number;
  maxVariance: number;
  minResponses: number;
}

export interface AggregatorConfigParams extends CommonOptions {
  aggregator: string;
  name: string;
  feedHash: string;
  minSampleSize: number;
  maxStalenessSeconds: number;
  maxVariance: number;
  minResponses: number;
}

export interface AggregatorSetAuthorityParams extends CommonOptions {
  aggregator: string;
  newAuthority: string;
}

export interface AggregatorConfigs {
  feedHash: string;
  maxVariance: number;
  minResponses: number;
  minSampleSize: number;
}

export interface AggregatorFetchUpdateIxParams extends CommonOptions {
  solanaRPCUrl?: string;
  crossbarUrl?: string;
  crossbarClient?: LegacyCrossbarClient;

  // If passed in, Sui Aggregator load can be skipped
  feedConfigs?: AggregatorConfigs;

  // If passed in, Sui Queue load can be skipped
  queue?: Queue;

  // If passed in, Crossbar load can be skipped
  jobs?: OracleJob[];
}

export interface AggregatorFetchUpdateTxParams
  extends CommonOptions,
    AggregatorFetchManyUpdateTxParams {}

export interface AggregatorFetchManyUpdateTxParams {
  crossbarClient?: CrossbarClient;
  crossbarUrl?: string;
  maxRetries?: number;
  retryDelayMs?: number;
  minResponsesRequired?: number;
  variableOverrides?: Record<string, string>;
}

export interface CurrentResultData {
  maxResult: BN;
  maxTimestamp: number;
  mean: BN;
  minResult: BN;
  minTimestamp: number;
  range: BN;
  result: BN;
  stdev: BN;
}

export interface Update {
  oracle: string;
  value: BN;
  timestamp: number;
}

export interface AggregatorData {
  id: string;
  authority: string;
  createdAtMs: number;
  currentResult: CurrentResultData;
  feedHash: string;
  maxStalenessSeconds: number;
  maxVariance: number;
  minResponses: number;
  minSampleSize: number;
  name: string;
  queue: string;
  updateState: {
    currIdx: number;
    results: Update[];
  };
}

export interface FetchUpdateResponse {
  results: FeedResponse[];
  feedConfigs: AggregatorConfigs;
  queue: string;
  fee: number;
  failures: string[];
}

export interface FeedResponse {
  successValue: string;
  isNegative: boolean;
  timestamp: number;
  oracleId: string;
  signature: string;
}

function normalizeHex(value: string) {
  return value.replace(/^0x/i, '').toLowerCase();
}

function normalizeSuiObjectId(value: string) {
  const normalized = normalizeHex(value);
  if (!/^[0-9a-f]+$/.test(normalized) || normalized.length > 64) {
    throw new Error('invalid_object_id');
  }
  return normalized.padStart(64, '0');
}

function validateNonzeroHex(value: string, byteLength: number) {
  const normalized = normalizeHex(value);
  if (normalized.length !== byteLength * 2 || !/^[0-9a-f]+$/.test(normalized)) {
    return 'wrong_length';
  }
  return /^0+$/.test(normalized) ? 'zero' : null;
}

function validateOracleMapping(
  oracle: OracleData,
  oracleQueueId: string,
  currentOracleIds: Set<string>,
  nowMs: number
) {
  const oracleId = normalizeSuiObjectId(oracle.id);
  if (!currentOracleIds.has(oracleId)) return 'off_queue';
  if (
    normalizeSuiObjectId(oracle.queue) !== normalizeSuiObjectId(oracleQueueId)
  )
    return 'queue_mismatch';

  const signerError = validateNonzeroHex(oracle.secp256k1Key, 64);
  if (signerError) return `signer_${signerError}`;

  const measurementError = validateNonzeroHex(oracle.mrEnclave, 32);
  if (measurementError) return `measurement_${measurementError}`;

  if (!Number.isFinite(oracle.expirationTime) || oracle.expirationTime <= nowMs)
    return 'expired';

  return null;
}

async function fetchSuiUpdatesWithOverrides(
  crossbarClient: CrossbarClient,
  network: string,
  aggregatorIds: string[],
  variableOverrides: Record<string, string>
): Promise<{ responses: FetchUpdateResponse[]; failures: string[] }> {
  const addressesParam = aggregatorIds.join(',');
  const response = await fetch(
    `${crossbarClient.crossbarUrl}/updates/sui/${network}/${addressesParam}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ variableOverrides }),
    }
  );

  if (!response.ok) {
    throw new Error(
      `Bad Crossbar fetchSuiUpdates response: ${response.status}`
    );
  }

  return (await response.json()) as {
    responses: FetchUpdateResponse[];
    failures: string[];
  };
}

export interface CurrentResultFields {
  max_result: MoveValue;
  max_timestamp_ms: MoveValue;
  mean: MoveValue;
  min_result: MoveValue;
  min_timestamp_ms: MoveValue;
  range: MoveValue;
  result: MoveValue;
  stdev: MoveValue;
}

export interface UpdateResultFields {
  oracle: MoveValue;
  result: { fields: MoveValue };
  timestamp_ms: MoveValue;
}

export interface UpdateStateFields {
  curr_idx: MoveValue;
  results: Array<{ fields: UpdateResultFields }>;
}

export interface AggregatorMoveFields {
  id: MoveValue;
  authority: MoveValue;
  created_at_ms: MoveValue;
  current_result: MoveValue;
  update_state: MoveValue;
  feed_hash: MoveValue;
  max_staleness_seconds: MoveValue;
  max_variance: MoveValue;
  min_responses: MoveValue;
  min_sample_size: MoveValue;
  name: MoveValue;
  queue: MoveValue;
  [key: string]: MoveValue;
}

export interface GraphQLJsonResult {
  id: string;
  authority: string;
  created_at_ms: MoveValue;
  current_result: {
    max_result: MoveValue;
    max_timestamp_ms: MoveValue;
    mean: MoveValue;
    min_result: MoveValue;
    min_timestamp_ms: MoveValue;
    range: MoveValue;
    result: MoveValue;
    stdev: MoveValue;
  };
  feed_hash: MoveValue;
  max_staleness_seconds: MoveValue;
  max_variance: MoveValue;
  min_responses: MoveValue;
  min_sample_size: MoveValue;
  name: MoveValue;
  queue: MoveValue;
  update_state: {
    curr_idx: MoveValue;
    results: Array<{
      oracle: string;
      result: MoveValue;
      timestamp_ms: MoveValue;
    }>;
  };
}

export interface GraphQLMoveObject {
  asMoveObject?: {
    contents?: {
      json: GraphQLJsonResult;
    };
  };
}

export class Aggregator {
  public crossbarClient?: CrossbarClient;
  public feedHash?: string;

  constructor(
    readonly client: SwitchboardClient,
    readonly address: string
  ) {}

  /**
   * Create a new Aggregator
   * @param client - SuiClient
   * @param tx - Transaction
   * @param options - AggregatorInitParams
   * @constructor
   */
  public static async initTx(
    client: SwitchboardClient,
    tx: Transaction,
    options: AggregatorInitParams
  ) {
    const { switchboardAddress, oracleQueueId } =
      await client.fetchState(options);

    tx.moveCall({
      target: `${switchboardAddress}::aggregator_init_action::run`,
      arguments: [
        tx.object(oracleQueueId),
        tx.pure.address(options.authority),
        tx.pure.string(options.name),
        tx.pure.vector('u8', Array.from(fromHex(options.feedHash))),
        tx.pure.u64(options.minSampleSize),
        tx.pure.u64(options.maxStalenessSeconds),
        tx.pure.u64(options.maxVariance),
        tx.pure.u32(options.minResponses),
        tx.object(SUI_CLOCK_OBJECT_ID),
      ],
    });
  }

  /**
   * Set configs for the Aggregator
   * @param tx - Transaction
   * @param options - AggregatorConfigParams
   */
  public async setConfigsTx(tx: Transaction, options: AggregatorConfigParams) {
    const { switchboardAddress } = await this.client.fetchState(options);

    tx.moveCall({
      target: `${switchboardAddress}::aggregator_set_configs_action::run`,
      arguments: [
        tx.object(this.address),
        tx.pure.vector('u8', Array.from(fromHex(options.feedHash))),
        tx.pure.u64(options.minSampleSize),
        tx.pure.u64(options.maxStalenessSeconds),
        tx.pure.u64(options.maxVariance),
        tx.pure.u32(options.minResponses),
      ],
    });
  }

  /**
   * Set the feed authority
   * @param tx - Transaction
   * @param options - AggregatorSetAuthorityParams
   */
  public async setAuthorityTx(
    tx: Transaction,
    options: AggregatorSetAuthorityParams
  ) {
    const { switchboardAddress } = await this.client.fetchState(options);

    tx.moveCall({
      target: `${switchboardAddress}::aggregator_set_authority_action::run`,
      arguments: [
        tx.object(this.address),
        tx.pure.address(options.newAuthority),
      ],
    });
  }

  /**
   * Get the info needed to perform a pull feed tx
   * @param options - AggregatorFetchUpdateIxParams
   * @returns FetchUpdateResponse
   */
  public async fetchUpdateInfo(
    options?: AggregatorFetchUpdateIxParams
  ): Promise<FetchUpdateResponse> {
    const { oracleQueueId, mainnet } = await this.client.fetchState(options);

    // get the feed configs if we need them / they aren't passed in
    let feedConfigs = options?.feedConfigs;
    if (!feedConfigs) {
      const aggregatorData = await this.loadData();
      feedConfigs = {
        minSampleSize: aggregatorData.minSampleSize,
        feedHash: aggregatorData.feedHash,
        maxVariance: aggregatorData.maxVariance,
        minResponses: aggregatorData.minResponses,
      };
    }

    if (options?.feedConfigs?.minSampleSize) {
      feedConfigs.minSampleSize = options.feedConfigs.minSampleSize;
    }

    // get the sui queue from cache
    let suiQueue = suiQueueCache.get(oracleQueueId);
    if (!suiQueue) {
      const queue = await new Queue(this.client, oracleQueueId).loadData();
      suiQueueCache.set(oracleQueueId, queue);
      suiQueue = queue;
    }

    // fetch the jobs from crossbar
    const crossbarClient =
      options?.crossbarClient ??
      new LegacyCrossbarClient(
        options?.crossbarUrl ?? 'https://crossbar.switchboard.xyz'
      );
    console.log(`Client initialized with url ${crossbarClient.crossbarUrl}`);

    // fetch the signatures
    const { responses, failures } = await crossbarClient.fetchSignatures(
      {
        feedHash: feedConfigs.feedHash,

        // Make this more granular in the canonical fetch signatures (within @switchboard-xyz/on-demand)
        maxVariance: Math.floor(feedConfigs.maxVariance / 1e9),
        minResponses: feedConfigs.minResponses,
        numSignatures: feedConfigs.minSampleSize,

        // blockhash checks aren't possible yet on SUI
        recentHash: toBase58(new Uint8Array(32)),
        useTimestamp: true,
      },
      mainnet ? 'mainnet' : 'testnet'
    );

    // filter out responses that don't have available oracles
    const validOracles = new Set(
      suiQueue.existingOracles.map(o => o.oracleKey)
    );

    const validResponses = responses.filter(r => {
      return validOracles.has(toBase58(fromHex(r.oracle_pubkey)));
    });

    // if we have no valid responses (or not enough), fail out
    if (
      !validResponses.length ||
      validResponses.length < feedConfigs.minSampleSize
    ) {
      // maybe retry by recursing into the same function / add a retry count
      throw new Error('Not enough valid oracle responses.');
    }

    // map the responses into the tx
    const feedResponses: FeedResponse[] = validResponses.map(response => {
      const oracle = suiQueue.existingOracles.find(
        o => o.oracleKey === toBase58(fromHex(response.oracle_pubkey))
      )!;

      const signature = Array.from(fromBase64(response.signature));
      signature.push(response.recovery_id);

      if (response.failure_error) {
        failures.push(response.failure_error);
      }

      return {
        successValue: response.success_value,
        isNegative: response.success_value.startsWith('-'),
        timestamp: response.timestamp!,
        oracleId: oracle.oracleId,
        signature: Buffer.from(signature).toString('hex'),
      };
    });

    return {
      results: feedResponses,
      feedConfigs,
      queue: suiQueue.id,
      fee: suiQueue.fee,
      failures,
    };
  }

  /**
   * Pull feed tx
   * @param tx - Transaction
   * @param options - CommonOptions
   */
  public async fetchUpdateTx(
    tx: Transaction,
    options?: AggregatorFetchUpdateTxParams
  ): Promise<{
    responses: FetchUpdateResponse[];
    failures: string[];
  }> {
    return Aggregator.fetchManyUpdateTx(
      this.client,
      [this.address],
      tx,
      options
    );
  }

  /**
   * Get the feed data object
   */
  public async loadData(): Promise<AggregatorData> {
    const aggregatorData = (await this.client.client
      .getObject({
        id: this.address,
        options: {
          showContent: true,
          showType: false,
        },
      })
      .then(getFieldsFromObject)) as AggregatorMoveFields;

    // Need to cast these to the appropriate type
    const currentResult = (
      aggregatorData.current_result as unknown as {
        fields: CurrentResultFields;
      }
    ).fields;
    const updateState = (
      aggregatorData.update_state as unknown as { fields: UpdateStateFields }
    ).fields;

    // build the data object
    const data: AggregatorData = {
      id: ObjectParsingHelper.asId(aggregatorData.id),
      authority: ObjectParsingHelper.asString(aggregatorData.authority),
      createdAtMs: ObjectParsingHelper.asNumber(aggregatorData.created_at_ms),
      currentResult: {
        maxResult: ObjectParsingHelper.asBN(currentResult.max_result),
        maxTimestamp: ObjectParsingHelper.asNumber(
          currentResult.max_timestamp_ms
        ),
        mean: ObjectParsingHelper.asBN(currentResult.mean),
        minResult: ObjectParsingHelper.asBN(currentResult.min_result),
        minTimestamp: ObjectParsingHelper.asNumber(
          currentResult.min_timestamp_ms
        ),
        range: ObjectParsingHelper.asBN(currentResult.range),
        result: ObjectParsingHelper.asBN(currentResult.result),
        stdev: ObjectParsingHelper.asBN(currentResult.stdev),
      },
      feedHash: toHex(
        ObjectParsingHelper.asUint8Array(aggregatorData.feed_hash)
      ),
      maxStalenessSeconds: ObjectParsingHelper.asNumber(
        aggregatorData.max_staleness_seconds
      ),
      maxVariance: ObjectParsingHelper.asNumber(aggregatorData.max_variance),
      minResponses: ObjectParsingHelper.asNumber(aggregatorData.min_responses),
      minSampleSize: ObjectParsingHelper.asNumber(
        aggregatorData.min_sample_size
      ),
      name: ObjectParsingHelper.asString(aggregatorData.name),
      queue: ObjectParsingHelper.asString(aggregatorData.queue),
      updateState: {
        currIdx: ObjectParsingHelper.asNumber(updateState.curr_idx),
        results: updateState.results.map(r => {
          const oracleId = ObjectParsingHelper.asString(r.fields.oracle);
          const value = ObjectParsingHelper.asBN(r.fields.result.fields);
          const timestamp = ObjectParsingHelper.asNumber(r.fields.timestamp_ms);
          return {
            oracle: oracleId,
            value,
            timestamp,
          };
        }),
      },
    };

    return data;
  }

  /**
   * Load all feeds
   */
  public static async loadAllFeeds(
    graphqlClient: SuiGraphQLClient,
    switchboardAddress: string
  ): Promise<AggregatorData[]> {
    // Query to fetch Aggregator objects with pagination supported.
    const query = graphql(`
      query($cursor: String) {
        objects(
          first: 50,
          after: $cursor,
          filter: {
            type: "${switchboardAddress}::aggregator::Aggregator"
          }
        ) {
          nodes {
            address
            digest
            asMoveObject {
              contents {
                json
              }
            }
          }
          pageInfo {
            hasNextPage
            endCursor
          }
        }
      }
    `);

    const parseAggregator = (moveObject: GraphQLJsonResult): AggregatorData => {
      return {
        id: moveObject.id,
        authority: moveObject.authority,
        createdAtMs: ObjectParsingHelper.asNumber(moveObject.created_at_ms),
        currentResult: {
          maxResult: ObjectParsingHelper.asBN(
            moveObject.current_result.max_result
          ),
          maxTimestamp: ObjectParsingHelper.asNumber(
            moveObject.current_result.max_timestamp_ms
          ),
          mean: ObjectParsingHelper.asBN(moveObject.current_result.mean),
          minResult: ObjectParsingHelper.asBN(
            moveObject.current_result.min_result
          ),
          minTimestamp: ObjectParsingHelper.asNumber(
            moveObject.current_result.min_timestamp_ms
          ),
          range: ObjectParsingHelper.asBN(moveObject.current_result.range),
          result: ObjectParsingHelper.asBN(moveObject.current_result.result),
          stdev: ObjectParsingHelper.asBN(moveObject.current_result.stdev),
        },
        feedHash: toHex(ObjectParsingHelper.asUint8Array(moveObject.feed_hash)),
        maxStalenessSeconds: ObjectParsingHelper.asNumber(
          moveObject.max_staleness_seconds
        ),
        maxVariance: ObjectParsingHelper.asNumber(moveObject.max_variance),
        minResponses: ObjectParsingHelper.asNumber(moveObject.min_responses),
        minSampleSize: ObjectParsingHelper.asNumber(moveObject.min_sample_size),
        name: ObjectParsingHelper.asString(moveObject.name),
        queue: ObjectParsingHelper.asString(moveObject.queue),
        updateState: {
          currIdx: ObjectParsingHelper.asNumber(
            moveObject.update_state.curr_idx
          ),
          results: moveObject.update_state.results.map(r => {
            const oracleId = r.oracle;
            const value = ObjectParsingHelper.asBN(r.result);
            const timestamp = ObjectParsingHelper.asNumber(r.timestamp_ms);
            return {
              oracle: oracleId,
              value,
              timestamp,
            };
          }),
        },
      };
    };

    const fetchAggregators = async (cursor: string | null) => {
      const results = await graphqlClient.query({
        query,
        variables: { cursor },
      });

      const aggregators: AggregatorData[] =
        results.data?.objects?.nodes?.map(result => {
          const moveObject = result.asMoveObject?.contents
            ?.json as GraphQLJsonResult;
          // build the data object from moveObject which looks like the above json
          return parseAggregator(moveObject);
        }) ?? [];
      const hasNextPage = results.data?.objects?.pageInfo?.hasNextPage ?? false;
      const endCursor = results.data?.objects?.pageInfo?.endCursor ?? null;

      // Recursively fetch the next page if there is one.
      if (hasNextPage) aggregators.push(...(await fetchAggregators(endCursor)));
      // Return the list of aggregators.
      return aggregators;
    };
    return await fetchAggregators(null);
  }

  //-------------------------------- Crossbar SUI Routes --------------------------------

  /**
   * Fetch updates for multiple aggregator IDs using the Crossbar update route for Sui
   * @param switchboardClient - Switchboard client
   * @param aggregatorIds - Array of aggregator IDs to fetch updates for
   * @param tx - Transaction object
   * @param options - Optional Crossbar, retry, and request-scoped variable override parameters
   * @returns Promise with the responses and failures for the specified feeds
   */
  public static async fetchManyUpdateTx(
    switchboardClient: SwitchboardClient,
    aggregatorIds: string[],
    tx: Transaction,
    options?: AggregatorFetchManyUpdateTxParams
  ): Promise<{ responses: FetchUpdateResponse[]; failures: string[] }> {
    if (!aggregatorIds || aggregatorIds.length === 0) {
      throw new Error('At least one aggregator ID is required');
    }

    const { switchboardAddress, mainnet, oracleQueueId } =
      await switchboardClient.state;

    const aggregators = await Promise.all(
      aggregatorIds.map(id => new Aggregator(switchboardClient, id).loadData())
    );

    const feedHashToAggregatorId = new Map<string, string>();
    const requiredResponses = new Map<string, number>();
    for (const aggregator of aggregators) {
      const feedHash = normalizeHex(aggregator.feedHash);
      feedHashToAggregatorId.set(feedHash, aggregator.id);
      requiredResponses.set(feedHash, Math.max(aggregator.minSampleSize, 1));
    }

    const acceptedResponses: FetchUpdateResponse[] = [];
    const acceptedOracleIds = new Map<string, Set<string>>();
    const failures: string[] = [];
    const maxRetries = options?.maxRetries ?? 3;
    const retryDelayMs = options?.retryDelayMs ?? 1000;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      const pendingAggregatorIds = aggregators
        .filter(aggregator => {
          const feedHash = normalizeHex(aggregator.feedHash);
          return (
            (acceptedOracleIds.get(feedHash)?.size ?? 0) <
            (requiredResponses.get(feedHash) ?? 1)
          );
        })
        .map(aggregator => aggregator.id);

      if (pendingAggregatorIds.length === 0) break;

      let updateResult: {
        responses: FetchUpdateResponse[];
        failures: string[];
      };
      try {
        updateResult = await this.fetchUpdateForMultiple(
          mainnet ? 'mainnet' : 'testnet',
          pendingAggregatorIds,
          { ...options, maxRetries: 0, minResponsesRequired: 1 }
        );
      } catch {
        failures.push('Crossbar request failed');
        if (attempt < maxRetries)
          await new Promise(resolve => setTimeout(resolve, retryDelayMs));
        continue;
      }

      failures.push(...updateResult.failures);

      const candidates = updateResult.responses.flatMap(response =>
        response.results
          .filter(result => result.signature !== '00' && result.successValue)
          .map(result => ({ response, result }))
      );
      const candidateOracleIds = Array.from(
        new Set(candidates.map(({ result }) => result.oracleId))
      );

      const queueData = await new Queue(
        switchboardClient,
        oracleQueueId
      ).loadData();
      const currentOracleIds = new Set(
        queueData.existingOracles.map(({ oracleId }) =>
          normalizeSuiObjectId(oracleId)
        )
      );
      const oracleValidation = new Map<string, string | null>();

      await Promise.all(
        candidateOracleIds.map(async oracleId => {
          let normalizedOracleId: string;
          try {
            normalizedOracleId = normalizeSuiObjectId(oracleId);
          } catch {
            oracleValidation.set(oracleId, 'invalid_object_id');
            return;
          }

          try {
            const oracle = await new Oracle(
              switchboardClient,
              oracleId
            ).loadData();
            oracleValidation.set(
              oracleId,
              validateOracleMapping(
                oracle,
                oracleQueueId,
                currentOracleIds,
                Date.now()
              )
            );
          } catch {
            oracleValidation.set(oracleId, 'object_unavailable');
          }

          if (!currentOracleIds.has(normalizedOracleId))
            oracleValidation.set(oracleId, 'off_queue');
        })
      );

      for (const response of updateResult.responses) {
        const feedHash = normalizeHex(response.feedConfigs.feedHash);
        if (!feedHashToAggregatorId.has(feedHash)) {
          failures.push(
            `Unexpected feed hash ${response.feedConfigs.feedHash}`
          );
          continue;
        }

        const seen = acceptedOracleIds.get(feedHash) ?? new Set<string>();
        const validResults = response.results.filter(result => {
          if (result.signature === '00' || !result.successValue) return false;
          const reason = oracleValidation.get(result.oracleId);
          if (reason) {
            failures.push(`Rejected oracle ${result.oracleId}: ${reason}`);
            return false;
          }
          const normalizedOracleId = normalizeSuiObjectId(result.oracleId);
          if (seen.has(normalizedOracleId)) return false;
          seen.add(normalizedOracleId);
          return true;
        });

        acceptedOracleIds.set(feedHash, seen);
        if (validResults.length > 0)
          acceptedResponses.push({ ...response, results: validResults });
      }

      if (attempt < maxRetries) {
        const stillPending = Array.from(requiredResponses).some(
          ([feedHash, required]) =>
            (acceptedOracleIds.get(feedHash)?.size ?? 0) < required
        );
        if (stillPending)
          await new Promise(resolve => setTimeout(resolve, retryDelayMs));
      }
    }

    const insufficient = Array.from(requiredResponses)
      .map(([feedHash, required]) => ({
        aggregatorId: feedHashToAggregatorId.get(feedHash)!,
        received: acceptedOracleIds.get(feedHash)?.size ?? 0,
        required,
      }))
      .filter(({ received, required }) => received < required);

    if (insufficient.length > 0) {
      throw new Error(
        `Insufficient valid Sui oracle responses: ${insufficient
          .map(
            ({ aggregatorId, received, required }) =>
              `${aggregatorId} (${received}/${required})`
          )
          .join(', ')}`
      );
    }

    const feeAmounts = acceptedResponses.flatMap(response =>
      response.results.map(() => response.fee)
    );
    const coins = tx.splitCoins(tx.gas, feeAmounts);
    let coinIdx = 0;

    for (const response of acceptedResponses) {
      for (const result of response.results) {
        const aggregatorId = feedHashToAggregatorId.get(
          normalizeHex(response.feedConfigs.feedHash)
        );
        if (!aggregatorId) {
          throw new Error(
            `Aggregator ID not found for feed hash: ${response.feedConfigs.feedHash}`
          );
        }

        // write the move call
        tx.moveCall({
          target: `${switchboardAddress}::aggregator_submit_result_action::run`,
          arguments: [
            tx.object(aggregatorId),
            tx.object(oracleQueueId),
            tx.pure.u128(result.successValue),
            tx.pure.bool(result.isNegative),
            tx.pure.u64(result.timestamp),
            tx.object(result.oracleId),
            tx.pure.vector('u8', Buffer.from(result.signature, 'hex')),
            tx.object(SUI_CLOCK_OBJECT_ID),
            coins[coinIdx++],
          ],
          typeArguments: [SUI_TYPE_ARG],
        });
      }
    }

    return { responses: acceptedResponses, failures };
  }

  /**
   * Fetch updates for multiple aggregator IDs using the Crossbar update route for Sui
   * @param network - The Sui network ('mainnet' or 'testnet')
   * @param aggregatorIds - Array of aggregator IDs to fetch updates for
   * @param options - Optional Crossbar, retry, and request-scoped variable override parameters
   * @returns Promise with the responses and failures for the specified feeds
   */
  public static async fetchUpdateForMultiple(
    network: string,
    aggregatorIds: string[],
    options?: AggregatorFetchManyUpdateTxParams
  ): Promise<{ responses: FetchUpdateResponse[]; failures: string[] }> {
    if (!aggregatorIds || aggregatorIds.length === 0) {
      throw new Error('At least one aggregator ID is required');
    }

    const crossbarClient =
      options?.crossbarClient ??
      new CrossbarClient(
        options?.crossbarUrl ?? 'https://crossbar.switchboard.xyz'
      );

    const maxRetries = options?.maxRetries ?? 3;
    const retryDelayMs = options?.retryDelayMs ?? 1000;
    const minResponsesRequired = options?.minResponsesRequired ?? 1;

    let attempt = 0;
    let lastResult: { responses: FetchUpdateResponse[]; failures: string[] };

    while (attempt <= maxRetries) {
      try {
        const variableOverrides = options?.variableOverrides;
        const result =
          variableOverrides && Object.keys(variableOverrides).length > 0
            ? await fetchSuiUpdatesWithOverrides(
                crossbarClient,
                network,
                aggregatorIds,
                variableOverrides
              )
            : await crossbarClient.fetchSuiUpdates(network, aggregatorIds);

        // Check if we have enough responses
        if (result.responses.length >= minResponsesRequired) {
          return result;
        }

        lastResult = result;

        if (attempt < maxRetries) {
          await new Promise(resolve => setTimeout(resolve, retryDelayMs));
        }
      } catch (error) {
        if (attempt === maxRetries) {
          throw error;
        }
        await new Promise(resolve => setTimeout(resolve, retryDelayMs));
      }

      attempt++;
    }

    // If we've exhausted all retries, return the last result (even if insufficient)
    // This allows the calling code to handle the insufficient responses case
    return lastResult!;
  }
}
