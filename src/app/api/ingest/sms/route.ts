import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { parseBankSms, smsFingerprint } from '@/lib/sms/parse';
import { sendPush, type PushTarget } from '@/lib/push/send';

// Nothing here is cacheable: every call is a write, and the phone sends one per
// purchase.
export const dynamic = 'force-dynamic';

/** Longer than any bank SMS; past this it is not a bank SMS. */
const MAX_BODY = 2000;

/**
 * Shorter than this is not a token this app ever issued. `ingest_sms` refuses
 * the same length, and that check is the one that matters; this one only keeps
 * junk sent at a public endpoint from costing a database round trip each.
 */
const MIN_TOKEN = 20;

/**
 * Receives a bank SMS forwarded from the phone and turns it into a transaction.
 *
 * There is no session here — the caller is an automation app, not a browser —
 * so the token in the body is the whole credential, and `ingest_sms` checks it
 * in the database before anything is written. This route never decides who the
 * user is; it only parses text and hands the result over.
 *
 * Every outcome answers 200 with a `status`, including the refusals. A forwarder
 * that retries on failure would otherwise replay a message the parser has
 * already, deliberately, declined to record.
 */
export async function POST(request: Request) {
  const { token, text } = await readRequest(request);

  if (token.length < MIN_TOKEN || !text.trim()) {
    return NextResponse.json({ status: 'bad_request' }, { status: 400 });
  }

  const parsed = parseBankSms(text);
  const fingerprint = smsFingerprint(text);
  const supabase = await createClient();

  if (!parsed.ok) {
    // A declined payment moved no money, so there is nothing to record and
    // nothing to report. Anything unreadable goes to the bell with its text,
    // where it can be seen and turned into a pattern.
    if (parsed.reason === 'declined') {
      return NextResponse.json({ status: 'skipped', reason: 'declined' });
    }

    await supabase.rpc('ingest_sms', {
      p_token: token,
      p_amount: null,
      p_type: 'expense',
      p_description: null,
      p_date: null,
      p_card_last4: null,
      p_source_ref: fingerprint,
      p_raw: text,
    });

    // The bell already has it. This is the same sentence, delivered to the
    // phone, because the whole point of the unreadable case is that nobody is
    // looking at the app when it happens.
    await notify(supabase, token, {
      title: 'Mesaj neînțeles de la bancă',
      body: text.slice(0, 120),
    });

    return NextResponse.json({ status: 'skipped', reason: 'unrecognised' });
  }

  const { tx } = parsed;
  const { data, error } = await supabase.rpc('ingest_sms', {
    p_token: token,
    p_amount: tx.amount,
    p_type: tx.type,
    p_description: tx.merchant,
    p_date: null, // the bank does not date the message; it arrives as it happens
    p_card_last4: tx.cardLast4,
    p_source_ref: fingerprint,
    p_raw: text,
  });

  if (error) {
    return NextResponse.json({ status: 'error' }, { status: 500 });
  }

  if (data) {
    await notify(supabase, token, {
      title: `−${tx.amount} ${tx.currency}`,
      body: tx.merchant ?? '',
      url: '/transactions',
    });
  }

  // A null id means the token was wrong, or this exact message already landed.
  // The two are answered the same way on purpose: an endpoint that tells a
  // caller which of those it was becomes a way to test tokens. Nothing is
  // pushed in that case either, for the same reason.
  return NextResponse.json(
    data ? { status: 'recorded', amount: tx.amount, merchant: tx.merchant } : { status: 'ignored' },
  );
}

/**
 * Two shapes, because the forwarder on the phone builds the request by string
 * concatenation.
 *
 * JSON is the obvious one and breaks the moment a message contains a quote or a
 * line break — the request never reaches the parser, and a 400 tells nobody
 * anything. So the plain-text form exists too: the token travels in a header
 * and the body is the message, untouched, with nothing to escape.
 */
async function readRequest(request: Request): Promise<{ token: string; text: string }> {
  const headerToken = (request.headers.get('x-moneyflow-token') ?? '').trim();
  const queryToken = (new URL(request.url).searchParams.get('token') ?? '').trim();
  const contentType = request.headers.get('content-type') ?? '';

  if (contentType.includes('application/json')) {
    const payload = (await request.json().catch(() => null)) as {
      token?: unknown;
      text?: unknown;
    } | null;

    return {
      token: typeof payload?.token === 'string' ? payload.token.trim() : headerToken || queryToken,
      text: typeof payload?.text === 'string' ? payload.text.slice(0, MAX_BODY) : '',
    };
  }

  const body = await request.text().catch(() => '');
  return { token: headerToken || queryToken, text: body.slice(0, MAX_BODY) };
}

/**
 * Sends the same news to the phone, and never lets that failure matter.
 *
 * The transaction is already written by the time this runs. A push service
 * being unreachable, or the phone having revoked its subscription, cannot be
 * allowed to turn a recorded expense into an error — so every path here ends
 * quietly.
 */
async function notify(
  supabase: Awaited<ReturnType<typeof createClient>>,
  token: string,
  message: { title: string; body: string; url?: string },
): Promise<void> {
  try {
    const { data, error } = await supabase.rpc('sms_push_targets', { p_token: token });
    if (error || !data) return;

    const targets = data as PushTarget[];
    const { expired } = await sendPush(targets, message);

    // A push service that says a subscription is gone is telling the truth;
    // keeping it would mean trying forever.
    if (expired.length > 0) {
      await supabase.from('push_subscriptions').delete().in('endpoint', expired);
    }
  } catch (error) {
    console.error('[moneyflow] could not notify the phone:', error);
  }
}
