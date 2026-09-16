'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { requireUser } from '@/lib/actions/auth-guard';
import { failure, success, type ActionResult } from '@/lib/actions/result';
import { rows as readRows } from '@/lib/data/result';

const rowSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  amount: z.number().finite().refine((value) => value !== 0, 'zero'),
  description: z.string().trim().max(200),
  fingerprint: z.string().min(8).max(120),
});

const payloadSchema = z.object({
  accountId: z.string().uuid(),
  /** A statement is long; this is generous and still a limit. */
  rows: z.array(rowSchema).min(1).max(2000),
  keepBalance: z.boolean(),
});

export interface ImportOutcome {
  imported: number;
  duplicates: number;
}

/**
 * Writes a parsed statement into the ledger.
 *
 * Two things here are decisions rather than mechanics.
 *
 * The rows carry a fingerprint, and the database has a unique index on it, so
 * importing the same statement twice imports it once. The count of what was
 * skipped comes back, because "nothing happened" and "it was already here" look
 * identical otherwise — the mistake this codebase has made enough times.
 *
 * And the account balance is put back where it was. A statement is history: the
 * balance someone typed is what they have now, and it already reflects every
 * line in that file. Letting the triggers subtract it all a second time would
 * leave the one number this app exists for quietly wrong.
 */
export async function importTransactions(
  payload: unknown,
): Promise<ActionResult<ImportOutcome>> {
  const session = await requireUser();
  if (!session) return failure('auth.error.session');

  const parsed = payloadSchema.safeParse(payload);
  if (!parsed.success) return failure('common.somethingWrong');

  const { accountId, rows, keepBalance } = parsed.data;
  const { supabase, userId } = session;

  const accountResult = await supabase
    .from('accounts')
    .select('id, balance')
    .eq('id', accountId)
    .maybeSingle();

  if (accountResult.error) return failure('common.somethingWrong');
  const account = accountResult.data as { id: string; balance: number } | null;
  if (!account) return failure('common.somethingWrong');

  const before = Number(account.balance);

  // `upsert` with `ignoreDuplicates` rather than `insert`: the preview filters
  // what the ledger already has, but a unique violation on one row would
  // otherwise reject the whole statement — and the row that causes it is
  // usually an honest repeat, not a mistake.
  const inserted = await supabase
    .from('transactions')
    .upsert(
      rows.map((row) => ({
        user_id: userId,
        account_id: accountId,
        type: row.amount < 0 ? ('expense' as const) : ('income' as const),
        amount: Math.abs(row.amount),
        description: row.description || null,
        date: row.date,
        source: 'import',
        source_ref: row.fingerprint,
      })),
      { onConflict: 'user_id,source_ref', ignoreDuplicates: true, count: 'exact' },
    )
    .select('id');

  if (inserted.error) {
    // A unique violation here is not "some were duplicates" — the whole insert
    // is rejected. Duplicates are filtered before this point; if one still
    // arrives, saying so is better than reporting a partial success.
    return failure('common.somethingWrong');
  }

  const written = readRows<{ id: string }>(inserted, 'the imported transactions').length;

  if (keepBalance && written > 0) {
    const restore = await supabase
      .from('accounts')
      .update({ balance: before })
      .eq('id', accountId);
    if (restore.error) return failure('common.somethingWrong');
  }

  for (const path of ['/dashboard', '/transactions', '/analytics', '/accounts', '/budgets']) {
    revalidatePath(path);
  }

  return success({ imported: written, duplicates: rows.length - written }, 'import.done');
}

/**
 * Which of these fingerprints the ledger already carries.
 *
 * Asked before writing so the preview can say "eight of these are already
 * here" instead of the import quietly doing less than it claimed.
 */
export async function findExisting(fingerprints: string[]): Promise<string[]> {
  const session = await requireUser();
  if (!session) return [];

  const wanted = fingerprints.filter((f) => typeof f === 'string').slice(0, 2000);
  if (wanted.length === 0) return [];

  const result = await session.supabase
    .from('transactions')
    .select('source_ref')
    .in('source_ref', wanted);

  return readRows<{ source_ref: string | null }>(result, 'existing imports')
    .map((row) => row.source_ref)
    .filter((ref): ref is string => typeof ref === 'string');
}
