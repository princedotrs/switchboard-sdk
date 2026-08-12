#!/usr/bin/env tsx

import {
  SWTCH_USD_JUPITER_FEED,
  SWTCH_USD_JUPITER_FEED_ID,
} from '../src/feeds/swtchUsd.ts';

import { CrossbarClient } from '@switchboard-xyz/common';

const crossbarUrl =
  process.env.CROSSBAR_URL ?? 'https://crossbar.switchboard.xyz';

async function main(): Promise<void> {
  const command = process.argv[2] ?? 'print';
  const crossbar = new CrossbarClient(crossbarUrl);

  if (command === 'print') {
    console.log(JSON.stringify(SWTCH_USD_JUPITER_FEED, null, 2));
    console.log(`Feed ID: ${SWTCH_USD_JUPITER_FEED_ID}`);
    return;
  }

  if (command === 'simulate') {
    const result = await crossbar.simulateFeed(
      SWTCH_USD_JUPITER_FEED,
      false,
      undefined,
      'mainnet'
    );
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (command === 'store') {
    const result = await crossbar.storeOracleFeed(SWTCH_USD_JUPITER_FEED);
    if (
      result.feedId.replace(/^0x/, '').toLowerCase() !==
      SWTCH_USD_JUPITER_FEED_ID
    ) {
      throw new Error(
        `Crossbar returned ${result.feedId}, expected ${SWTCH_USD_JUPITER_FEED_ID}`
      );
    }
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  throw new Error('Usage: swtchUsdFeed.ts [print|simulate|store]');
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
