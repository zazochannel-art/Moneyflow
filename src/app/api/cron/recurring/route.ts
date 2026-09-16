import { timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { rows } from '@/lib/data/result';
import { sendPush, type PushTarget } from '@/lib/push/send';
import { createTranslator, DEFAULT_LANGUAGE, isLanguage } from '@/lib/i18n';
import { formatMoney } from '@/lib/format';
import type { CurrencyCode, LanguageCode, TransactionType } from '@/lib/types/database';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface PostedCharge {
  user_id: string;
  recurring_id: string;
  name: string;
  amount: number | string;
  type: TransactionType;
  date: string;
}

interface OwnerRow {
  user_id: string;
  language: string | null;
  currency: string | null;
}

/**
 * Posts every recurring charge that has come due, for everyone.
 *
 * This used to happen only while the dashboard was open, which meant a month
 * away from the app was a month of rent and subscriptions the balance did not
 * know about — and the phone could never be told, because nothing ran while the
 * app was closed. That is precisely the case notifications exist for.
 *
 * The dashboard still asks on open, and the two cannot collide: posting is
 * keyed on the charge and its date, so whichever runs second writes nothing.
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json({ status: 'not_configured' }, { status: 503 });
  }
  if (!presented(request, secret)) {
    return NextResponse.json({ status: 'unauthorised' }, { status: 401 });
  }

  const supabase = createAdminClient();

  let posted: PostedCharge[];
  try {
    posted = rows<PostedCharge>(await supabase.rpc('mf_run_due_recurring_all'), 'due recurring charges');
  } catch (err) {
    console.error('[moneyflow] recurring run failed:', err);
    return NextResponse.json({ status: 'error' }, { status: 500 });
  }

  if (posted.length === 0) {
    return NextResponse.json({ status: 'ok', posted: 0, notified: 0 });
  }

  // The charges are written and committed by now. Nothing below may turn a
  // recorded payment into a failed request, so the telling is best-effort.
  let notified = 0;
  try {
    notified = await tell(supabase, posted);
  } catch (err) {
    console.error('[moneyflow] could not tell anyone about the recurring run:', err);
  }

  return NextResponse.json({ status: 'ok', posted: posted.length, notified });
}

/**
 * Vercel Cron presents the secret as a bearer token. Compared in constant time
 * because a comparison that gives up early on the first wrong byte is a
 * comparison that can be guessed one byte at a time.
 */
function presented(request: Request, secret: string): boolean {
  const offered = (request.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
  const a = Buffer.from(offered);
  const b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** One notification per person, in their own language and currency. */
async function tell(
  supabase: ReturnType<typeof createAdminClient>,
  posted: PostedCharge[],
): Promise<number> {
  const byUser = new Map<string, PostedCharge[]>();
  for (const charge of posted) {
    byUser.set(charge.user_id, [...(byUser.get(charge.user_id) ?? []), charge]);
  }

  const userIds = [...byUser.keys()];

  const [profilesRes, subscriptionsRes] = await Promise.all([
    supabase.from('profiles').select('user_id, language, currency').in('user_id', userIds),
    supabase.from('push_subscriptions').select('user_id, endpoint, p256dh, auth').in('user_id', userIds),
  ]);

  const owners = new Map(
    rows<OwnerRow>(profilesRes, 'profiles for the recurring run').map((row) => [row.user_id, row]),
  );

  const targetsByUser = new Map<string, PushTarget[]>();
  for (const row of rows<PushTarget & { user_id: string }>(
    subscriptionsRes,
    'push subscriptions for the recurring run',
  )) {
    targetsByUser.set(row.user_id, [
      ...(targetsByUser.get(row.user_id) ?? []),
      { endpoint: row.endpoint, p256dh: row.p256dh, auth: row.auth },
    ]);
  }

  const expired: string[] = [];
  let notified = 0;

  for (const [userId, charges] of byUser) {
    const targets = targetsByUser.get(userId) ?? [];
    if (targets.length === 0) continue;

    const owner = owners.get(userId);
    const lang: LanguageCode = isLanguage(owner?.language) ? owner.language : DEFAULT_LANGUAGE;
    const currency = (owner?.currency ?? 'MDL') as CurrencyCode;
    const t = createTranslator(lang);

    const signed = (charge: PostedCharge) => {
      const amount = Number(charge.amount) || 0;
      return charge.type === 'income' ? amount : -amount;
    };

    const message =
      charges.length === 1
        ? {
            title: `${charges[0].name} · ${formatMoney(signed(charges[0]), currency, lang, { sign: true })}`,
            body: t('push.recurring.body'),
          }
        : {
            title: t('push.recurring.many', { count: charges.length }),
            body: t('push.recurring.manyBody', {
              total: formatMoney(
                charges.reduce((sum, charge) => sum + signed(charge), 0),
                currency,
                lang,
                { sign: true },
              ),
            }),
          };

    const result = await sendPush(targets, { ...message, url: '/transactions' });
    expired.push(...result.expired);
    notified += 1;
  }

  // A push service that says a subscription is gone is telling the truth.
  if (expired.length > 0) {
    await supabase.from('push_subscriptions').delete().in('endpoint', expired);
  }

  return notified;
}
