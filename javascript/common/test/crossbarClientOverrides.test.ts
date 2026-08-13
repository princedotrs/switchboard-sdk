import { CrossbarClient } from '../src/crossbar-client.js';

import axios from 'axios';

describe('CrossbarClient request-scoped overrides', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('simulateFeeds forwards overrides and network to every simulation', async () => {
    const client = new CrossbarClient('https://crossbar.example');
    const variableOverrides = { PYTH_API_KEY: 'request-scoped-test-key' };
    const simulateFeed = jest
      .spyOn(client, 'simulateFeed')
      .mockResolvedValue({} as never);

    await client.simulateFeeds(
      ['feed-a', 'feed-b'],
      true,
      variableOverrides,
      'devnet'
    );

    expect(simulateFeed).toHaveBeenNthCalledWith(
      1,
      'feed-a',
      true,
      variableOverrides,
      'devnet'
    );
    expect(simulateFeed).toHaveBeenNthCalledWith(
      2,
      'feed-b',
      true,
      variableOverrides,
      'devnet'
    );
  });

  test('fetchSignaturesConsensus never exposes an Axios request body', async () => {
    const secret = 'request-scoped-test-key';
    const client = new CrossbarClient('https://crossbar.example', true);
    const consoleError = jest.spyOn(console, 'error').mockImplementation();
    jest.spyOn(axios, 'post').mockRejectedValueOnce({
      isAxiosError: true,
      code: 'ERR_BAD_RESPONSE',
      config: { data: JSON.stringify({ variableOverrides: { KEY: secret } }) },
      response: { status: 503, data: secret },
    });

    const request = {
      apiVersion: '1.0.0',
      signatureScheme: 'Ed25519',
      hashScheme: 'Sha256',
      feedRequests: [],
      numOracles: 1,
      variableOverrides: { KEY: secret },
    };

    await expect(
      client.fetchSignaturesConsensus(request)
    ).rejects.toMatchObject({
      name: 'GatewayRequestError',
      code: 'ERR_BAD_RESPONSE',
      status: 503,
    });
    expect(JSON.stringify(consoleError.mock.calls)).not.toContain(secret);
  });

  test('fetchSignaturesConsensus preserves non-Axios failures', async () => {
    const client = new CrossbarClient('https://crossbar.example');
    const original = new SyntaxError('invalid local feed data');
    jest.spyOn(axios, 'post').mockRejectedValueOnce(original);

    const request = {
      apiVersion: '1.0.0',
      signatureScheme: 'Ed25519',
      hashScheme: 'Sha256',
      feedRequests: [],
      numOracles: 1,
    };

    await expect(client.fetchSignaturesConsensus(request)).rejects.toBe(
      original
    );
  });
});
