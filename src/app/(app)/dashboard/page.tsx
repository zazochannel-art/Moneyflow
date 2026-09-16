import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { CanSpendCard } from '@/components/dashboard/can-spend-card';
import { BalanceSummary } from '@/components/dashboard/balance-summary';
import { MoneyScoreCard } from '@/components/dashboard/money-score-card';
import { UpcomingBills } from '@/components/dashboard/upcoming-bills';
import { GoalsProgress } from '@/components/dashboard/goals-progress';
import { BudgetsOverview } from '@/components/dashboard/budgets-overview';
import { RecentTransactions } from '@/components/dashboard/recent-transactions';
import { AffordCard } from '@/components/dashboard/afford-card';
import { AssistantCard } from '@/components/dashboard/assistant-card';
import { CategoryBreakdown } from '@/components/charts/category-breakdown';
import { IncomeExpenseChart } from '@/components/charts/income-expense-chart';
import { getFinancialSnapshot } from '@/lib/data/snapshot';
import { syncNotifications } from '@/lib/data/notifications';
import { createClient } from '@/lib/supabase/server';
import { getT } from '@/lib/i18n/server';
import { daysUntilPayday, toDateOnly } from '@/lib/finance/period';
import { formatDate, formatMonthName } from '@/lib/format';
import type { CategoryTotalsRow, MonthlyTotalsRow } from '@/lib/types/database';

export const metadata: Metadata = { title: 'Panou' };

// Money changes on every write; a cached dashboard is a wrong dashboard.
export const dynamic = 'force-dynamic';

/** Half a year of months is enough for the bars to show a trend without crowding. */
const TREND_MONTHS = 6;

export default async function DashboardPage() {
  // Recurring charges that came due while the app was closed are posted here,
  // before anything reads a balance, so the dashboard never shows a number
  // that yesterday's rent has already invalidated.
  const supabase = await createClient();
  await supabase.rpc('mf_run_due_recurring');

  const snapshot = await getFinancialSnapshot();
  if (!snapshot) redirect('/login');

  const { now } = snapshot;

  // The two charts come from the same RPCs the analytics page uses, so the
  // dashboard and the charts page can never disagree about a month's totals.
  const trendFrom = new Date(now.getFullYear(), now.getMonth() - (TREND_MONTHS - 1), 1);
  const monthFrom = new Date(now.getFullYear(), now.getMonth(), 1);

  // The notification sync only writes; nothing rendered below reads what it
  // produced, and the bell was already filled by the layout. Waiting for it
  // before asking for the charts bought a stale bell at the price of a round
  // trip, so it travels with them instead.
  const [monthlyRes, categoryRes] = await Promise.all([
    supabase.rpc('mf_monthly_totals', {
      p_from: toDateOnly(trendFrom),
      p_to: toDateOnly(now),
    }),
    supabase.rpc('mf_category_totals', {
      p_from: toDateOnly(monthFrom),
      p_to: toDateOnly(now),
      p_type: 'expense',
    }),
    syncNotifications(snapshot),
  ]);

  const { t, lang } = await getT(snapshot.profile.language);
  const untilPayday = daysUntilPayday(snapshot.profile.payday_day, now);
  const firstName = snapshot.profile.name?.trim().split(/\s+/)[0];

  const monthly = ((monthlyRes.data ?? []) as MonthlyTotalsRow[]).map((row) => {
    const date = new Date(row.period);
    return {
      label: formatMonthName(date.getFullYear(), date.getMonth() + 1, lang).split(' ')[0] ?? '',
      income: Number(row.income),
      expense: Number(row.expense),
    };
  });

  const categories = ((categoryRes.data ?? []) as CategoryTotalsRow[]).map((row) => ({
    id: row.category_id,
    name: row.name,
    icon: row.icon,
    color: row.color,
    total: Number(row.total),
  }));

  const emergencyGap = Math.max(
    0,
    (snapshot.profile.emergency_fund_target || snapshot.monthExpenses * 3) - snapshot.savingsBalance,
  );

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-end justify-between gap-2">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">
            {t('dashboard.greeting', { name: firstName ? `, ${firstName}` : '' })}
          </h1>
          <p className="text-sm text-muted-foreground">
            {untilPayday === 0
              ? t('dashboard.nextPaydayToday')
              : t('dashboard.nextPayday', { days: untilPayday })}
          </p>
        </div>
        <p className="text-sm text-muted-foreground">{formatDate(now, lang, 'long')}</p>
      </header>

      {/* One column on a phone, two once there is room, and a rail alongside
          them on a wide screen. The rail holds what you glance at; the main
          column holds what you act on. */}
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_21rem]">
        <div className="min-w-0 space-y-4">
          <div className="grid gap-4 lg:grid-cols-2">
            <CanSpendCard budget={snapshot.dailyBudget} />
            <BalanceSummary
              total={snapshot.totalBalance}
              income={snapshot.monthIncome}
              expenses={snapshot.monthExpenses}
              savings={snapshot.savedThisMonth}
            />
          </div>

          {monthly.length > 0 || categories.length > 0 ? (
            <div className="grid gap-4 lg:grid-cols-2">
              {monthly.length > 0 ? <IncomeExpenseChart data={monthly} /> : null}
              {categories.length > 0 ? <CategoryBreakdown slices={categories} /> : null}
            </div>
          ) : null}

          <div className="grid gap-4 lg:grid-cols-2">
            <BudgetsOverview lines={snapshot.budgetLines} />
            <AffordCard
              budget={snapshot.dailyBudget}
              savingsBalance={snapshot.savingsBalance}
              monthlySavingsTarget={snapshot.profile.monthly_savings_target}
              goals={snapshot.goals}
            />
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <GoalsProgress goals={snapshot.goals} />
            <MoneyScoreCard
              score={snapshot.moneyScore}
              savingsTarget={snapshot.profile.monthly_savings_target}
              savedThisMonth={snapshot.savedThisMonth}
              emergencyGap={emergencyGap}
              debtOwed={snapshot.debtOwed}
              compact
            />
          </div>
        </div>

        <aside className="min-w-0 space-y-4">
          <AssistantCard />
          <RecentTransactions transactions={snapshot.recentTransactions} />
          <UpcomingBills bills={snapshot.upcomingBills} />
        </aside>
      </div>
    </div>
  );
}
