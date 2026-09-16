import { defineConfig } from '@playwright/test';

/**
 * Drives the built app, not the dev server: the failures worth catching here
 * are production-build failures, and `next dev` papers over some of them.
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: process.env.CI ? [['github'], ['list']] : [['list']],
  timeout: 60_000,
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://127.0.0.1:3000',
    trace: 'retain-on-failure',
  },
});
