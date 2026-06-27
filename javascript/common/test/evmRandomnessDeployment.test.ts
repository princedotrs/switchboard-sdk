import {
  getActiveRandomnessEvmDeployment,
  getCrossbarOracleNetworkForEvmChainId,
} from '../src/randomness-deployments.js';

describe('Randomness deployment matrix', () => {
  test('maps active EVM randomness deployments to Crossbar oracle networks', () => {
    expect(getActiveRandomnessEvmDeployment(143)?.id).toBe('monad-mainnet');
    expect(getActiveRandomnessEvmDeployment(84532)?.id).toBe('base-sepolia');
    expect(getCrossbarOracleNetworkForEvmChainId(143)).toBe('mainnet');
    expect(getCrossbarOracleNetworkForEvmChainId(84532)).toBe('devnet');
  });

  test('rejects unsupported chain ids', () => {
    expect(() => getCrossbarOracleNetworkForEvmChainId(1)).toThrow(
      'Unsupported active randomness EVM deployment'
    );
  });
});
