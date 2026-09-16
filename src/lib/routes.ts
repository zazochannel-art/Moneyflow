/**
 * Which paths the session proxy lets through without a signed-in user.
 *
 * Kept away from `session.ts` so it can be tested without pulling in
 * `next/server` — and because getting this list wrong is silent. A path that
 * should be public but is not gets a redirect to `/login`, and a redirect is a
 * `200` with a login page in it: the caller sees success and records nothing.
 * That is how the SMS endpoint shipped broken.
 */
const PUBLIC_PREFIXES = [
  '/login',
  '/register',
  '/forgot-password',
  '/reset-password',
  '/auth',
  '/offline',

  // The phone forwarding a bank SMS has no session and never will — that is the
  // whole design. Its credential is the token, checked inside `ingest_sms`
  // before anything is written, so a request that arrives without one writes
  // nothing. The other API routes are not here on purpose: they read the
  // signed-in user's data and must stay behind the session.
  '/api/ingest/sms',

  // The scheduler has no session either: it is Vercel calling, on a clock. Its
  // credential is `CRON_SECRET`, compared inside the route before it touches
  // the database. Left off this list it would be answered with the login page,
  // and a cron that "succeeds" every night while doing nothing is the worst
  // shape this bug takes — nobody is watching a job that never complains.
  '/api/cron',
];

export function isPublicPath(pathname: string) {
  return (
    pathname === '/' ||
    PUBLIC_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`))
  );
}
