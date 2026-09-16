import test from 'node:test';
import assert from 'node:assert/strict';
import { bnmProvider, convert, getRates, staticProvider } from '../src/lib/currency';

/**
 * The shape BNM publishes: one block per currency, `Value` lei for `Nominal`
 * units. RON is quoted per ten, which is the case a parser that assumes one
 * unit gets wrong by an order of magnitude.
 */
const FEED = `<?xml version="1.0" encoding="UTF-8"?>
<ValCurs Date="16.09.2026" name="Official exchange rate">
  <Valute ID="47"><NumCode>978</NumCode><CharCode>EUR</CharCode><Nominal>1</Nominal><Name>Euro</Name><Value>19.5000</Value></Valute>
  <Valute ID="44"><NumCode>840</NumCode><CharCode>USD</CharCode><Nominal>1</Nominal><Name>Dolar SUA</Name><Value>17.9000</Value></Valute>
  <Valute ID="33"><NumCode>946</NumCode><CharCode>RON</CharCode><Nominal>10</Nominal><Name>Leu romanesc</Name><Value>39.0000</Value></Valute>
  <Valute ID="99"><NumCode>826</NumCode><CharCode>GBP</CharCode><Nominal>1</Nominal><Name>Lira</Name><Value>22.4000</Value></Valute>
</ValCurs>`;

function withFetch<T>(body: string | null, run: () => Promise<T>): Promise<T> {
  const original = globalThis.fetch;
  globalThis.fetch = (async () =>
    body === null
      ? { ok: false, status: 503, text: async () => '' }
      : { ok: true, status: 200, text: async () => body }) as unknown as typeof fetch;
  return run().finally(() => {
    globalThis.fetch = original;
  });
}

function quiet<T>(run: () => Promise<T>): Promise<T> {
  const original = console.error;
  console.error = () => {};
  return run().finally(() => {
    console.error = original;
  });
}

test('a currency quoted per ten units is not read as one', async () => {
  const table = await withFetch(FEED, () => bnmProvider.getRates('MDL'));
  assert.equal(table.rates.RON, 3.9);
  assert.equal(table.rates.EUR, 19.5);
  assert.equal(table.rates.USD, 17.9);
  assert.equal(table.rates.MDL, 1);
});

test('the leu is priced against a base that is not the leu', async () => {
  const table = await withFetch(FEED, () => bnmProvider.getRates('EUR'));
  assert.equal(table.base, 'EUR');
  assert.equal(table.rates.EUR, 1);
  assert.ok(Math.abs(table.rates.MDL - 1 / 19.5) < 1e-12);
  assert.ok(Math.abs(table.rates.USD - 17.9 / 19.5) < 1e-12);
});

test('a feed missing a currency is refused rather than half-used', async () => {
  const withoutUsd = FEED.replace(/<Valute ID="44">[\s\S]*?<\/Valute>/, '');
  await assert.rejects(
    () => withFetch(withoutUsd, () => bnmProvider.getRates('MDL')),
    /USD/,
  );
});

test('a feed quoting zero is refused', async () => {
  const zeroed = FEED.replace('<Value>19.5000</Value>', '<Value>0</Value>');
  await assert.rejects(() => withFetch(zeroed, () => bnmProvider.getRates('MDL')), /EUR/);
});

test('nothing answering leaves the table marked approximate', async () => {
  const table = await quiet(() => withFetch(null, () => getRates('MDL')));
  assert.equal(table.provider, 'static');
  assert.equal(table.approximate, true);
});

test('a published rate is not marked approximate', async () => {
  const table = await withFetch(FEED, () => getRates('MDL'));
  assert.equal(table.provider, 'bnm');
  assert.equal(table.approximate, false);
});

test('the built-in table says so even when it is the configured source', async () => {
  const table = await staticProvider.getRates('MDL');
  assert.equal(staticProvider.approximate, true);
  assert.equal(table.provider, 'static');
});

test('converting leaves the base currency untouched', () => {
  const table = { base: 'MDL', rates: { MDL: 1, EUR: 19.5, USD: 17.9, RON: 3.9 }, fetchedAt: '', provider: 'bnm', approximate: false } as const;
  assert.equal(convert(500, 'MDL', table), 500);
  assert.equal(convert(100, 'EUR', table), 1950);
});

test('an unusable rate returns the amount rather than a wrong number', () => {
  const broken = { base: 'MDL', rates: { MDL: 1, EUR: 0, USD: NaN, RON: -1 }, fetchedAt: '', provider: 'x', approximate: true } as const;
  assert.equal(convert(100, 'EUR', broken), 100);
  assert.equal(convert(100, 'USD', broken), 100);
  assert.equal(convert(100, 'RON', broken), 100);
});
