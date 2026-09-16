'use client';

import { useEffect, useState, useTransition } from 'react';
import { toast } from 'sonner';
import { BellRing } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { SettingsSection } from '@/components/settings/settings-section';
import { savePushSubscription, removePushSubscription } from '@/app/(app)/settings/actions';
import { useI18n } from '@/lib/i18n/context';

/**
 * Turning phone notifications on, from the phone itself.
 *
 * On an iPhone this only works for a PWA that has been added to the Home
 * Screen — Safari in a tab cannot subscribe at all. Rather than offer a switch
 * that silently does nothing there, the screen says which of the conditions is
 * missing, because "I pressed it and nothing happened" is the worst possible
 * version of this feature.
 */
export function PushNotifications({ publicKey }: { publicKey: string | null }) {
  const { t } = useI18n();
  const [pending, startTransition] = useTransition();
  const [state, setState] = useState<'checking' | 'unsupported' | 'needs-install' | 'off' | 'on' | 'denied'>(
    'checking',
  );

  useEffect(() => {
    let cancelled = false;

    async function look() {
      if (typeof window === 'undefined') return;

      const supported = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
      if (!supported) {
        // Safari in a tab on iOS reports no PushManager; installed, it does.
        const iOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
        const installed = window.matchMedia('(display-mode: standalone)').matches;
        if (!cancelled) setState(iOS && !installed ? 'needs-install' : 'unsupported');
        return;
      }

      if (Notification.permission === 'denied') {
        if (!cancelled) setState('denied');
        return;
      }

      const registration = await navigator.serviceWorker.ready;
      const existing = await registration.pushManager.getSubscription();
      if (!cancelled) setState(existing ? 'on' : 'off');
    }

    void look();
    return () => {
      cancelled = true;
    };
  }, []);

  function enable() {
    if (!publicKey) return;
    startTransition(async () => {
      try {
        const permission = await Notification.requestPermission();
        if (permission !== 'granted') {
          setState(permission === 'denied' ? 'denied' : 'off');
          return;
        }

        const registration = await navigator.serviceWorker.ready;
        const subscription = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(publicKey),
        });

        const json = subscription.toJSON();
        const result = await savePushSubscription({
          endpoint: subscription.endpoint,
          p256dh: json.keys?.p256dh ?? '',
          auth: json.keys?.auth ?? '',
        });

        if (!result.ok) {
          await subscription.unsubscribe();
          toast.error(t(result.error ?? 'common.somethingWrong'));
          return;
        }

        setState('on');
        toast.success(t('push.on'));
      } catch {
        toast.error(t('common.somethingWrong'));
      }
    });
  }

  function disable() {
    startTransition(async () => {
      try {
        const registration = await navigator.serviceWorker.ready;
        const subscription = await registration.pushManager.getSubscription();
        if (subscription) {
          await removePushSubscription(subscription.endpoint);
          await subscription.unsubscribe();
        }
        setState('off');
        toast.success(t('push.off'));
      } catch {
        toast.error(t('common.somethingWrong'));
      }
    });
  }

  return (
    <SettingsSection id="push" title={t('push.title')} description={t('push.subtitle')}>
      {!publicKey ? (
        <p className="text-sm text-muted-foreground">{t('push.notConfigured')}</p>
      ) : state === 'needs-install' ? (
        <p className="text-sm text-muted-foreground">{t('push.needsInstall')}</p>
      ) : state === 'unsupported' ? (
        <p className="text-sm text-muted-foreground">{t('push.unsupported')}</p>
      ) : state === 'denied' ? (
        <p className="text-sm text-muted-foreground">{t('push.denied')}</p>
      ) : (
        <>
          <p className="flex items-center gap-2 text-sm">
            <span
              className={`size-2 shrink-0 rounded-full ${state === 'on' ? 'bg-success' : 'bg-muted-foreground/50'}`}
              aria-hidden
            />
            {state === 'on' ? t('push.active') : t('push.inactive')}
          </p>

          <Button
            type="button"
            variant={state === 'on' ? 'outline' : 'default'}
            onClick={state === 'on' ? disable : enable}
            disabled={pending || state === 'checking'}
          >
            <BellRing className="size-4" aria-hidden />
            {state === 'on' ? t('push.turnOff') : t('push.turnOn')}
          </Button>

          <p className="text-xs text-muted-foreground">{t('push.what')}</p>
        </>
      )}
    </SettingsSection>
  );
}

/**
 * The VAPID public key travels as base64url text and has to reach the browser
 * as bytes. This is the conversion every push implementation carries, because
 * `subscribe` takes no other shape.
 */
function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), '=');
  const normalised = padded.replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(normalised);

  // Built on an explicit ArrayBuffer: `subscribe` wants bytes backed by one,
  // and a plain `new Uint8Array(length)` is typed loosely enough that it does
  // not satisfy it.
  const output = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i += 1) output[i] = raw.charCodeAt(i);
  return output;
}
