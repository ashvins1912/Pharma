import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

const sourceRoot = path.resolve('src');
const sourceExtensions = new Set(['.js', '.jsx', '.ts', '.tsx']);
const files = [];

async function collect(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      await collect(absolutePath);
    } else if (sourceExtensions.has(path.extname(entry.name))) {
      files.push(absolutePath);
    }
  }
}

test('UI error state and toast calls do not receive raw error objects', async () => {
  await collect(sourceRoot);
  const violations = [];
  // Guard the common regression: passing Axios/Error object properties directly
  // into React-rendered state or toast text instead of normalizing to a string.
  const unsafeErrorChild = /\b(?:set[A-Z]\w*(?:Error|Message)|addToast)\s*\(\s*(?:err|error|e|requestError)\s*(?:\?\.|\.)/g;

  for (const file of files) {
    const source = await readFile(file, 'utf8');
    for (const match of source.matchAll(unsafeErrorChild)) {
      const line = source.slice(0, match.index).split('\n').length;
      violations.push(`${path.relative(process.cwd(), file)}:${line}`);
    }
  }

  assert.deepEqual(violations, [], [
    'Raw Error/Axios values are being passed to UI error state or toast calls:',
    ...violations,
    'Use getReadableErrorMessage(error, fallback) before rendering.'
  ].join('\n'));
});
