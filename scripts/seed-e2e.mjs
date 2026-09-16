/**
 * Puts one account, one recognisable transaction and a finished onboarding
 * behind a test user, so the smoke test opens pages that have something on
 * them. Everything goes through the service role, which bypasses Row Level
 * Security — appropriate here because this database is created and destroyed
 * by CI, and nowhere else.
 */
const url = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const email = process.env.E2E_EMAIL ?? 'smoke@moneyflow.test';
const password = process.env.E2E_PASSWORD ?? 'smoke-password-9134';

if (!url || !serviceKey) {
  console.error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required');
  process.exit(1);
}

const headers = {
  apikey: serviceKey,
  Authorization: `Bearer ${serviceKey}`,
  'Content-Type': 'application/json',
};

async function rest(path, init = {}) {
  const response = await fetch(`${url}${path}`, {
    ...init,
    headers: { ...headers, ...(init.headers ?? {}) },
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`${init.method ?? 'GET'} ${path} -> ${response.status}: ${text}`);
  }
  return text ? JSON.parse(text) : null;
}

const created = await rest('/auth/v1/admin/users', {
  method: 'POST',
  body: JSON.stringify({ email, password, email_confirm: true }),
});

const userId = created.id;
console.log(`user ${email} -> ${userId}`);

// The signup trigger has already made the profile and the default categories;
// this only finishes what onboarding would have set.
await rest(`/rest/v1/profiles?user_id=eq.${userId}`, {
  method: 'PATCH',
  headers: { Prefer: 'return=minimal' },
  body: JSON.stringify({
    onboarding_completed: true,
    currency: 'MDL',
    timezone: 'Europe/Chisinau',
    monthly_income: 20000,
    payday_day: 5,
    monthly_savings_target: 4000,
  }),
});

const [account] = await rest('/rest/v1/accounts', {
  method: 'POST',
  headers: { Prefer: 'return=representation' },
  body: JSON.stringify({
    user_id: userId,
    name: 'Smoke card',
    type: 'card',
    currency: 'MDL',
    balance: 5000,
    card_last4: '1234',
  }),
});

// The description is what the smoke test looks for: a page that renders but
// quietly drops its rows is the failure this whole exercise exists for.
await rest('/rest/v1/transactions', {
  method: 'POST',
  headers: { Prefer: 'return=minimal' },
  body: JSON.stringify({
    user_id: userId,
    account_id: account.id,
    type: 'expense',
    amount: 123.45,
    description: 'SMOKE MERCHANT',
    date: new Date().toISOString().slice(0, 10),
  }),
});

console.log('seeded: profile, account, one transaction');
