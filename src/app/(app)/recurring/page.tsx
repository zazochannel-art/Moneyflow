import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { RecurringView } from '@/components/recurring/recurring-view';
import { createClient } from '@/lib/supabase/server';
import { getCurrentUser } from '@/lib/supabase/user';
import type { Account, Category, RecurringTransaction } from '@/lib/types/database';
import { rows } from '@/lib/data/result';

export const metadata: Metadata = { title: 'Plăți recurente' };
export const dynamic = 'force-dynamic';

/** How many times a frequency lands in an average month. */
const MONTHLY_FACTOR: Record<string, number> = {
  daily: 30,
  weekly: 52 / 12,
  biweekly: 26 / 12,
  monthly: 1,
  quarterly: 1 / 3,
  yearly: 1 / 12,
};

export default async function RecurringPage() {
  const supabase = await createClient();
  const user = await getCurrentUser();
  if (!user) redirect('/login');

  const [entriesRes, accountsRes, categoriesRes] = await Promise.all([
    supabase
      .from('recurring_transactions')
      .select('*')
      .order('is_active', { ascending: false })
      .order('next_date'),
    supabase.from('accounts').select('*').eq('is_archived', false).order('created_at'),
    supabase.from('categories').select('*').order('sort_order').order('name'),
  ]);

  const entries = (rows<RecurringTransaction>(entriesRes, 'recurring charges')).map((entry) => ({
    ...entry,
    amount: Number(entry.amount),
  }));

  const monthlyTotal = entries
    .filter((entry) => entry.is_active && entry.type === 'expense')
    .reduce((sum, entry) => sum + entry.amount * (MONTHLY_FACTOR[entry.frequency] ?? 1), 0);

  return (
    <RecurringView
      entries={entries}
      accounts={rows<Account>(accountsRes, 'accounts')}
      categories={rows<Category>(categoriesRes, 'categories')}
      monthlyTotal={Math.round(monthlyTotal)}
    />
  );
}
