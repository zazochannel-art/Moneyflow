import { test, expect, type Page } from '@playwright/test';

/**
 * Opens every signed-in page with a real session.
 *
 * This is the test the project did not have, and its absence is why three bugs
 * reached the person using the app in one morning: a page that threw on every
 * request because a Server Component called into a client module, a query whose
 * relationship names had gone stale so it returned an error the UI drew as "you
 * have nothing", and an onboarding that finished without creating the account
 * everything else hangs on. Types, lint, unit tests and the build were all
 * green through every one of them, because none of those things opens a page.
 *
 * It runs against a Supabase started by the CLI — real auth, real PostgREST,
 * real Row Level Security — because two of those three only fail there. A
 * mocked database would have kept reporting success.
 */

const EMAIL = process.env.E2E_EMAIL ?? 'smoke@moneyflow.test';
const PASSWORD = process.env.E2E_PASSWORD ?? 'smoke-password-9134';

/** Every page reachable from the navigation, with something only it renders. */
const PAGES: Array<{ path: string; expect: RegExp }> = [
  { path: '/dashboard', expect: /cheltui|spend/i },
  { path: '/transactions', expect: /Tranzac|Transaction/i },
  { path: '/analytics', expect: /Statistici|Analytics/i },
  { path: '/budgets', expect: /Buget|Budget/i },
  { path: '/goals', expect: /Obiectiv|Goal/i },
  { path: '/recurring', expect: /Recurent|Recurring|Plăți|Payments/i },
  { path: '/debts', expect: /Datorii|Debts/i },
  { path: '/accounts', expect: /Conturi|Accounts/i },
  { path: '/reports', expect: /Rapoarte|Reports/i },
  { path: '/afford', expect: /permit|afford/i },
  { path: '/settings', expect: /Setări|Settings/i },
  { path: '/assistant', expect: /Asistent|Assistant/i },
];

async function signIn(page: Page) {
  await page.goto('/login');
  await page.getByLabel(/email/i).fill(EMAIL);
  await page.getByLabel(/parol|password/i).fill(PASSWORD);
  await page.getByRole('button', { name: /intr|sign in|log in/i }).click();
  await page.waitForURL(/\/dashboard/, { timeout: 30_000 });
}

test.describe('every page opens', () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page);
  });

  for (const { path, expect: marker } of PAGES) {
    test(`${path} renders`, async ({ page }) => {
      const failures: string[] = [];
      page.on('response', (response) => {
        if (response.status() >= 500) failures.push(`${response.status()} ${response.url()}`);
      });

      await page.goto(path);

      // The bugs this catches did not look like errors; they looked like empty
      // screens and generic error pages. Both of those are what "renders" has
      // to exclude, so the assertions are: nothing served a 5xx, the app frame
      // is there, and the page put its own words on screen.
      expect(failures, `server errors on ${path}`).toEqual([]);
      await expect(page.locator('body')).not.toContainText(/something went wrong|a apărut o eroare/i);
      await expect(page.locator('body')).toContainText(marker);
    });
  }
});

test('the transactions the account owns are listed, not an empty state', async ({ page }) => {
  await signIn(page);
  await page.goto('/transactions');

  // The seed puts one recognisable expense in. It is the whole point: a page
  // that renders but silently drops the rows is the failure that started this.
  await expect(page.locator('body')).toContainText(/SMOKE MERCHANT/i);
  await expect(page.locator('body')).not.toContainText(/nu ai încă tranzac|no transactions yet/i);
});
