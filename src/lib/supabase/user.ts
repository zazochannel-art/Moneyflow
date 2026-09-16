import 'server-only';

import { cache } from 'react';
import type { User } from '@supabase/supabase-js';
import { createClient } from './server';

/**
 * The signed-in user, fetched at most once per request.
 *
 * `auth.getUser()` is a network call: it asks the auth server to verify the
 * token rather than trusting what the cookie claims. That is the right
 * behaviour and also the expensive one — and this app asked for it several
 * times over on a single page. The layout asks to decide whether to redirect,
 * the page asks to scope its query, the financial snapshot asks again, and
 * every server action asks once more. With the database in Ireland and the
 * functions elsewhere, each of those was a fresh round trip across an ocean.
 *
 * `cache` is per-request, so the first caller pays and the rest read what it
 * got. Nothing is shared between requests or between users.
 */
export const getCurrentUser = cache(async (): Promise<User | null> => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
});
