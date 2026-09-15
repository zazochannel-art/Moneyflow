'use client';

import { Suspense, useState, type ReactNode } from 'react';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';
import { I18nProvider } from '@/lib/i18n/context';
import type { Account, AppNotification, Category, CurrencyCode, LanguageCode } from '@/lib/types/database';
import { QuickAddProvider } from './quick-add-context';
import { QuickAddDialog } from './quick-add-dialog';
import { QuickAddLauncher } from './quick-add-launcher';
import { Sidebar } from './sidebar';
import { BottomNav } from './bottom-nav';
import { MoreSheet } from './more-sheet';
import { Topbar } from './topbar';
import { KeyboardShortcuts } from './keyboard-shortcuts';
import { InstallPrompt } from './install-prompt';
import { OfflineBanner } from './offline-banner';

/**
 * The frame every signed-in page renders inside: sidebar on desktop, a bar at
 * the bottom on a phone, and one quick-add dialog shared by both.
 */
export function AppShell({
  lang,
  currency,
  name,
  email,
  accounts,
  categories,
  notifications,
  children,
}: {
  lang: LanguageCode;
  currency: CurrencyCode;
  name: string | null;
  email: string;
  accounts: Account[];
  categories: Category[];
  notifications: AppNotification[];
  children: ReactNode;
}) {
  const [moreOpen, setMoreOpen] = useState(false);
  const pathname = usePathname();

  // The dashboard is the one page that lays out three columns, so it gets the
  // room for them. Every other page stays at the reading width that suits a
  // single column of forms and lists.
  const wide = pathname === '/dashboard';

  return (
    <I18nProvider lang={lang} currency={currency}>
      <QuickAddProvider accounts={accounts} categories={categories}>
        <div className="flex min-h-dvh">
          <Sidebar />

          <div className="flex min-w-0 flex-1 flex-col">
            <OfflineBanner />
            <Topbar name={name} email={email} notifications={notifications} />

            <main
              className={cn(
                'mx-auto w-full flex-1 px-4 pt-5 pb-28 sm:px-6 lg:pb-10',
                wide ? 'max-w-[1440px]' : 'max-w-5xl',
              )}
            >
              {children}
            </main>
          </div>
        </div>

        <BottomNav onOpenMore={() => setMoreOpen(true)} />
        <MoreSheet open={moreOpen} onOpenChange={setMoreOpen} />
        <QuickAddDialog />
        <Suspense fallback={null}>
          <QuickAddLauncher />
        </Suspense>
        <KeyboardShortcuts />
        <InstallPrompt />
      </QuickAddProvider>
    </I18nProvider>
  );
}
