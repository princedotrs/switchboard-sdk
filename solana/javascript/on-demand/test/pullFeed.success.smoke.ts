import { hasOracleFailure, isSuccessfulOracleResponse } from '../src/accounts/pullFeed.ts';

import { Big } from '@switchboard-xyz/common';
import assert from 'node:assert/strict';

function run(): void {
  assert.equal(hasOracleFailure(''), false);
  assert.equal(hasOracleFailure('[]'), false);
  assert.equal(hasOracleFailure('  '), false);
  assert.equal(hasOracleFailure('Stale submission'), true);

  assert.equal(isSuccessfulOracleResponse(new Big(42), ''), true);
  assert.equal(
    isSuccessfulOracleResponse(new Big(42), 'Stale submission'),
    false
  );
  assert.equal(isSuccessfulOracleResponse(null, ''), false);
}

run();
console.log('pullFeed success-accounting smoke test passed');
