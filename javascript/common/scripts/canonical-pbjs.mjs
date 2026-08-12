#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const commonDirectory = path.resolve(scriptDirectory, '..');
const protoDirectory = path.resolve(commonDirectory, '..', '..', 'protos');
const localRequire = createRequire(import.meta.url);
const cliPackageJson = localRequire.resolve('protobufjs-cli/package.json');
const cliDirectory = path.dirname(cliPackageJson);

// Resolve from the CLI package so pnpm cannot give this wrapper a different
// protobufjs instance than the one used internally by pbjs.
const cliRequire = createRequire(cliPackageJson);
const protobuf = cliRequire(cliRequire.resolve('protobufjs'));

function collectMapFields(namespace, prefix = '') {
  const mapFields = [];
  for (const nested of Object.values(namespace.nested ?? {})) {
    const qualifiedName = prefix ? `${prefix}.${nested.name}` : nested.name;
    if (nested.fieldsArray) {
      for (const field of nested.fieldsArray) {
        if (field.map) mapFields.push(`${qualifiedName}.${field.name}`);
      }
    }
    if (nested.nested) {
      mapFields.push(...collectMapFields(nested, qualifiedName));
    }
  }
  return mapFields;
}

const protoFiles = fs
  .readdirSync(protoDirectory)
  .filter(file => file.endsWith('.proto'))
  .sort()
  .map(file => path.join(protoDirectory, file));
const schemaRoot = new protobuf.Root();
schemaRoot.loadSync(protoFiles).resolveAll();
const mapFields = collectMapFields(schemaRoot);
if (mapFields.length > 0) {
  throw new Error(
    [
      'Canonical Switchboard protobuf generation does not support map fields.',
      'Define and test a deterministic Rust-compatible map ordering policy before adding:',
      ...mapFields.map(field => `- ${field}`),
    ].join('\n')
  );
}

// prost writes known fields in declaration order. protobufjs normally sorts
// them by numeric tag before generating encoders, which changes the bytes (and
// therefore feed identities) when declaration and tag order differ.
const fieldOrderByMessage = new WeakMap();
protobuf.util.compareFieldsById = (left, right) => {
  if (!left.parent || left.parent !== right.parent) {
    throw new Error('Cannot compare protobuf fields from different messages');
  }
  let declarationOrder = fieldOrderByMessage.get(left.parent);
  if (!declarationOrder) {
    declarationOrder = new Map(
      left.parent.fieldsArray.map((field, index) => [field, index])
    );
    fieldOrderByMessage.set(left.parent, declarationOrder);
  }
  const leftIndex = declarationOrder.get(left);
  const rightIndex = declarationOrder.get(right);
  if (leftIndex === undefined || rightIndex === undefined) {
    throw new Error('Missing protobuf field declaration order');
  }
  return leftIndex - rightIndex;
};

function resolveOutputPath(args) {
  const outputFlagIndex = args.findIndex(
    argument => argument === '-o' || argument === '--out'
  );
  const outputPath = args[outputFlagIndex + 1];
  if (outputFlagIndex < 0 || !outputPath) {
    throw new Error(
      'Canonical Switchboard protobuf generation requires an output file'
    );
  }
  return path.resolve(process.cwd(), outputPath);
}

function isolateGeneratedRoot(outputPath) {
  const source = fs.readFileSync(outputPath, 'utf8');
  const globalRootInitializer =
    /\b(var|const) \$root = \$protobuf\.roots\.oracle_job \|\| \(\$protobuf\.roots\.oracle_job = \{\}\);/g;
  const initializers = [...source.matchAll(globalRootInitializer)];
  if (initializers.length !== 1) {
    throw new Error(
      `Expected exactly one protobuf global root initializer in ${outputPath}, found ${initializers.length}`
    );
  }

  const isolatedSource = source.replace(
    globalRootInitializer,
    '$1 $root = {};'
  );
  if (isolatedSource.includes('$protobuf.roots.oracle_job')) {
    throw new Error(
      `Generated protobuf source still references the shared oracle_job root: ${outputPath}`
    );
  }
  fs.writeFileSync(outputPath, isolatedSource);
}

const args = process.argv.slice(2);
const outputPath = resolveOutputPath(args);
const pbjs = cliRequire(path.join(cliDirectory, 'pbjs.js'));
const exitCode = await pbjs.main(args);
if (typeof exitCode === 'number' && exitCode !== 0) {
  process.exitCode = exitCode;
} else {
  isolateGeneratedRoot(outputPath);
}
