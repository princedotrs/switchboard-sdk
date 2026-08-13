import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const commonDirectory = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..'
);
const generatedTargets = [
  path.join(commonDirectory, 'src', 'protos', 'index.js'),
  path.join(commonDirectory, 'dist', 'esm', 'protos', 'index.js'),
  path.join(commonDirectory, 'dist', 'esm', 'protos', 'index.cjs'),
];

for (const target of generatedTargets) {
  if (!fs.existsSync(target)) {
    throw new Error(`Missing generated protobuf source: ${target}`);
  }

  const source = fs.readFileSync(target, 'utf8');
  if (source.includes('$protobuf.roots.oracle_job')) {
    throw new Error(
      `Generated protobuf source uses the shared oracle_job root: ${target}`
    );
  }
  const localRootInitializers = source.match(/\b(?:var|const) \$root = \{\};/g);
  if (localRootInitializers?.length !== 1) {
    throw new Error(
      `Expected exactly one module-local protobuf root in ${target}, found ${localRootInitializers?.length ?? 0}`
    );
  }

  const encoderStart = source.indexOf('OracleTask.encode = function encode');
  const encoderEnd = source.indexOf(
    'OracleTask.encodeDelimited = function encodeDelimited',
    encoderStart
  );
  if (encoderStart < 0 || encoderEnd < 0) {
    throw new Error(`Missing OracleTask encoder in ${target}`);
  }

  const oracleTaskEncoder = source.slice(encoderStart, encoderEnd);
  const pythPushTag = oracleTaskEncoder.search(/uint32\([^)]*98\)/s);
  const pythConfigsTag = oracleTaskEncoder.search(/uint32\([^)]*50\)/s);
  if (pythPushTag < 0 || pythConfigsTag < 0 || pythPushTag >= pythConfigsTag) {
    throw new Error(
      `Generated OracleTask encoder is not in prost declaration order: ${target}`
    );
  }
}
