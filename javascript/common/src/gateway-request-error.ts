import axios from 'axios';

export type GatewayRequestErrorSummary = {
  kind: 'AxiosError' | 'NonAxiosError';
  code?: string;
  status?: number;
};

/** Return diagnostics that are safe to log or expose to callers. */
export function summarizeGatewayRequestError(
  error: unknown
): GatewayRequestErrorSummary {
  if (!axios.isAxiosError(error)) {
    return { kind: 'NonAxiosError' };
  }

  const code =
    typeof error.code === 'string' && /^ERR_[A-Z0-9_]+$/.test(error.code)
      ? error.code
      : undefined;
  const status =
    typeof error.response?.status === 'number'
      ? error.response.status
      : undefined;

  return {
    kind: 'AxiosError',
    ...(code === undefined ? {} : { code }),
    ...(status === undefined ? {} : { status }),
  };
}

/**
 * A request failure that deliberately retains no Axios config, request body,
 * response body, original message, or cause.
 */
export class GatewayRequestError extends Error {
  readonly kind: GatewayRequestErrorSummary['kind'];
  readonly code?: string;
  readonly status?: number;

  private constructor(operation: string, summary: GatewayRequestErrorSummary) {
    const diagnostics = [
      summary.status === undefined ? undefined : `status ${summary.status}`,
      summary.code === undefined ? undefined : `code ${summary.code}`,
    ].filter((value): value is string => value !== undefined);
    super(
      `${operation} failed${
        diagnostics.length === 0 ? '' : ` (${diagnostics.join(', ')})`
      }`
    );
    this.name = 'GatewayRequestError';
    this.kind = summary.kind;
    this.code = summary.code;
    this.status = summary.status;
    Object.setPrototypeOf(this, new.target.prototype);
  }

  static sanitizeAxios<T>(
    operation: string,
    error: T
  ): T | GatewayRequestError {
    if (!axios.isAxiosError(error)) {
      return error;
    }

    return new GatewayRequestError(
      operation,
      summarizeGatewayRequestError(error)
    );
  }

  toJSON(): Record<string, string | number | undefined> {
    return {
      name: this.name,
      message: this.message,
      kind: this.kind,
      code: this.code,
      status: this.status,
    };
  }
}
