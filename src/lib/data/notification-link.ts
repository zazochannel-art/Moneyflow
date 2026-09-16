import type { AppNotification } from '@/lib/types/database';

/**
 * Where a notification takes you when you tap it.
 *
 * Most carry their own `href`. The one from an unreadable bank message does
 * not, and used to take you nowhere: the bell said a message had arrived that
 * the parser could not read, showed its text, and that was the end of it — the
 * money had moved and the app offered no way to say so.
 *
 * The link is derived here rather than stored, because everything it needs is
 * already on the row. Writing it into the notification would have meant
 * replacing a hundred-and-fifty-line `security definer` function to add a
 * cosmetic column, which is a poor trade for a string this file can compute.
 */
export function notificationHref(
  notification: Pick<AppNotification, 'href' | 'kind' | 'dedupe_key'>,
): string | null {
  if (notification.href) return notification.href;

  if (notification.kind === 'sms_unparsed') {
    return `/transactions?message=${encodeURIComponent(notification.dedupe_key)}`;
  }

  // A purchase the parser read perfectly well and had nowhere to put, because
  // no account exists to hold it. The way out of that one is an account.
  if (notification.kind === 'sms_no_account') return '/accounts';

  return null;
}
