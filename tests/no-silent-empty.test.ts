import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * `data ?? []` is how a failed query becomes "you have nothing".
 *
 * It reads as defensive and it is the opposite: PostgREST reports a broken
 * query by setting `error`, and a caller that only looks at `data` renders the
 * failure as an empty list. This app did exactly that for a week — the
 * transactions page said there were none while three sat in the database, and
 * the daily budget, the score and the assistant were all computing on nothing.
 *
 * So the expression lives in one place now, `src/lib/data/result.ts`, where it
 * is preceded by a check. Every read goes through `rows`, or through
 * `rowsOrEmpty` where degrading is a decision someone wrote down.
 */
const ALLOWED = 'src/lib/data/result.ts';

function sourceFiles(dir: string, base: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return sourceFiles(path, base);
    return /\.tsx?$/.test(entry) ? [path.slice(base.length + 1)] : [];
  });
}

test('no page turns a failed query into an empty list', () => {
  const root = new URL('../src', import.meta.url).pathname;
  const repo = new URL('..', import.meta.url).pathname.replace(/\/$/, '');
  const offenders: string[] = [];

  for (const relative of sourceFiles(root, repo)) {
    if (relative === ALLOWED) continue;
    const source = readFileSync(join(repo, relative), 'utf8');
    if (/\bdata \?\? \[\]/.test(source)) offenders.push(relative);
  }

  assert.deepEqual(
    offenders,
    [],
    `these read a query result without looking at its error: ${offenders.join(', ')}. ` +
      'Use rows() from @/lib/data/result, or rowsOrEmpty() and say in a comment why this one may degrade.',
  );
});
