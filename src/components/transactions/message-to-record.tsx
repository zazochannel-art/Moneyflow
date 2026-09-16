'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { MessageSquareWarning, X } from 'lucide-react';
import { toast } from 'sonner';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { TransactionForm } from '@/components/transactions/transaction-form';
import { dismissMessage } from '@/app/(app)/transactions/actions';
import { useI18n } from '@/lib/i18n/context';
import type { Account, Category } from '@/lib/types/database';

/**
 * A bank message the parser could not read, with a way out of it.
 *
 * Before this, such a message reached the bell, showed its text and stopped
 * there — the money had moved and the app offered nothing to do about it. Here
 * the text is shown as it arrived, and the same form the rest of the app uses
 * is attached to it, carrying the message's fingerprint so recording it once
 * marks it dealt with and a later parser cannot count it twice.
 */
export function MessageToRecord({
  accounts,
  categories,
  text,
  sourceRef,
}: {
  accounts: Account[];
  categories: Category[];
  text: string;
  sourceRef: string;
}) {
  const { t } = useI18n();
  const router = useRouter();
  const [dismissing, startDismiss] = useTransition();
  const [gone, setGone] = useState(false);

  if (gone) return null;

  const dismiss = () => {
    startDismiss(async () => {
      const result = await dismissMessage(sourceRef);
      if (result.ok) {
        setGone(true);
        toast.success(t('tx.fromMessage.dismissed'));
        router.replace('/transactions');
        router.refresh();
      } else {
        toast.error(t(result.message ?? 'common.somethingWrong'));
      }
    });
  };

  return (
    <Card className="border-warning/40 bg-warning/5 p-5">
      <div className="flex items-start gap-3">
        <MessageSquareWarning className="mt-0.5 size-5 shrink-0 text-warning" aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold">{t('tx.fromMessage.title')}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">{t('tx.fromMessage.help')}</p>
        </div>
        <Button variant="ghost" size="sm" onClick={dismiss} disabled={dismissing}>
          <X className="size-3.5" aria-hidden />
          {t('tx.fromMessage.dismiss')}
        </Button>
      </div>

      {/* As it arrived. Nothing is highlighted or reformatted, because the
          reason it is on screen is that the app could not tell which part of it
          meant what. */}
      <p className="mt-3 rounded-lg bg-background/70 p-3 text-sm break-words whitespace-pre-wrap">
        {text}
      </p>

      <div className="mt-4">
        <TransactionForm
          accounts={accounts}
          categories={categories}
          sourceRef={sourceRef}
          onDone={() => {
            setGone(true);
            router.replace('/transactions');
            router.refresh();
          }}
        />
      </div>
    </Card>
  );
}
