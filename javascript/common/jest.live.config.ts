import baseConfig from './jest.config';

import type { JestConfigWithTsJest } from 'ts-jest';

const liveConfig: JestConfigWithTsJest = {
  ...baseConfig,
  maxWorkers: 1,
  testMatch: ['<rootDir>/test/**/*.live.test.ts'],
  testPathIgnorePatterns: [],
  testTimeout: 30_000,
};

export default liveConfig;
