import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { isPeriod, PERIODS } from '../src/components/analytics/periods';

test('the range filter accepts exactly its own values', () => {
  for (const period of PERIODS) {
    assert.equal(isPeriod(period), true, `${period} should be accepted`);
  }
});

test('anything else arriving in the query string is refused', () => {
  for (const junk of ['', '30', '30D', 'all', '../etc', null, undefined, 7, {}, ['30d']]) {
    assert.equal(isPeriod(junk), false, `${String(junk)} should be refused`);
  }
});

// This is the regression guard, and it is about a file header rather than a
// return value on purpose. The analytics page is a Server Component that calls
// `isPeriod` on its query string. While the guard lived in the client module
// next door, the compiler replaced it with a client reference and the call threw
// at request time — the page did not open at all, and nothing said so until the
// production logs did. Put it back in a client module and this fails first.
test('the guard stays in a module the server may call', () => {
  const source = readFileSync(new URL('../src/components/analytics/periods.ts', import.meta.url), 'utf8');

  // A line that is only the directive — not the words appearing inside the
  // comment that explains why they must not be there, which is what a plain
  // substring search finds first.
  const directive = source
    .split('\n')
    .some((line) => /^\s*['"]use client['"];?\s*$/.test(line));

  assert.equal(
    directive,
    false,
    'periods.ts must not be a client module: the analytics page calls isPeriod on the server',
  );
});
