import {
  SWTCH_TOKEN_MINT,
  SWTCH_USD_JUPITER_FEED,
  SWTCH_USD_JUPITER_FEED_ID,
  SWTCH_USD_JUPITER_QUOTE_AMOUNT,
  USDC_TOKEN_MINT,
} from '../src/feeds/swtchUsd.ts';

import assert from 'node:assert/strict';

const [job] = SWTCH_USD_JUPITER_FEED.jobs;
const [quoteTask, divideTask] = job.tasks;

assert.equal(SWTCH_USD_JUPITER_FEED.minOracleSamples, 1);
assert.equal(SWTCH_USD_JUPITER_FEED.minJobResponses, 1);
assert.equal(job.tasks.length, 2);
assert.equal(quoteTask.jupiterSwapTask?.inTokenAddress, SWTCH_TOKEN_MINT);
assert.equal(quoteTask.jupiterSwapTask?.outTokenAddress, USDC_TOKEN_MINT);
assert.equal(
  quoteTask.jupiterSwapTask?.baseAmountString,
  SWTCH_USD_JUPITER_QUOTE_AMOUNT
);
assert.equal(quoteTask.jupiterSwapTask?.slippage, 5);
assert.equal(quoteTask.jupiterSwapTask?.directRoutesOnly, false);
assert.equal(divideTask.divideTask?.big, SWTCH_USD_JUPITER_QUOTE_AMOUNT);
assert.equal(
  SWTCH_USD_JUPITER_FEED_ID,
  '02c7105b9678c727dec95dd7f6b2441c6997d3948c10fc24e1d1655800b29894'
);

console.log(`SWTCH/USD Jupiter feed ID: ${SWTCH_USD_JUPITER_FEED_ID}`);
