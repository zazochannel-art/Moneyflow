'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { ArrowRight, CheckCircle2, Sparkles, TriangleAlert, XCircle } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { MoneyInput } from '@/components/shared/money-input';
import { cn } from '@/lib/utils';
import { useI18n } from '@/lib/i18n/context';
import { formatMoney, parseAmount } from '@/lib/format';
import { evaluateAfford } from '@/lib/finance/afford';
import type { DailyBudgetResult } from '@/lib/finance/daily-budget';
import type { Goal } from '@/lib/types/database';

const VERDICT = {
  yes: { icon: CheckCircle2, tone: 'text-success', bg: 'bg-success/10', ring: 'border-success/40' },
  careful: { icon: TriangleAlert, tone: 'text-warning', bg: 'bg-warning/10', ring: 'border-warning/40' },
  no: { icon: XCircle, tone: 'text-danger', bg: 'bg-danger/10', ring: 'border-danger/40' },
} as const;

/**
 * "Can I afford it?" on the dashboard, answering as you type.
 *
 * The verdict runs through the same `evaluateAfford` as the full page — this is
 * a smaller window onto one function, not a second opinion. What it leaves out
 * is the reasoning: which goal slips and by how long lives on the page, and the
 * card links there rather than trying to fit it.
 */
export function AffordCard({
  budget,
  savingsBalance,
  monthlySavingsTarget,
  goals,
}: {
  budget: DailyBudgetResult;
  savingsBalance: number;
  monthlySavingsTarget: number;
  goals: Goal[];
}) {
  const { t, lang, currency } = useI18n();
  const [raw, setRaw] = useState('');

  const price = parseAmount(raw);
  const result = useMemo(() => {
    if (!price || price <= 0) return null;
    return evaluateAfford({ price, budget, savingsBalance, monthlySavingsTarget, goals });
  }, [price, budget, savingsBalance, monthlySavingsTarget, goals]);

  const money = (value: number) => formatMoney(value, currency, lang);
  const verdict = result ? VERDICT[result.verdict] : null;
  const Icon = verdict?.icon;

  return (
    <Card className="flex flex-col gap-4 p-5">
      <div className="flex items-center gap-2">
        <span className="flex size-8 items-center justify-center rounded-lg bg-primary/15 text-primary">
          <Sparkles className="size-4" aria-hidden />
        </span>
        <p className="font-semibold">{t('afford.title')}</p>
      </div>

      <MoneyInput
        value={raw}
        onChange={(event) => setRaw(event.target.value)}
        currency={currency}
        aria-label={t('afford.price')}
        placeholder={t('afford.whatPlaceholder')}
      />

      {result && verdict && Icon ? (
        <div className={cn('animate-fade space-y-2 rounded-xl border p-4', verdict.bg, verdict.ring)}>
          <p className={cn('flex items-center gap-2 font-semibold', verdict.tone)}>
            <Icon className="size-5 shrink-0" aria-hidden />
            {t(`afford.${result.verdict}`)}
          </p>
          <dl className="space-y-1 text-sm">
            <div className="flex items-center justify-between gap-3">
              <dt className="text-muted-foreground">{t('afford.dailyAfter')}</dt>
              <dd className="mf-tabular font-medium">{money(Math.max(0, result.dailyAfter))}</dd>
            </div>
            <div className="flex items-center justify-between gap-3">
              <dt className="text-muted-foreground">{t('afford.remainingAfter')}</dt>
              <dd className={cn('mf-tabular font-medium', result.remainingAfter < 0 && 'text-danger')}>
                {money(result.remainingAfter)}
              </dd>
            </div>
          </dl>
          {result.affectedGoal ? (
            <p className="pt-0.5 text-xs text-muted-foreground">
              {result.affectedGoal.name} · +{Math.ceil(result.affectedGoal.monthsDelayed)}{' '}
              {t('common.months')}
            </p>
          ) : null}
        </div>
      ) : (
        <p className="rounded-xl border border-dashed border-border/70 p-4 text-center text-xs text-muted-foreground">
          {t('afford.subtitle')}
        </p>
      )}

      <Link
        href="/afford"
        className="flex items-center gap-1 text-xs font-medium text-primary hover:underline"
      >
        {t('dashboard.viewAll')}
        <ArrowRight className="size-3.5" aria-hidden />
      </Link>
    </Card>
  );
}
