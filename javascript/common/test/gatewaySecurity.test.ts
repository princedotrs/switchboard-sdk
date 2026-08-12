import {
  GatewayRequestError,
  summarizeGatewayRequestError,
} from '../src/gateway.js';

describe('Gateway error logging', () => {
  const secret = 'customer-api-key-must-not-be-logged';

  it('omits Axios request config, body, message, and untrusted error codes', () => {
    const error = {
      isAxiosError: true,
      code: secret,
      message: `request failed with ${secret}`,
      config: {
        data: JSON.stringify({
          variable_overrides: { PYTH_API_KEY: secret },
        }),
        headers: { Authorization: `Bearer ${secret}` },
      },
      response: { status: 401, data: secret },
    };

    const summary = summarizeGatewayRequestError(error);
    const serialized = JSON.stringify(summary);

    expect(summary).toEqual({ kind: 'AxiosError', status: 401 });
    expect(serialized).not.toContain(secret);
  });

  it('does not copy messages from non-Axios errors', () => {
    const summary = summarizeGatewayRequestError(new Error(secret));

    expect(summary).toEqual({ kind: 'NonAxiosError' });
    expect(JSON.stringify(summary)).not.toContain(secret);
  });

  it('keeps allowlisted Axios diagnostics', () => {
    const summary = summarizeGatewayRequestError({
      isAxiosError: true,
      code: 'ERR_BAD_RESPONSE',
      response: { status: 503 },
    });

    expect(summary).toEqual({
      kind: 'AxiosError',
      code: 'ERR_BAD_RESPONSE',
      status: 503,
    });
  });

  it('replaces secret-bearing Axios errors with a data-minimal error', () => {
    const original = {
      isAxiosError: true,
      code: 'ERR_BAD_RESPONSE',
      message: `request failed with ${secret}`,
      config: {
        data: JSON.stringify({
          variable_overrides: { PYTH_API_KEY: secret },
        }),
      },
      response: { status: 503, data: secret },
    };

    const error = GatewayRequestError.sanitizeAxios(
      'Gateway.fetchQuote',
      original
    );
    const serialized = JSON.stringify(error);

    expect(error).toMatchObject({
      name: 'GatewayRequestError',
      kind: 'AxiosError',
      code: 'ERR_BAD_RESPONSE',
      status: 503,
    });
    expect(error).not.toHaveProperty('config');
    expect(error).not.toHaveProperty('response');
    expect(error).not.toHaveProperty('cause');
    expect(serialized).not.toContain(secret);
  });

  it('preserves non-Axios failures without changing their identity or details', () => {
    const original = new SyntaxError('invalid gateway response JSON');

    const error = GatewayRequestError.sanitizeAxios(
      'Gateway.fetchRandomnessReveal',
      original
    );

    expect(error).toBe(original);
    expect(error).toBeInstanceOf(SyntaxError);
    expect((error as SyntaxError).message).toBe(
      'invalid gateway response JSON'
    );
  });
});
