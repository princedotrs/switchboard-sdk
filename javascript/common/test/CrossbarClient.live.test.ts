import { IxFromHex } from '../src/utils/instructions.js';

import { PublicKey } from '@solana/web3.js';
import axios, { type AxiosResponse } from 'axios';
import { expect } from 'chai';

type RawSolanaUpdateResponse = {
  success: boolean;
  pullIxns: string[];
  responses: { oracle: string; result: number | null; errors: string }[];
  lookupTables: string[];
};

type SolanaSimulationResponse = {
  feed: string;
  feedHash: string;
  results: (number | string)[];
  result: string;
  stdev: string;
  variance: string;
};

const crossbarUrl = (
  process.env.CROSSBAR_LIVE_BASE_URL ?? 'https://crossbar.switchboard.xyz'
).replace(/\/$/, '');
const client = axios.create({
  timeout: 15_000,
  validateStatus: () => true,
});

function requireSuccess<T>(response: AxiosResponse<T>, operation: string): T {
  if (response.status < 200 || response.status >= 300) {
    throw new Error(
      `${operation} returned HTTP ${response.status}: ${JSON.stringify(response.data)}`
    );
  }
  return response.data;
}

describe('Crossbar Solana live canary', () => {
  test('fetches Solana updates and decodes instruction payloads', async () => {
    const network = 'devnet';
    const feeds = [
      'FAmE211gC241L5YTAssfUT3h2dHcUygVGFbz2hHBKNWG',
      '7XcCuTUtpw7ZvfohHvXfCp2GTG5RYmNAYMMdSdSMreC5',
    ];
    const numSignatures = 2;

    const response = await client.get<RawSolanaUpdateResponse[]>(
      `${crossbarUrl}/updates/solana/${network}/${feeds.join(',')}`,
      {
        params: {
          payer: 'nXsE22JSmWYk7f4KtfjXVqCvGuaVXntdSbCKzdumzFv',
          numSignatures,
        },
      }
    );
    const updates = requireSuccess(response, 'Solana update request');

    expect(updates).to.be.an('array');
    expect(updates).to.have.lengthOf(feeds.length);

    updates.forEach(update => {
      expect(update).to.have.property('success').to.eq(true);
      expect(update)
        .to.have.property('pullIxns')
        .that.is.an('array')
        .with.lengthOf(numSignatures);

      const decodedIxns = update.pullIxns.map(IxFromHex);
      decodedIxns.forEach(ix => {
        expect(ix.programId).to.be.instanceOf(PublicKey);
        expect(ix.keys).to.be.an('array').that.is.not.empty;
        expect(ix.data.length).to.be.greaterThan(0);
      });

      expect(update.responses).to.be.an('array').that.is.not.empty;
      update.responses.forEach(oracleResponse => {
        expect(oracleResponse.oracle).to.be.a('string').and.not.empty;
        if (oracleResponse.result !== null) {
          expect(Number.isFinite(oracleResponse.result)).to.be.true;
        }
        expect(oracleResponse.errors).to.be.a('string');
      });

      expect(update.lookupTables).to.be.an('array').that.is.not.empty;
      update.lookupTables.forEach(lookupTable => {
        expect(lookupTable).to.be.a('string').and.not.empty;
      });
    });
  });

  test('simulates Solana feeds and returns aggregate fields', async () => {
    const network = 'devnet';
    const feeds = [
      'AXRydnjDeWUgR5VGFFqtzYv52u2MHqFCYcsHsnEgCD15',
      '7yQ4ae7XH4tdiXXbzdsycUjFEWAhonVXLcR1vreqGT3s',
    ];

    const response = await client.get<SolanaSimulationResponse[]>(
      `${crossbarUrl}/simulate/solana/${network}/${feeds.join(',')}`
    );
    const simulationResults = requireSuccess(
      response,
      'Solana simulation request'
    );

    expect(simulationResults).to.be.an('array');
    expect(simulationResults).to.have.lengthOf(feeds.length);

    simulationResults.forEach(result => {
      expect(result.feed).to.be.a('string').and.oneOf(feeds);
      expect(result.feedHash).to.match(/^[0-9a-f]+$/i);
      expect(result.results).to.be.an('array');
      result.results
        .map(value => Number(value))
        .forEach(value => expect(Number.isFinite(value)).to.be.true);
      expect(result.result).to.be.a('string').and.not.empty;
      expect(result.stdev).to.be.a('string').and.not.empty;
      expect(result.variance).to.be.a('string').and.not.empty;
    });
  });
});
