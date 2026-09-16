import 'server-only';

import { createClient as createSupabaseClient, type SupabaseClient } from '@supabase/supabase-js';
import { supabaseUrl } from './env';

/**
 * A client that answers to no session and no Row Level Security.
 *
 * Used in exactly one place — the scheduled job that posts recurring charges —
 * because that job works on behalf of every user at once and there is nobody
 * signed in to authorise it. Everything else in this app goes through the anon
 * key and RLS, including the public SMS endpoint, which gets by on a token
 * checked inside the database instead.
 *
 * The key is read lazily and its absence is an error at the request, not at
 * build time: a deployment that has not set it should fail the cron call with a
 * sentence naming the variable, not fail to build.
 */
export function createAdminClient(): SupabaseClient {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error('SUPABASE_SERVICE_ROLE_KEY is not set.');

  return createSupabaseClient(supabaseUrl(), key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
