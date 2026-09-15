import { Database, KeyRound } from 'lucide-react';
import { getT } from '@/lib/i18n/server';
import { isSupabaseConfigured } from '@/lib/supabase/env';

export const metadata = { title: 'Setup' };

// The page reports on the environment it is running in, which the build has no
// way to know.
export const dynamic = 'force-dynamic';

/**
 * Shown when the app cannot reach a usable database. There are two ways to get
 * here and they need different fixes, so the page says which one it is rather
 * than offering one message for both:
 *
 *  - the connection details are missing, so there is nothing to talk to;
 *  - the connection works but the migrations have not been applied, which the
 *    app layout detects as an auth user with no profile row.
 *
 * Without this, a missing variable surfaced as a bare 500 — the server threw
 * inside a Server Component and the page never rendered. A deploy that is one
 * setting away from working should say so.
 */
export default async function SetupRequiredPage() {
  const { t } = await getT();
  const configured = isSupabaseConfigured();

  const Icon = configured ? Database : KeyRound;
  const title = configured ? t('error.noMigrations') : t('error.noEnv');
  const hint = configured ? t('error.noMigrationsHint') : t('error.noEnvHint');

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-4 px-6 text-center">
      <span className="flex size-14 items-center justify-center rounded-2xl bg-warning/15 text-warning">
        <Icon className="size-7" aria-hidden />
      </span>
      <div className="max-w-md space-y-3">
        <h1 className="text-xl font-semibold">{title}</h1>
        <p className="text-sm text-muted-foreground">{hint}</p>
        <div className="rounded-lg border border-border/70 bg-card/60 p-3 text-left">
          <p className="mb-1.5 text-xs font-medium text-muted-foreground">
            {configured ? 'supabase/migrations' : 'Environment'}
          </p>
          <ul className="space-y-1 font-mono text-xs text-muted-foreground">
            {configured ? (
              <li>supabase db push</li>
            ) : (
              <>
                <li>NEXT_PUBLIC_SUPABASE_URL</li>
                <li>NEXT_PUBLIC_SUPABASE_ANON_KEY</li>
                <li>NEXT_PUBLIC_SITE_URL</li>
              </>
            )}
          </ul>
        </div>
      </div>
    </main>
  );
}
