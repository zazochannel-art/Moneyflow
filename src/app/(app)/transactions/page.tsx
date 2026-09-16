import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { Suspense } from 'react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { PageHeader } from '@/components/shared/page-header';
import { TransactionFilters } from '@/components/transactions/transaction-filters';
import { TransactionList } from '@/components/transactions/transaction-list';
import { AddTransactionButton } from '@/components/transactions/add-transaction-button';
import { createClient } from '@/lib/supabase/server';
import { getCurrentUser } from '@/lib/supabase/user';
import { getT } from '@/lib/i18n/server';
import type { Account, Category, TransactionWithRelations } from '@/lib/types/database';
import { rows } from '@/lib/data/result';

export const metadata: Metadata = { title: 'Tranzacții' };
export const dynamic = 'force-dynamic';

const PAGE_SIZE = 40;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/*
 * The `!name` after each table is the foreign key PostgREST should join on, and
 * it has to be a key that exists. These used to name the single-column keys
 * from the first migration; the ownership hardening replaced those with
 * composite ones on `(id, user_id)` — same relationships, different names — and
 * these strings kept pointing at keys that were gone.
 *
 * PostgREST answers an unresolvable embed with an error, and the code below
 * used to turn that error into an empty list. So the app did not break: it
 * calmly reported that you had no transactions. Renaming a key here is a
 * change to a query; `supabase/tests/01_schema_checks.sql` asserts these three
 * names still exist, and `tests/postgrest-hints.test.ts` asserts the code uses
 * no others.
 */
const TX_SELECT = `
  id, user_id, account_id, to_account_id, category_id, goal_id, recurring_id,
  type, amount, description, notes, date, created_at, updated_at,
  category:categories!transactions_category_owner_fkey (id, name, icon, color),
  account:accounts!transactions_account_owner_fkey (id, name, color, type),
  to_account:accounts!transactions_to_account_owner_fkey (id, name, color, type)
`;

export default async function TransactionsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const single = (key: string) => {
    const value = params[key];
    return Array.isArray(value) ? value[0] : value;
  };

  const page = Math.max(1, Number(single('page') ?? '1') || 1);
  const type = single('type');
  const categoryId = single('category');
  const accountId = single('account');
  const search = single('q')?.trim();

  const supabase = await createClient();
  const user = await getCurrentUser();
  if (!user) redirect('/login');

  let query = supabase
    .from('transactions')
    .select(TX_SELECT, { count: 'exact' })
    .order('date', { ascending: false })
    .order('created_at', { ascending: false })
    .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);

  if (type === 'income' || type === 'expense' || type === 'transfer') query = query.eq('type', type);
  if (categoryId) query = query.eq('category_id', categoryId);

  // An account matches on either side of a transfer, which needs `.or()` — and
  // `.or()` takes a filter string, not bound parameters. Everything else here
  // goes through `.eq()`/`.ilike()`, which PostgREST parameterises; this one is
  // assembled by hand, so the id is checked against the UUID shape first rather
  // than trusted because it came from a link we generated.
  if (accountId && UUID_PATTERN.test(accountId)) {
    query = query.or(`account_id.eq.${accountId},to_account_id.eq.${accountId}`);
  }

  if (search) query = query.ilike('description', `%${search.replace(/[%_]/g, '')}%`);

  const [{ data, count, error }, accountsRes, categoriesRes] = await Promise.all([
    query,
    supabase.from('accounts').select('*').eq('is_archived', false).order('created_at'),
    supabase.from('categories').select('*').order('sort_order').order('name'),
  ]);

  const transactions = rows<TransactionWithRelations>(
    { data, error },
    'transactions',
  ).map((t) => ({
    ...t,
    amount: Number(t.amount),
  }));
  const total = count ?? 0;
  const hasMore = page * PAGE_SIZE < total;
  const filtered = Boolean(type || categoryId || accountId || search);

  const { t } = await getT();

  const nextParams = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (typeof value === 'string' && key !== 'page') nextParams.set(key, value);
  }
  nextParams.set('page', String(page + 1));

  return (
    <div className="space-y-4">
      <PageHeader
        title={t('tx.title')}
        description={t('tx.count', { count: total })}
        action={<AddTransactionButton label={t('tx.add')} />}
      />

      <Suspense fallback={<Skeleton className="h-9 w-full" />}>
        <TransactionFilters
          accounts={rows<Account>(accountsRes, 'accounts')}
          categories={rows<Category>(categoriesRes, 'categories')}
        />
      </Suspense>

      <TransactionList
        transactions={transactions}
        accounts={rows<Account>(accountsRes, 'accounts')}
        categories={rows<Category>(categoriesRes, 'categories')}
        filtered={filtered}
      />

      {hasMore ? (
        <div className="flex justify-center pt-2">
          <Button variant="outline" asChild>
            <Link href={`/transactions?${nextParams.toString()}`}>{t('tx.loadMore')}</Link>
          </Button>
        </div>
      ) : null}
    </div>
  );
}
