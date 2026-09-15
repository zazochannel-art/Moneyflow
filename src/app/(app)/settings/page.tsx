import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { SettingsView } from '@/components/settings/settings-view';
import { SmsForwarding } from '@/components/settings/sms-forwarding';
import { createClient } from '@/lib/supabase/server';
import { siteUrl } from '@/lib/supabase/env';
import type { Category, Profile } from '@/lib/types/database';

export const metadata: Metadata = { title: 'Setări' };
export const dynamic = 'force-dynamic';

export default async function SettingsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const [profileRes, categoriesRes, tokenRes] = await Promise.all([
    supabase.from('profiles').select('*').eq('user_id', user.id).maybeSingle(),
    supabase.from('categories').select('*').order('sort_order').order('name'),
    // Only whether one is live and when it last ran — the token itself is a
    // hash in the database and cannot be read back by anyone, this page
    // included.
    supabase
      .from('sms_tokens')
      .select('last_used_at')
      .is('revoked_at', null)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  const profile = profileRes.data as Profile | null;
  if (!profile) redirect('/setup-required');

  const smsToken = tokenRes.data as { last_used_at: string | null } | null;

  return (
    <>
      <SettingsView
        profile={{
          ...profile,
          monthly_income: Number(profile.monthly_income),
          monthly_savings_target: Number(profile.monthly_savings_target),
          emergency_fund_target: Number(profile.emergency_fund_target),
        }}
        categories={(categoriesRes.data ?? []) as Category[]}
        email={user.email ?? ''}
      />

      <div className="mt-4">
        <SmsForwarding
          active={Boolean(smsToken)}
          lastUsedAt={smsToken?.last_used_at ?? null}
          endpoint={`${siteUrl()}/api/ingest/sms`}
        />
      </div>
    </>
  );
}
