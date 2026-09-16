import 'server-only';

interface QueryResult {
  data: unknown;
  error: { message: string } | null;
}

/**
 * The rows a query returned — or a failure, said out loud.
 *
 * Reading `data ?? []` is the natural way to write this and it is wrong in a
 * way that takes days to notice: a query that failed and a query that found
 * nothing arrive as the same empty array, and every screen renders the second
 * one. That is how this app spent a week telling its owner he had no
 * transactions while three sat in the database, and how a broken export would
 * hand back an empty file that looks like an honest one.
 *
 * "I could not read this" and "there is nothing here" are different sentences.
 * Only the second is safe to draw.
 */
export function rows<T>(result: QueryResult, what: string): T[] {
  if (result.error) {
    throw new Error(`Could not read ${what}: ${result.error.message}`);
  }
  return (result.data ?? []) as T[];
}

/**
 * The same, for a list the page can do without.
 *
 * Degrading is a judgement, not a shortcut: it belongs to reads where an empty
 * result changes nothing a person would act on. Anything carrying money, or
 * feeding a number someone will spend against, uses `rows` and fails loudly.
 * The failure still reaches the runtime logs, so it is quiet on screen, never
 * quiet to us.
 */
export function rowsOrEmpty<T>(result: QueryResult, what: string): T[] {
  if (result.error) {
    console.error(`[moneyflow] could not read ${what}: ${result.error.message}`);
    return [];
  }
  return (result.data ?? []) as T[];
}
