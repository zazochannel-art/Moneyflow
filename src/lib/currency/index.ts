/**
 * Exchange rates behind a provider interface.
 *
 * Accounts can be held in different currencies while the profile reports in
 * one, so the totals need a conversion somewhere. Which service supplies it is
 * a deployment decision, not an application one — swap the provider here and
 * nothing else in the app changes.
 */

import type { CurrencyCode } from '@/lib/types/database';

export const CURRENCIES: CurrencyCode[] = ['MDL', 'EUR', 'USD', 'RON'];

export interface RateTable {
  base: CurrencyCode;
  /** Units of `base` per one unit of the keyed currency. */
  rates: Record<CurrencyCode, number>;
  fetchedAt: string;
  provider: string;
  /**
   * True when the numbers are the built-in approximations rather than a rate
   * anyone published today. The UI has to say so — a total converted at a
   * guessed rate looks exactly like one converted at a real rate, and that is
   * the whole problem with a silent fallback.
   */
  approximate: boolean;
}

export interface ExchangeRateProvider {
  readonly name: string;
  /** True for a source that is not a rate anyone published. */
  readonly approximate: boolean;
  getRates(base: CurrencyCode): Promise<Omit<RateTable, 'approximate'>>;
}

/**
 * Offline fallback. Deliberately approximate and clearly labelled: it exists so
 * a multi-currency total is never blank, not so anyone trades on it.
 */
const STATIC_RATES: Record<CurrencyCode, Record<CurrencyCode, number>> = {
  MDL: { MDL: 1, EUR: 19.5, USD: 17.9, RON: 3.9 },
  EUR: { MDL: 0.0513, EUR: 1, USD: 0.918, RON: 0.2 },
  USD: { MDL: 0.0559, EUR: 1.089, USD: 1, RON: 0.218 },
  RON: { MDL: 0.2564, EUR: 5.0, USD: 4.59, RON: 1 },
};

export const staticProvider: ExchangeRateProvider = {
  name: 'static',
  approximate: true,
  async getRates(base) {
    return {
      base,
      rates: STATIC_RATES[base] ?? STATIC_RATES.MDL,
      fetchedAt: new Date().toISOString(),
      provider: 'static',
    };
  },
};

/** Rejects anything that is not a usable positive rate. */
function positive(value: number | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function twoDigit(n: number): string {
  return String(n).padStart(2, '0');
}

/**
 * Banca Națională a Moldovei — the official daily rate.
 *
 * This is first in the chain because it is the only source in it that publishes
 * the Moldovan leu at all. The app's default currency is MDL, so a provider
 * that cannot price MDL cannot price anything this app is asked to total.
 *
 * The feed answers with one `<Valute>` block per currency, carrying `Value`
 * lei for `Nominal` units. Rather than depend on an XML parser for a flat,
 * fixed shape, the blocks are read directly — and the whole response is
 * rejected unless every currency the table needs came back as a positive
 * number, so a changed feed falls through to the next provider instead of
 * producing a table with holes in it.
 */
export const bnmProvider: ExchangeRateProvider = {
  name: 'bnm',
  approximate: false,
  async getRates(base) {
    const now = new Date();
    const date = `${twoDigit(now.getDate())}.${twoDigit(now.getMonth() + 1)}.${now.getFullYear()}`;
    const url = `https://www.bnm.md/en/official_exchange_rates?get_xml=1&date=${date}`;

    const response = await fetch(url, { next: { revalidate: 60 * 60 * 6 } });
    if (!response.ok) throw new Error(`bnm responded ${response.status}`);

    const xml = await response.text();

    // Lei per one unit of each currency. The leu itself is never in the feed.
    const leiPer: Partial<Record<CurrencyCode, number>> = { MDL: 1 };

    for (const block of xml.match(/<Valute\b[\s\S]*?<\/Valute>/g) ?? []) {
      const code = block.match(/<CharCode>\s*([A-Z]{3})\s*<\/CharCode>/)?.[1];
      if (!code || !CURRENCIES.includes(code as CurrencyCode)) continue;

      const nominal = Number(block.match(/<Nominal>\s*([\d.,]+)\s*<\/Nominal>/)?.[1]?.replace(',', '.'));
      const value = Number(block.match(/<Value>\s*([\d.,]+)\s*<\/Value>/)?.[1]?.replace(',', '.'));
      if (!positive(nominal) || !positive(value)) continue;

      leiPer[code as CurrencyCode] = value / nominal;
    }

    const missing = CURRENCIES.filter((c) => !positive(leiPer[c]));
    if (missing.length > 0) throw new Error(`bnm did not quote ${missing.join(', ')}`);

    const perBase = leiPer[base] as number;
    const rates = Object.fromEntries(
      CURRENCIES.map((code) => [code, (leiPer[code] as number) / perBase]),
    ) as Record<CurrencyCode, number>;

    return { base, rates, fetchedAt: new Date().toISOString(), provider: 'bnm' };
  },
};

/** frankfurter.app — free, keyless, ECB-derived. Has no MDL; used for the rest. */
export const frankfurterProvider: ExchangeRateProvider = {
  name: 'frankfurter',
  approximate: false,
  async getRates(base) {
    const symbols = CURRENCIES.filter((c) => c !== base);
    const url = `https://api.frankfurter.app/latest?from=${base}&to=${symbols.join(',')}`;

    const response = await fetch(url, { next: { revalidate: 60 * 60 * 6 } });
    if (!response.ok) throw new Error(`frankfurter responded ${response.status}`);

    const payload = (await response.json()) as { rates?: Record<string, number> };
    const rates = { [base]: 1 } as Record<CurrencyCode, number>;

    for (const code of symbols) {
      const perBase = payload.rates?.[code];
      // The API gives "how much CODE per 1 BASE"; the table wants the inverse.
      if (!positive(perBase)) throw new Error(`frankfurter did not quote ${code}`);
      rates[code] = 1 / perBase;
    }

    return { base, rates, fetchedAt: new Date().toISOString(), provider: 'frankfurter' };
  },
};

/**
 * Tried in order, first one that answers wins.
 *
 * `EXCHANGE_RATES_PROVIDER=static` pins the built-in table, for a deployment
 * that would rather not make the call at all.
 */
export function getProviderChain(): ExchangeRateProvider[] {
  if (process.env.EXCHANGE_RATES_PROVIDER === 'static') return [staticProvider];
  return [bnmProvider, frankfurterProvider];
}

/** Never fails a page render over an exchange rate; says so when it falls back. */
export async function getRates(base: CurrencyCode): Promise<RateTable> {
  for (const provider of getProviderChain()) {
    try {
      return { ...(await provider.getRates(base)), approximate: provider.approximate };
    } catch (error) {
      console.error(`[moneyflow] exchange rates from ${provider.name} failed:`, error);
    }
  }

  return { ...(await staticProvider.getRates(base)), approximate: staticProvider.approximate };
}

export function convert(amount: number, from: CurrencyCode, table: RateTable): number {
  if (from === table.base) return amount;
  const rate = table.rates[from];
  return positive(rate) ? amount * rate : amount;
}
