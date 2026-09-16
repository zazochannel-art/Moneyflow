import 'server-only';

import webpush from 'web-push';

/**
 * Sending a notification to a phone.
 *
 * The keys are a pair: the public half is baked into the browser bundle so a
 * subscription can be addressed to this app and no other, the private half
 * stays on the server and signs every send. Without them nothing here can work,
 * and the settings screen says so rather than offering a switch that does
 * nothing.
 */
export interface PushTarget {
  endpoint: string;
  p256dh: string;
  auth: string;
}

export interface PushMessage {
  title: string;
  body: string;
  url?: string;
}

export function isPushConfigured(): boolean {
  return Boolean(
    process.env.VAPID_PRIVATE_KEY &&
      process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY &&
      process.env.VAPID_SUBJECT,
  );
}

let configured = false;

function configure() {
  if (configured) return;
  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT!,
    process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!,
    process.env.VAPID_PRIVATE_KEY!,
  );
  configured = true;
}

export interface PushOutcome {
  sent: number;
  /** Endpoints the push service says are gone; the caller should forget them. */
  expired: string[];
}

/**
 * Sends to every device, and reports which ones no longer exist.
 *
 * A failure to deliver never fails whatever caused the send: a bank SMS that
 * was recorded correctly stays recorded even if the phone cannot be reached.
 * That is why nothing here throws.
 */
export async function sendPush(targets: PushTarget[], message: PushMessage): Promise<PushOutcome> {
  if (!isPushConfigured() || targets.length === 0) return { sent: 0, expired: [] };
  configure();

  const payload = JSON.stringify({
    title: message.title,
    body: message.body,
    url: message.url ?? '/dashboard',
  });

  const results = await Promise.allSettled(
    targets.map((target) =>
      webpush.sendNotification(
        { endpoint: target.endpoint, keys: { p256dh: target.p256dh, auth: target.auth } },
        payload,
        { TTL: 60 * 60 },
      ),
    ),
  );

  const expired: string[] = [];
  let sent = 0;

  results.forEach((result, index) => {
    if (result.status === 'fulfilled') {
      sent += 1;
      return;
    }
    const status = (result.reason as { statusCode?: number } | undefined)?.statusCode;
    // 404 and 410 are the push service saying this subscription is dead. Any
    // other failure might be temporary, so the subscription is kept.
    if (status === 404 || status === 410) expired.push(targets[index].endpoint);
    else console.error('[moneyflow] push failed:', status ?? result.reason);
  });

  return { sent, expired };
}
