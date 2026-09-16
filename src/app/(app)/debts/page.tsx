import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { DebtsView } from '@/components/debts/debts-view';
import { createClient } from '@/lib/supabase/server';
import { getCurrentUser } from '@/lib/supabase/user';
import type { Debt } from '@/lib/types/database';
import { rows } from '@/lib/data/result';

export const metadata: Metadata = { title: 'Datorii' };
export const dynamic = 'force-dynamic';

export default async function DebtsPage() {
  const supabase = await createClient();
  const user = await getCurrentUser();
  if (!user) redirect('/login');

  const result = await supabase
    .from('debts')
    .select('*')
    .order('status')
    .order('due_date', { nullsFirst: false });

  const debts = rows<Debt>(result, 'debts').map((debt) => ({ ...debt, amount: Number(debt.amount) }));

  return <DebtsView debts={debts} />;
}
