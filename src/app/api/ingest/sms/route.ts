import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { parseBankSms, smsFingerprint } from '@/lib/sms/parse';

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

  // A null id means the token was wrong, or this exact message already landed.
  // The two are answered the same way on purpose: an endpoint that tells a
  // caller which of those it was becomes a way to test tokens.
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
