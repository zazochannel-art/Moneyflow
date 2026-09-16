'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';

/** How long to gather events before re-rendering, so a burst costs one refresh. */
const SETTLE_MS = 250;

/** How often to ask outright, when the socket could not be opened. */
const POLL_MS = 2000;

/**
 * Keeps an open app in step with the database.
 *
 * A purchase forwarded from the phone is written by a route the browser never
 * called. Nothing on screen had any reason to change, so the only way to see it
 * was to close the app and open it again — an odd thing to ask of an app whose
 * job is to tell you where the money went.
 *
 * Three things are covered, because they fail differently:
 *
 *  - **Something changed while you were looking.** Postgres says so over the
 *    realtime socket and the route re-renders. Under a second, normally.
 *  - **Something changed while the app was in the background.** A phone
 *    suspends the page and kills the socket, so there is nothing to hear. The
 *    refresh happens on the way back in instead.
 *  - **The socket never opened.** Blocked, or realtime turned off on the
 *    project. Then it asks on a timer rather than quietly showing yesterday —
 *    the visible behaviour has to be the same either way.
 */
export function LiveRefresh({ userId }: { userId: string }) {
  const router = useRouter();

  useEffect(() => {
    const supabase = createClient();
    let settle: ReturnType<typeof setTimeout> | null = null;
    let poll: ReturnType<typeof setInterval> | null = null;
    let stopped = false;

    const refresh = () => {
      if (stopped || settle) return;
      settle = setTimeout(() => {
        settle = null;
        // Refreshing a page nobody is looking at spends a request to change
        // pixels that are not on screen; coming back triggers one anyway.
        if (document.visibilityState === 'visible') router.refresh();
      }, SETTLE_MS);
    };

    const startPolling = () => {
      if (poll || stopped) return;
      poll = setInterval(refresh, POLL_MS);
    };

    const stopPolling = () => {
      if (!poll) return;
      clearInterval(poll);
      poll = null;
    };

    const channel = supabase.channel(`mf:${userId}`);

    for (const table of ['transactions', 'notifications']) {
      channel.on(
        'postgres_changes',
        { event: '*', schema: 'public', table, filter: `user_id=eq.${userId}` },
        refresh,
      );
    }

    // The socket carries its own authorisation, separate from the cookie the
    // page was rendered with, and row level security decides from it what the
    // stream may contain. The client does set it — but on the session event,
    // which lands after construction, so subscribing straight away would join
    // holding the anonymous key and then hear nothing at all, silently. Taking
    // the token first closes that gap; later refreshes still arrive on their
    // own, because the client re-sets it on every token change.
    void (async () => {
      const { data } = await supabase.auth.getSession();
      if (stopped) return;

      const token = data.session?.access_token;
      if (token) await supabase.realtime.setAuth(token);
      if (stopped) return;

      channel.subscribe((status) => {
        if (status === 'SUBSCRIBED') stopPolling();
        else startPolling();
      });
    })();

    const onVisible = () => {
      if (document.visibilityState === 'visible') refresh();
    };

    document.addEventListener('visibilitychange', onVisible);
    // A phone often restores the page from cache rather than loading it, and
    // `visibilitychange` does not fire for that.
    window.addEventListener('pageshow', onVisible);

    return () => {
      stopped = true;
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('pageshow', onVisible);
      stopPolling();
      if (settle) clearTimeout(settle);
      void supabase.removeChannel(channel);
    };
  }, [router, userId]);

  return null;
}
