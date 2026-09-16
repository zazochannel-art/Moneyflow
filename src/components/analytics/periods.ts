/**
 * The range filter's values, in a module with no `'use client'` on it.
 *
 * That absence is the whole point. The analytics page is a Server Component and
 * it calls `isPeriod` to check what arrived in the query string. When these
 * lived in `period-filter.tsx`, which is a client module, the compiler turned
 * the export into a client reference and the call threw at request time:
 * "Attempted to call isPeriod() from the server but isPeriod is on the client."
 * Nothing catches that at build time — the page simply failed to open.
 *
 * So the values and the guard live here, where both sides may import them, and
 * the component next door keeps only what needs a browser.
 */
export const PERIODS = ['7d', '30d', '3m', '6m', '1y'] as const;

export type Period = (typeof PERIODS)[number];

export function isPeriod(value: unknown): value is Period {
  return typeof value === 'string' && (PERIODS as readonly string[]).includes(value);
}
