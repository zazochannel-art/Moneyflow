-- ===========================================================================
-- MONEYFLOW — the user's timezone
--
-- "How much can I spend today?" needs a definition of today, and the server's
-- is the wrong one. Rendering happens in UTC while the person lives in a
-- timezone that is usually hours ahead, so between local midnight and the UTC
-- rollover the dashboard answers for yesterday — and an expense the browser
-- dated today does not count toward today's spending. That is the product's
-- one number being wrong, nightly.
--
-- The timezone belongs on the profile for the same reason currency and
-- language do: it is a property of the person, not of the request.
-- ===========================================================================

alter table public.profiles
  add column if not exists timezone text not null default 'UTC';

-- IANA names are an open, growing set, so this checks shape rather than
-- membership: a rejected valid zone would be worse than an accepted odd one,
-- and `zonedNow` falls back to server time for anything Intl cannot resolve.
do $$ begin
  alter table public.profiles
    add constraint profiles_timezone_check
    check (timezone ~ '^[A-Za-z0-9+_/-]{1,64}$');
exception when duplicate_object then null; end $$;

comment on column public.profiles.timezone is
  'IANA timezone. Defines the user''s "today" for the daily budget.';
