import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { AccountsView } from '@/components/accounts/accounts-view';
import { createClient } from '@/lib/supabase/server';
import { getCurrentUser } from '@/lib/supabase/user';
import type { Account, Profile } from '@/lib/types/database';
import { rows } from '@/lib/data/result';

export const metadata: Metadata = { title: 'Conturi' };
export const dynamic = 'force-dynamic';

export default async function AccountsPage() {
  const supabase = await createClient();
  const user = await getCurrentUser();
  if (!user) redirect('/login');

  const [accountsRes, profileRes] = await Promise.all([
    supabase.from('accounts').select('*').order('created_at'),
    supabase.from('profiles').select('currency').eq('user_id', user.id).maybeSingle(),
  ]);

  const all = (rows<Account>(accountsRes, 'accounts')).map((a) => ({ ...a, balance: Number(a.balance) }));
  const currency = (profileRes.data as Pick<Profile, 'currency'> | null)?.currency ?? 'MDL';

  return (
    <AccountsView
      accounts={all.filter((a) => !a.is_archived)}
      archived={all.filter((a) => a.is_archived)}
      currency={currency}
    />
  );
}
