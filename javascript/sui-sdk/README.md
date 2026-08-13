<div align="center">

![Switchboard Logo](https://github.com/switchboard-xyz/switchboard/raw/main/website/static/img/icons/switchboard/avatar.png)

# Switchboard Sui SDK

Typedoc: https://switchboard-sui-sdk.web.app

## Installation

```bash
pnpm install @switchboard-xyz/sui-sdk
```

## Switchboard Surge Integration

Convert real-time Surge price updates into Sui oracle quote format for Move contracts.

### Quick Start

```typescript
import { SuiClient } from '@mysten/sui/client';
import { Transaction } from '@mysten/sui/transactions';
import {
  SwitchboardClient,
  convertSurgeUpdateToQuotes,
  MAINNET_QUEUE_ID,
} from '@switchboard-xyz/sui-sdk';
import { Surge } from '@switchboard-xyz/on-demand';

const suiClient = new SuiClient({ url: 'https://fullnode.mainnet.sui.io:443' });
const sb = new SwitchboardClient(suiClient);

// Connect to Surge
const surge = new Surge({
  apiKey: process.env.SURGE_API_KEY!,
  network: 'mainnet',
});

await surge.connect();

// Subscribe to price feeds
await surge.subscribe([
  { symbol: 'BTC/USD', source: 'WEIGHTED' },
  { symbol: 'ETH/USD', source: 'WEIGHTED' },
]);

// Handle real-time updates
surge.on('signedPriceUpdate', async priceUpdate => {
  // Convert to Sui quote format
  const quoteData = await convertSurgeUpdateToQuotes(
    priceUpdate,
    MAINNET_QUEUE_ID
  );

  // Use in a Sui transaction
  const tx = new Transaction();
  tx.moveCall({
    target: `${PACKAGE_ID}::your_module::consume_price`,
    arguments: [
      tx.pure.vector(
        'vector<u8>',
        quoteData.feedHashes.map(h => Array.from(Buffer.from(h, 'hex')))
      ),
      tx.pure.vector('u128', quoteData.values),
      tx.pure.vector('bool', quoteData.valuesNeg),
      tx.pure.u64(quoteData.timestampSeconds),
    ],
  });

  await client.signAndExecuteTransactionBlock({ transactionBlock: tx });
});
```

### convertSurgeUpdateToQuotes

Transforms a real-time Surge price update into the format required for Sui Move contracts.

#### Function Signature

```typescript
export async function convertSurgeUpdateToQuotes(
  tx: Transaction,
  surgeUpdate: {
    getSignedFeeds(): string[];
    getValues(): string[];
    getRawResponse(): {
      feed_values?: Array<{ value: string; feed_hash: string }>;
      oracle_response?: {
        timestamp_ms?: number;
        timestamp?: number;
        slot: number;
        oracle_idx: number;
      };
    };
  },
  queueId: string
): Promise<TransactionResult>;
```

#### Parameters

- **tx** (`Transaction`): Sui transaction to add the move call to
  - The quote submission will be added as a move call to this transaction

- **surgeUpdate** (`SurgeUpdate`): The price update from Switchboard Surge
  - Contains signed feed hashes and 18-decimal price values
  - Includes oracle response metadata (timestamp, slot, etc.)

- **queueId** (`string`): The Switchboard oracle queue ID
  - Use `MAINNET_QUEUE_ID` for mainnet
  - Use `TESTNET_QUEUE_ID` for testnet
  - Or provide your custom queue ID

#### Returns

`TransactionResult` - The result of the move call with formatted quotes ready to execute

### Available Queue IDs

```typescript
import { MAINNET_QUEUE_ID, TESTNET_QUEUE_ID } from '@switchboard-xyz/sui-sdk';

// Mainnet Switchboard Oracle Queue
export const MAINNET_QUEUE_ID =
  '0x6e43354b8ea2dfad98eadb33db94dcc9b1175e70ee82e42abc605f6b7de9e910';

// Testnet Switchboard Oracle Queue
export const TESTNET_QUEUE_ID =
  '0x9be6fb7a8b2b5a4d9c7c1e8f3f7f8f9f0a0b0c0d0e0f0f0f0f0f0f0f0f0f0f0f';
```

### Example: Using in a Move Contract

Once you have the `quoteResult` from `convertSurgeUpdateToQuotes`, execute the transaction:

```typescript
const tx = new Transaction();
tx.setSender(senderAddress);

// Add quotes to transaction
const quoteResult = await convertSurgeUpdateToQuotes(
  tx,
  priceUpdate,
  MAINNET_QUEUE_ID
);

// Execute with the quotes
await client.signAndExecuteTransactionBlock({ transactionBlock: tx });
```

### Example: Real-time Price Feed

```typescript
// Stream real-time prices directly to your smart contract
surge.on('signedPriceUpdate', async priceUpdate => {
  // Create transaction
  const tx = new Transaction();
  tx.setSender(senderAddress);

  // Convert to Sui quote format and add to transaction
  const quoteResult = await convertSurgeUpdateToQuotes(
    tx,
    priceUpdate,
    MAINNET_QUEUE_ID
  );

  // Execute the transaction with the quotes
  const result = await client.signAndExecuteTransactionBlock({
    transactionBlock: tx,
  });
  console.log('Price update confirmed:', result.digest);
});
```

### Performance Characteristics

- **Latency**: Sub-100ms price delivery via WebSocket
- **Frequency**: Updates on price changes or scheduled heartbeats
- **Accuracy**: 18-decimal precision (wei-style formatting)
- **Reliability**: Automatic reconnection on disconnect

For more examples, see the [sb-on-demand-examples repository](https://github.com/switchboard-xyz/sb-on-demand-examples/tree/main/sui).

## Oracle Mapping Cache

Convert and cache Solana oracle pubkeys to Sui oracle IDs for efficient batch updates.

### Quick Start

```typescript
import {
  fetchOracleMappings,
  getOracleIds,
  getOracleMapping,
} from '@switchboard-xyz/sui-sdk';

// Fetch and cache oracle mappings from Crossbar API
const mappings = await fetchOracleMappings();
console.log(`Cached ${mappings.size} oracle mappings`);

// Convert Solana pubkeys to Sui oracle IDs
const solanaPubkeys = [
  '31Uys8oYqNAiRUKR9i24qLaG5ninMFuXckpkfV3FaPDp',
  '645bCKGspzjizB1CN5h2A5CThoT2MxVTpFCCHhrBjuHN',
];

const suiOracleIds = await getOracleIds(solanaPubkeys);
console.log('Sui Oracle IDs:', suiOracleIds);

// Get detailed mapping for a specific oracle
const oracleMapping = await getOracleMapping(
  '31Uys8oYqNAiRUKR9i24qLaG5ninMFuXckpkfV3FaPDp'
);
console.log('Oracle details:', oracleMapping);
```

### API Reference

#### fetchOracleMappings(forceRefresh?: boolean)

Fetches oracle mappings from [Crossbar oracles API](https://crossbar.switchboard.xyz/oracles) and caches them locally.

**Parameters:**

- `forceRefresh` (optional, default: `false`) - Force refresh from API, ignoring cache

**Returns:** `Promise<Map<string, OracleMapping>>`

**OracleMapping structure:**

```typescript
{
  solanaPubkey: string; // Solana oracle public key
  suiOracleId: string; // Sui oracle ID (same as pubkey)
  secp256k1Key: string; // Oracle's secp256k1 key
  authority: string; // Oracle authority address
  queue: string; // Oracle queue ID
  mrEnclave: string; // Enclave measurement
  expirationTime: number; // Expiration timestamp
}
```

**Cache Details:**

- TTL: 5 minutes (configurable via `ORACLE_CACHE_TTL`)
- Automatically returns cached data if valid
- Falls back to stale cache on API errors

#### getOracleIds(solanaPubkeys: string[], forceRefresh?: boolean)

Converts an array of Solana pubkeys to Sui oracle IDs.

**Parameters:**

- `solanaPubkeys` - Array of Solana oracle pubkeys
- `forceRefresh` (optional) - Force refresh from API

**Returns:** `Promise<string[]>` - Array of corresponding Sui oracle IDs

```typescript
const ids = await getOracleIds([
  '31Uys8oYqNAiRUKR9i24qLaG5ninMFuXckpkfV3FaPDp',
  '645bCKGspzjizB1CN5h2A5CThoT2MxVTpFCCHhrBjuHN',
]);
// Returns: ["31Uys8oYqNAiRUKR9i24qLaG5ninMFuXckpkfV3FaPDp", "645bCKGspzjizB1CN5h2A5CThoT2MxVTpFCCHhrBjuHN"]
```

#### getOracleMapping(solanaPubkey: string, forceRefresh?: boolean)

Gets the complete mapping for a specific oracle.

**Parameters:**

- `solanaPubkey` - Solana oracle pubkey
- `forceRefresh` (optional) - Force refresh from API

**Returns:** `
