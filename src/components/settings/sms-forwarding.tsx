'use client';

import { useState, useTransition } from 'react';
import { Check, Copy, MessageSquareText, Smartphone } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { SettingsSection } from '@/components/settings/settings-section';
import { issueSmsToken, revokeSmsTokens } from '@/app/(app)/settings/actions';
import { useI18n } from '@/lib/i18n/context';
import { formatDate } from '@/lib/format';

/**
 * Sets up the phone's SMS forwarder.
 *
 * The token appears exactly once, when it is made: only its hash is stored, so
 * there is no second chance to read it and no way for this screen to show it
 * again. That is the point — a token this screen could re-display is a token a
 * stolen session could also read.
 */
export function SmsForwarding({
  active,
  lastUsedAt,
  endpoint,
}: {
  active: boolean;
  lastUsedAt: string | null;
  endpoint: string;
}) {
  const { t, lang } = useI18n();
  const [pending, startTransition] = useTransition();
  const [token, setToken] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const generate = () =>
    startTransition(async () => {
      const result = await issueSmsToken();
      if (result.ok && result.data) setToken(result.data.token);
    });

  const revoke = () =>
    startTransition(async () => {
      await revokeSmsTokens();
      setToken(null);
    });

  const copy = async (value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard access can be refused; the token stays selectable on screen.
    }
  };

  return (
    <SettingsSection id="sms" title={t('sms.title')} description={t('sms.subtitle')}>
      <p className="flex items-center gap-2 text-sm">
        <span
          className={`size-2 shrink-0 rounded-full ${active ? 'bg-success' : 'bg-muted-foreground/50'}`}
          aria-hidden
        />
        {active ? t('sms.active') : t('sms.inactive')}
      </p>

      {active ? (
        <p className="text-xs text-muted-foreground">
          {lastUsedAt
            ? t('sms.lastUsed', { when: formatDate(lastUsedAt, lang, 'medium') })
            : t('sms.never')}
        </p>
      ) : null}

      {token ? (
        <div className="space-y-2 rounded-xl border border-success/40 bg-success/10 p-4">
          <p className="text-sm font-medium text-success">{t('sms.once')}</p>
          <div className="flex items-center gap-2">
            <code className="min-w-0 flex-1 overflow-x-auto rounded-lg bg-background/60 px-3 py-2 font-mono text-xs break-all">
              {token}
            </code>
            <Button type="button" variant="outline" size="sm" onClick={() => copy(token)}>
              {copied ? <Check className="size-4" aria-hidden /> : <Copy className="size-4" aria-hidden />}
              {copied ? t('sms.copied') : t('sms.copy')}
            </Button>
          </div>
        </div>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <Button type="button" onClick={generate} disabled={pending}>
          <MessageSquareText className="size-4" aria-hidden />
          {active ? t('sms.regenerate') : t('sms.generate')}
        </Button>
        {active ? (
          <Button type="button" variant="outline" onClick={revoke} disabled={pending}>
            {t('sms.revoke')}
          </Button>
        ) : null}
      </div>

      {active ? (
        <p className="text-xs text-muted-foreground">{t('sms.regenerateWarning')}</p>
      ) : null}

      <Separator />

      <div className="space-y-3">
        <p className="flex items-center gap-2 text-sm font-medium">
          <Smartphone className="size-4 shrink-0" aria-hidden />
          {t('sms.howTitle')}
        </p>

        <div className="space-y-1.5">
          <p className="text-xs text-muted-foreground">{t('sms.url')}</p>
          <div className="flex items-center gap-2">
            <code className="min-w-0 flex-1 overflow-x-auto rounded-lg border border-border/70 bg-card/60 px-3 py-2 font-mono text-xs break-all">
              {endpoint}
            </code>
            <Button type="button" variant="ghost" size="sm" onClick={() => copy(endpoint)}>
              <Copy className="size-4" aria-hidden />
            </Button>
          </div>
        </div>

        {/* Kept in one place rather than split across tooltips: this is a setup
            someone does once, on a different device, reading from this screen.
            The plain-text form is the one shown because the phone builds the
            request by pasting the message in — and a message with a quote in it
            would break a JSON body before it ever reached the parser. */}
        <ol className="list-decimal space-y-1.5 pl-5 text-xs text-muted-foreground">
          <li>MacroDroid · Tasker</li>
          <li>Trigger: SMS Received → maib</li>
          <li>Action: HTTP Request → POST</li>
          <li>
            Content type: <code className="font-mono">text/plain</code>
          </li>
          <li>
            Header:{' '}
            <code className="font-mono break-all">X-MoneyFlow-Token: &lt;token&gt;</code>
          </li>
          <li>
            Body: <code className="font-mono">{'{sms_message}'}</code>
          </li>
        </ol>
      </div>
    </SettingsSection>
  );
}
