import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { PageHeader } from '@/components/shared/page-header';
import { ImportView } from '@/components/import/import-view';
import { createClient } from '@/lib/supabase/server';
import { getCurrentUser } from '@/lib/supabase/user';
import { rows } from '@/lib/data/result';
import { getT } from '@/lib/i18n/server';
import type { Account } from '@/lib/types/database';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Import · MONEYFLOW' };

export default async function ImportPage() {
  const supabase = await createClient();
  const user = await getCurrentUser();
  if (!user) redirect('/login');

  const accountsRes = await supabase
    .from('accounts')
    .select('*')
    .eq('is_archived', false)
    .order('created_at');

  const { t } = await getT();

  return (
    <div className="space-y-5">
      <PageHeader title={t('import.title')} description={t('import.subtitle')} />
      <ImportView accounts={rows<Account>(accountsRes, 'accounts')} />
    </div>
  );
}
