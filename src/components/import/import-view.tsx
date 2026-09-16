'use client';

import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { FileUp } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Field } from '@/components/shared/field';
import { useI18n } from '@/lib/i18n/context';
import { formatMoney } from '@/lib/format';
import type { Account } from '@/lib/types/database';
import {
  fingerprintAll,
  guessMapping,
  parseDelimited,
  readRows,
  type ColumnMapping,
  type ParsedRow,
  type Sheet,
} from '@/lib/import/parse';
import { findExisting, importTransactions } from '@/app/(app)/import/actions';

const NONE = '__none__';
const PREVIEW_ROWS = 8;

/**
 * The file is read here, in the browser, and never uploaded.
 *
 * A bank statement is the most detailed record of a person's life that exists
 * outside their bank, and this feature does not need to hold one: the rows the
 * app keeps are the rows it would have kept anyway. What goes to the server is
 * the same shape as a manually typed transaction, and nothing else — not the
 * file, not the columns that were left unmapped.
 */
export function ImportView({ accounts }: { accounts: Account[] }) {
  const { t, lang, currency } = useI18n();
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const [sheet, setSheet] = useState<Sheet | null>(null);
  const [mapping, setMapping] = useState<ColumnMapping | null>(null);
  const [accountId, setAccountId] = useState(accounts[0]?.id ?? '');
  const [keepBalance, setKeepBalance] = useState(true);
  const [duplicates, setDuplicates] = useState<Set<string>>(new Set());

  const parsed: ParsedRow[] = useMemo(
    () => (sheet && mapping ? readRows(sheet, mapping) : []),
    [sheet, mapping],
  );

  const ready = useMemo(
    () => parsed.filter((row) => row.problem === null),
    [parsed],
  );

  // Fingerprints are computed over the whole readable set, in file order, so
  // the repeat counter is the same on every pass — including the second import
  // of the same file, which is the one that has to recognise them.
  const stamped = useMemo(
    () => ready.map((row, index) => ({ row, fingerprint: fingerprintAll(ready, accountId)[index] })),
    [ready, accountId],
  );

  const fresh = useMemo(
    () => stamped.filter(({ fingerprint }) => !duplicates.has(fingerprint)),
    [stamped, duplicates],
  );

  const problems = parsed.length - ready.length;

  async function onFile(file: File) {
    try {
      const text = await file.text();
      const next = parseDelimited(text);
      if (next.rows.length === 0) {
        toast.error(t('import.nothing'));
        return;
      }
      const guess = guessMapping(next.headers);
      setSheet(next);
      setMapping(guess);

      // Ask the ledger what it already has before showing a count, so the
      // preview is the truth rather than an optimistic guess.
      const rowsNow = readRows(next, guess).filter((row) => row.problem === null);
      const known = await findExisting(fingerprintAll(rowsNow, accountId));
      setDuplicates(new Set(known));
    } catch {
      toast.error(t('import.readFailed'));
    }
  }

  function run() {
    if (!accountId || fresh.length === 0) return;
    startTransition(async () => {
      const result = await importTransactions({
        accountId,
        keepBalance,
        rows: fresh.map(({ row, fingerprint }) => ({
          date: row.date!,
          amount: row.amount!,
          description: row.description,
          fingerprint,
        })),
      });

      if (!result.ok) {
        toast.error(t(result.error ?? 'common.somethingWrong'));
        return;
      }

      toast.success(
        t('import.result', {
          imported: result.data?.imported ?? 0,
          duplicates: (result.data?.duplicates ?? 0) + duplicates.size,
        }),
      );
      setSheet(null);
      setMapping(null);
      setDuplicates(new Set());
      router.refresh();
    });
  }

  const columnOptions = sheet?.headers.map((header, index) => ({ header, index })) ?? [];
  const twoColumns = mapping?.debit !== null || mapping?.credit !== null;

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="space-y-4 p-5">
          <Field label={t('import.pickFile')} htmlFor="statement">
            <input
              id="statement"
              type="file"
              accept=".csv,.txt,.tsv,text/csv,text/plain"
              className="block w-full text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-primary file:px-4 file:py-2 file:text-sm file:font-medium file:text-primary-foreground"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void onFile(file);
              }}
            />
          </Field>

          <Field label={t('import.account')}>
            <Select value={accountId} onValueChange={setAccountId}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {accounts.map((account) => (
                  <SelectItem key={account.id} value={account.id}>
                    {account.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        </CardContent>
      </Card>

      {sheet && mapping ? (
        <>
          <Card>
            <CardContent className="space-y-4 p-5">
              <p className="text-sm font-medium">{t('import.mapping')}</p>

              <div className="grid gap-3 sm:grid-cols-2">
                <ColumnPicker
                  label={t('import.column.date')}
                  value={mapping.date}
                  options={columnOptions}
                  onChange={(index) => setMapping({ ...mapping, date: index })}
                />
                <ColumnPicker
                  label={t('import.column.description')}
                  value={mapping.description}
                  options={columnOptions}
                  onChange={(index) => setMapping({ ...mapping, description: index })}
                />
              </div>

              <label className="flex items-center gap-3 text-sm">
                <Switch
                  checked={twoColumns}
                  onCheckedChange={(on) =>
                    setMapping(
                      on
                        ? { ...mapping, amount: null, debit: -1, credit: -1 }
                        : { ...mapping, amount: -1, debit: null, credit: null },
                    )
                  }
                />
                {t('import.twoColumns')}
              </label>

              {twoColumns ? (
                <div className="grid gap-3 sm:grid-cols-2">
                  <ColumnPicker
                    label={t('import.column.debit')}
                    value={mapping.debit ?? -1}
                    options={columnOptions}
                    onChange={(index) => setMapping({ ...mapping, debit: index, amount: null })}
                  />
                  <ColumnPicker
                    label={t('import.column.credit')}
                    value={mapping.credit ?? -1}
                    options={columnOptions}
                    onChange={(index) => setMapping({ ...mapping, credit: index, amount: null })}
                  />
                </div>
              ) : (
                <ColumnPicker
                  label={t('import.column.amount')}
                  value={mapping.amount ?? -1}
                  options={columnOptions}
                  onChange={(index) => setMapping({ ...mapping, amount: index, debit: null, credit: null })}
                />
              )}
            </CardContent>
          </Card>

          <Card>
            <CardContent className="space-y-3 p-5">
              <p className="text-sm font-medium">{t('import.preview')}</p>

              <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
                <span className="text-success">{t('import.willImport', { count: fresh.length })}</span>
                {duplicates.size > 0 ? (
                  <span className="text-muted-foreground">
                    {t('import.duplicates', { count: duplicates.size })}
                  </span>
                ) : null}
                {problems > 0 ? (
                  <span className="text-warning">{t('import.problems', { count: problems })}</span>
                ) : null}
              </div>

              <div className="mf-scroll-x">
                <table className="w-full text-xs">
                  <tbody>
                    {parsed.slice(0, PREVIEW_ROWS).map((row) => (
                      <tr key={row.line} className="border-b border-border/50 last:border-0">
                        <td className="py-1.5 pr-3 text-muted-foreground tabular-nums">{row.line}</td>
                        <td className="py-1.5 pr-3 whitespace-nowrap">{row.date ?? '—'}</td>
                        <td className="max-w-[16rem] truncate py-1.5 pr-3">{row.description || '—'}</td>
                        <td
                          className={`py-1.5 text-right whitespace-nowrap tabular-nums ${
                            row.amount === null ? '' : row.amount < 0 ? 'text-danger' : 'text-success'
                          }`}
                        >
                          {row.amount === null ? '—' : formatMoney(row.amount, currency, lang)}
                        </td>
                        <td className="py-1.5 pl-3 text-warning">
                          {row.problem ? t(`import.problem.${row.problem}`) : ''}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <p className="text-xs text-muted-foreground">{t('import.noCategories')}</p>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="space-y-3 p-5">
              <label className="flex items-start gap-3 text-sm">
                <Switch checked={keepBalance} onCheckedChange={setKeepBalance} />
                <span>
                  {t('import.keepBalance')}
                  <span className="mt-0.5 block text-xs text-muted-foreground">
                    {t('import.keepBalanceHint')}
                  </span>
                </span>
              </label>

              <Button onClick={run} disabled={pending || fresh.length === 0 || !accountId}>
                <FileUp className="size-4" aria-hidden />
                {t('import.run')}
              </Button>
            </CardContent>
          </Card>
        </>
      ) : null}
    </div>
  );
}

function ColumnPicker({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: number;
  options: Array<{ header: string; index: number }>;
  onChange: (index: number) => void;
}) {
  const { t } = useI18n();
  return (
    <Field label={label}>
      <Select
        value={value < 0 ? NONE : String(value)}
        onValueChange={(next) => onChange(next === NONE ? -1 : Number(next))}
      >
        <SelectTrigger>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={NONE}>{t('import.column.none')}</SelectItem>
          {options.map((option) => (
            <SelectItem key={option.index} value={String(option.index)}>
              {option.header || `#${option.index + 1}`}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </Field>
  );
}
