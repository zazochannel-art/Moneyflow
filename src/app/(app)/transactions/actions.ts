'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { requireUser } from '@/lib/actions/auth-guard';
import { failure, fieldFailure, success, type ActionResult } from '@/lib/actions/result';
import { dateField, optionalUuid, positiveAmount, shortText, str, uuidField } from '@/lib/actions/validate';

const APP_PATHS = [
  '/dashboard',
  '/transactions',
  '/accounts',
  '/budgets',
  '/analytics',
  '/afford',
  '/goals',
];

function revalidateMoney() {
  for (const path of APP_PATHS) revalidatePath(path);
}

const baseSchema = z.object({
  type: z.enum(['income', 'expense', 'transfer']),
  amount: positiveAmount,
  account_id: uuidField,
  to_account_id: optionalUuid,
  category_id: optionalUuid,
  date: dateField,
  description: shortText(120),
  notes: shortText(500),
  /**
   * Set only when this transaction is being written for a bank message the
   * parser could not read. It is the message's fingerprint, and it is what
   * stops the same message counting twice if a later parser learns to read it.
   */
  source_ref: z.string().trim().max(200).optional(),
});

function parse(form: FormData) {
  return baseSchema.safeParse({
    type: str(form, 'type'),
    amount: str(form, 'amount'),
    account_id: str(form, 'account_id'),
    to_account_id: str(form, 'to_account_id'),
    category_id: str(form, 'category_id'),
    date: str(form, 'date'),
    description: str(form, 'description'),
    notes: str(form, 'notes'),
    source_ref: str(form, 'source_ref') || undefined,
  });
}

/** Turns a zod failure into the field errors the form renders. */
function fieldErrors(issues: z.core.$ZodIssue[]) {
  const fields: Record<string, 'tx.error.amount' | 'tx.error.account' | 'tx.error.date' | 'common.required'> = {};
  for (const issue of issues) {
    const key = String(issue.path[0] ?? '');
    if (key === 'amount') fields.amount = 'tx.error.amount';
    else if (key === 'account_id') fields.account_id = 'tx.error.account';
    else if (key === 'date') fields.date = 'tx.error.date';
    else fields[key] = 'common.required';
  }
  return fields;
}

export async function createTransaction(
  _prev: ActionResult,
  form: FormData,
): Promise<ActionResult> {
  const session = await requireUser();
  if (!session) return failure('auth.error.session');

  const parsed = parse(form);
  if (!parsed.success) return fieldFailure(fieldErrors(parsed.error.issues));

  const input = parsed.data;

  if (input.type === 'transfer') {
    if (!input.to_account_id) return fieldFailure({ to_account_id: 'tx.error.account' });
    if (input.to_account_id === input.account_id) {
      return fieldFailure({ to_account_id: 'tx.error.sameAccount' });
    }
  }

  // A fingerprint the client sent is not evidence of anything on its own, so it
  // only counts when it matches a message this user actually received. Without
  // that check a form could stamp any reference it liked onto a transaction and
  // block a real message from ever being recorded, since the reference is
  // unique per user.
  const fromMessage = input.source_ref
    ? await messageAwaiting(session, input.source_ref)
    : false;

  const { error } = await session.supabase.from('transactions').insert({
    user_id: session.userId,
    type: input.type,
    amount: input.amount,
    account_id: input.account_id,
    to_account_id: input.type === 'transfer' ? input.to_account_id : null,
    category_id: input.type === 'transfer' ? null : input.category_id,
    date: input.date,
    description: input.description,
    notes: input.notes,
    ...(fromMessage ? { source: 'sms', source_ref: input.source_ref } : {}),
  });

  if (error) return failure('common.somethingWrong');

  // The message has been dealt with, so the bell should stop asking. Done after
  // the insert, and only if it succeeded: a notification removed next to a
  // transaction that was never written is the message lost for good.
  if (fromMessage) {
    await session.supabase
      .from('notifications')
      .delete()
      .eq('kind', 'sms_unparsed')
      .eq('dedupe_key', input.source_ref!);
  }

  revalidateMoney();
  return success(undefined, 'tx.saved');
}

/** Is there an unread bank message with this fingerprint, waiting to be recorded? */
async function messageAwaiting(
  session: NonNullable<Awaited<ReturnType<typeof requireUser>>>,
  sourceRef: string,
): Promise<boolean> {
  const { data, error } = await session.supabase
    .from('notifications')
    .select('id')
    .eq('kind', 'sms_unparsed')
    .eq('dedupe_key', sourceRef)
    .maybeSingle();

  if (error) {
    console.error('[moneyflow] could not check the message reference:', error.message);
    return false;
  }
  return Boolean(data);
}

export async function updateTransaction(
  _prev: ActionResult,
  form: FormData,
): Promise<ActionResult> {
  const session = await requireUser();
  if (!session) return failure('auth.error.session');

  const id = uuidField.safeParse(str(form, 'id'));
  if (!id.success) return failure('common.somethingWrong');

  const parsed = parse(form);
  if (!parsed.success) return fieldFailure(fieldErrors(parsed.error.issues));

  const input = parsed.data;

  if (input.type === 'transfer') {
    if (!input.to_account_id) return fieldFailure({ to_account_id: 'tx.error.account' });
    if (input.to_account_id === input.account_id) {
      return fieldFailure({ to_account_id: 'tx.error.sameAccount' });
    }
  }

  const { error } = await session.supabase
    .from('transactions')
    .update({
      type: input.type,
      amount: input.amount,
      account_id: input.account_id,
      to_account_id: input.type === 'transfer' ? input.to_account_id : null,
      category_id: input.type === 'transfer' ? null : input.category_id,
      date: input.date,
      description: input.description,
      notes: input.notes,
    })
    .eq('id', id.data);

  if (error) return failure('common.somethingWrong');

  revalidateMoney();
  return success(undefined, 'tx.updated');
}

export async function deleteTransaction(id: string): Promise<ActionResult> {
  const session = await requireUser();
  if (!session) return failure('auth.error.session');

  if (!uuidField.safeParse(id).success) return failure('common.somethingWrong');

  const { error } = await session.supabase.from('transactions').delete().eq('id', id);
  if (error) return failure('common.somethingWrong');

  revalidateMoney();
  return success(undefined, 'tx.deleted');
}

/**
 * Drops a bank message the parser could not read, without recording anything.
 *
 * The other half of making that message actionable. Not everything a bank sends
 * is money leaving: a balance enquiry, a card blocked and unblocked, an advert.
 * Without this the only way to clear one would be to invent a transaction for
 * it, which is worse than the dead end it replaces.
 */
export async function dismissMessage(dedupeKey: string): Promise<ActionResult> {
  const session = await requireUser();
  if (!session) return failure('auth.error.session');

  const { error } = await session.supabase
    .from('notifications')
    .delete()
    .eq('kind', 'sms_unparsed')
    .eq('dedupe_key', dedupeKey);

  if (error) return failure('common.somethingWrong');

  revalidatePath('/transactions');
  return success(undefined, 'tx.fromMessage.dismissed');
}
