'use client';

import { useState, useSyncExternalStore, useTransition } from 'react';
import { Check, Copy, MessageSquareText, Smartphone } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
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
type Platform = 'ios' | 'android';

/** The user agent does not change while the page is open, so nothing to watch. */
const noSubscription = () => () => {};

const detectPlatform = (): Platform =>
  /android/i.test(navigator.userAgent) ? 'android' : 'ios';

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
  const [chosen, setChosen] = useState<Platform | null>(null);

  // The server has no user agent, so it renders the iPhone tab and the browser
  // hydrates the same one before swapping in what it actually sees. Reading it
  // this way rather than in an effect is what keeps the two renders identical.
  const detected = useSyncExternalStore(noSubscription, detectPlatform, () => 'ios' as Platform);
  const platform = chosen ?? detected;

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

        {/* Two phones, two different apps, and nothing shared between the
            steps — so the screen shows one at a time and picks the one the
            person is holding. The request body differs for a reason: Shortcuts
            builds JSON itself and escapes what it puts in it, while the Android
            forwarders paste the message into the body by concatenation, where a
            single quote in an SMS would break the JSON before the parser ever
            saw it. */}
        <Tabs value={platform} onValueChange={(value) => setChosen(value as Platform)}>
          <TabsList>
            <TabsTrigger value="ios">{t('sms.platformIos')}</TabsTrigger>
            <TabsTrigger value="android">{t('sms.platformAndroid')}</TabsTrigger>
          </TabsList>

          <TabsContent value="ios">
            <ol className="list-decimal space-y-1.5 pl-5 text-xs text-muted-foreground">
              <li>{t('sms.iosNew')}</li>
              <li>{t('sms.iosAction')}</li>
              <li>
                {t('sms.iosMethod')} <code className="font-mono">POST</code>
              </li>
              <li>
                {t('sms.iosBody')} <code className="font-mono">JSON</code>
              </li>
              <li>
                <code className="font-mono">token</code> — {t('sms.iosFieldToken')}
              </li>
              <li>
                <code className="font-mono">text</code> — {t('sms.iosFieldText')}
              </li>
              <li>{t('sms.iosTrigger')}</li>
            </ol>
          </TabsContent>

          <TabsContent value="android">
            <ol className="list-decimal space-y-1.5 pl-5 text-xs text-muted-foreground">
              <li>{t('sms.androidApp')}</li>
              <li>{t('sms.androidTrigger')}</li>
              <li>{t('sms.androidAction')}</li>
              <li>
                {t('sms.androidContentType')} <code className="font-mono">text/plain</code>
              </li>
              <li>
                {t('sms.androidHeader')}{' '}
                <code className="font-mono break-all">X-MoneyFlow-Token: &lt;token&gt;</code>
              </li>
              <li>
                {t('sms.androidBody')} <code className="font-mono">{'{sms_message}'}</code>
              </li>
            </ol>
          </TabsContent>
        </Tabs>

        <p className="text-xs text-muted-foreground">{t('sms.test')}</p>
      </div>
    </SettingsSection>
  );
}
