'use client';

import { ArrowDownRight, ArrowUpRight, PiggyBank } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { useI18n } from '@/lib/i18n/context';
import { formatMoney } from '@/lib/format';
import type { RateTable } from '@/lib/currency';

/** What to call each source on screen. */
const SOURCE_NAMES: Record<string, string> = { bnm: 'BNM', frankfurter: 'BCE' };

export function BalanceSummary({
  total,
  income,
  expenses,
  savings,
  rates,
}: {
  total: number;
  income: number;
  expenses: number;
  savings: number;
  /** Null when every account is already in the profile currency. */
  rates: RateTable | null;
}) {
  const { t, lang, locale, currency } = useI18n();
  const money = (value: number, sign = false) => formatMoney(value, currency, lang, { sign });

  // A converted total and an unconverted one look identical, so when a rate was
  // involved the screen says which one and from when — and says plainly when it
  // is the built-in approximation rather than a published rate.
  const note = !rates
    ? null
    : rates.approximate
      ? t('dashboard.rates.approximate')
      : t('dashboard.rates.converted', {
          source: SOURCE_NAMES[rates.provider] ?? rates.provider,
          date: new Date(rates.fetchedAt).toLocaleDateString(locale, {
            day: '2-digit',
            month: '2-digit',
          }),
        });

  return (
    <Card className="p-5">
      <p className="text-sm text-muted-foreground">{t('dashboard.totalBalance')}</p>
      <p data-testid="total-balance" className="mf-hero-number mt-1 text-3xl font-semibold sm:text-4xl">{money(total)}</p>
      {note ? <p className="mt-1 text-xs text-muted-foreground">{note}</p> : null}

      <div className="mt-4 grid grid-cols-3 gap-2 text-sm">
        <Stat
          icon={<ArrowUpRight className="size-3.5" aria-hidden />}
          tone="text-success"
          value={money(income, true)}
          label={t('dashboard.income')}
        />
        <Stat
          icon={<ArrowDownRight className="size-3.5" aria-hidden />}
          tone="text-danger"
          value={`−${formatMoney(expenses, currency, lang)}`}
          label={t('dashboard.expenses')}
        />
        <Stat
          icon={<PiggyBank className="size-3.5" aria-hidden />}
          tone="text-primary"
          value={money(savings, true)}
          label={t('dashboard.savings')}
        />
      </div>
    </Card>
  );
}

function Stat({
  icon,
  tone,
  value,
  label,
}: {
  icon: React.ReactNode;
  tone: string;
  value: string;
  label: string;
}) {
  return (
    <div className="min-w-0">
      <p className={`mf-tabular flex items-center gap-1 truncate font-medium ${tone}`}>
        {icon}
        <span className="truncate">{value}</span>
      </p>
      <p className="truncate text-xs text-muted-foreground">{label}</p>
    </div>
  );
}
