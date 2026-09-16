import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The foreign keys the app names when it asks PostgREST to join a table.
 *
 * These are database constraint names living inside template strings, which
 * means nothing in TypeScript checks them and nothing in the build notices when
 * one stops existing. That already happened once: a migration replaced the
 * single-column keys with composite ones, these strings kept the old names, and
 * every query that used them failed — silently, because the failure was read as
 * an empty result. The transactions page reported that there were no
 * transactions, for days, while the rows sat in the database.
 *
 * So the list is written down here, and `supabase/tests/01_schema_checks.sql`
 * asserts the same three names exist on a schema built from the migrations.
 * Between them: rename a key and the SQL check fails, add a hint here without
 * one and this test fails.
 */
const ALLOWED = new Set([
  'transactions_account_owner_fkey',
  'transactions_to_account_owner_fkey',
  'transactions_category_owner_fkey',
]);

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.tsx?$/.test(entry) ? [path] : [];
  });
}

test('every foreign key the code names is one we have written down', () => {
  const root = new URL('../src', import.meta.url).pathname;
  const found = new Map<string, string>();

  for (const file of sourceFiles(root)) {
    const source = readFileSync(file, 'utf8');
    for (const match of source.matchAll(/[a-z_]+!([a-z_]+_fkey)/g)) {
      found.set(match[1], file);
    }
  }

  assert.notEqual(found.size, 0, 'no hints found at all — has the syntax changed?');

  for (const [hint, file] of found) {
    assert.ok(
      ALLOWED.has(hint),
      `${file} joins on "${hint}", which is not in the list this test keeps. ` +
        'If the constraint is real, add it here and to supabase/tests/01_schema_checks.sql.',
    );
  }
});
