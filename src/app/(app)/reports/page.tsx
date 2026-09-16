import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { ReportsView } from '@/components/reports/reports-view';
import { createClient } from '@/lib/supabase/server';
import { getCurrentUser } from '@/lib/supabase/user';
import type { MonthlyReport } from '@/lib/types/database';
import { rows } from '@/lib/data/result';

export const metadata: Metadata = { title: 'Rapoarte' };
export const dynamic = 'force-dynamic';

export default async function ReportsPage() {
  const supabase = await createClient();
  const user = await getCurrentUser();
  if (!user) redirect('/login');

  const result = await supabase
    .from('monthly_reports')
    .select('*')
    .order('year', { ascending: false })
    .order('month', { ascending: false })
    .limit(12);

  return <ReportsView reports={rows<MonthlyReport>(result, 'the monthly reports')} />;
}
