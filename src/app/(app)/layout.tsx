import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { AppShell } from '@/components/layout/app-shell';
import { createClient } from '@/lib/supabase/server';
import { getCurrentUser } from '@/lib/supabase/user';
import { getLanguage } from '@/lib/i18n/server';
import { getNotifications } from '@/lib/data/notifications';
import type { Account, Category, Profile } from '@/lib/types/database';
import { rows } from '@/lib/data/result';

export default async function AppLayout({ children }: { children: ReactNode }) {
  const supabase = await createClient();
  const user = await getCurrentUser();

  if (!user) redirect('/login');

  const [profileRes, accountsRes, categoriesRes, notifications] = await Promise.all([
    supabase.from('profiles').select('*').eq('user_id', user.id).maybeSingle(),
    supabase.from('accounts').select('*').eq('is_archived', false).order('created_at'),
    supabase.from('categories').select('*').order('sort_order').order('name'),
    getNotifications(),
  ]);

  const profile = profileRes.data as Profile | null;

  // The bootstrap trigger creates the profile with the auth user, so a missing
  // one means the database has not been migrated yet — say so rather than
  // rendering an app with nothing behind it.
  if (!profile) redirect('/setup-required');
  if (!profile.onboarding_completed) redirect('/onboarding');

  return (
    <AppShell
      lang={await getLanguage(profile.language)}
      currency={profile.currency}
      name={profile.name}
      email={user.email ?? ''}
      accounts={rows<Account>(accountsRes, 'accounts')}
      categories={rows<Category>(categoriesRes, 'categories')}
      notifications={notifications}
    >
      {children}
    </AppShell>
  );
}
