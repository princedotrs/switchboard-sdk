import { FeedHash, OracleFeed, OracleJob } from '@switchboard-xyz/common';

export const SWTCH_TOKEN_MINT = 'SW1TCHLmRGTfW5xZknqQdpdarB8PD95sJYWpNp9TbFx';
export const USDC_TOKEN_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
export const SWTCH_USD_JUPITER_QUOTE_AMOUNT = '1000';

/**
 * SWTCH/USD uses Jupiter's best SWTCH -> USDC route and treats 1 USDC as 1 USD.
 * Low SWTCH liquidity and the USDC peg are intentional, documented pricing risks.
 */
export const SWTCH_USD_JUPITER_FEED = OracleFeed.create({
  name: 'SWTCH/USD Jupiter',
  minOracleSamples: 1,
  minJobResponses: 1,
  maxJobRangePct: 1,
  jobs: [
    OracleJob.create({
      tasks: [
        {
          jupiterSwapTask: {
            inTokenAddress: SWTCH_TOKEN_MINT,
            outTokenAddress: USDC_TOKEN_MINT,
            baseAmountString: SWTCH_USD_JUPITER_QUOTE_AMOUNT,
            slippage: 5,
            version: OracleJob.JupiterSwapTask.Version.VERSION_V2,
            directRoutesOnly: false,
          },
        },
        {
          divideTask: {
            big: SWTCH_USD_JUPITER_QUOTE_AMOUNT,
          },
        },
      ],
    }),
  ],
});

export const SWTCH_USD_JUPITER_FEED_ID = FeedHash.computeOracleFeedId(
  SWTCH_USD_JUPITER_FEED
).toString('hex');
