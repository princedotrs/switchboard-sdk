import { CrossbarClient } from '../src/crossbar-client.js';

import type { AxiosResponse } from 'axios';
import axios from 'axios';
import { expect } from 'chai';

describe('CrossbarClient.fetchGateways', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('bounds gateway discovery with the standard request timeout', async () => {
    const gateways = ['https://gateway.devnet.example'];
    const getSpy = jest
      .spyOn(axios, 'get')
      .mockResolvedValue({ data: gateways } as AxiosResponse<string[]>);

    const client = new CrossbarClient('https://crossbar.example');
    const result = await client.fetchGateways('devnet');

    expect(result).to.deep.equal(gateways);
    expect(getSpy.mock.calls).to.have.lengthOf(1);
    expect(getSpy.mock.calls[0]).to.deep.equal([
      'https://crossbar.example/gateways?network=devnet',
      { timeout: 10_000 },
    ]);
  });

  test('defaults gateway discovery to mainnet with the same timeout', async () => {
    const gateways: string[] = [];
    const getSpy = jest
      .spyOn(axios, 'get')
      .mockResolvedValue({ data: gateways } as AxiosResponse<string[]>);

    const client = new CrossbarClient('https://crossbar.example');
    await client.fetchGateways();

    expect(getSpy.mock.calls).to.have.lengthOf(1);
    expect(getSpy.mock.calls[0]).to.deep.equal([
      'https://crossbar.example/gateways?network=mainnet',
      { timeout: 10_000 },
    ]);
  });
});
