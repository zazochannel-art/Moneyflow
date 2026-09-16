-- Nothing reached an open app until it was restarted.
--
-- A purchase forwarded from the phone is written by a route the browser never
-- called, so no page had any reason to re-render: the transaction was in the
-- database and the screen kept showing what it had loaded. Closing the app and
-- opening it again was the only way to see it, which is a strange thing to ask
-- of an app whose whole point is telling you where the money went.
--
-- Realtime is how Postgres says so out loud. The publication exists on every
-- Supabase project but starts empty, so it was streaming nothing at all.
--
-- Two tables, not all of them: a transaction arriving, and a message reaching
-- the bell. Balances change through a trigger on the first, and re-rendering
-- refetches everything anyway, so adding `accounts` would only multiply the
-- events without changing what ends up on screen.
do $$
declare
  t text;
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    -- A plain PostgreSQL (the schema-verification stand-in) has no Supabase to
    -- create it. Make it here so the checks below run the same everywhere.
    create publication supabase_realtime;
  end if;

  foreach t in array array['transactions', 'notifications'] loop
    if not exists (
      select 1 from pg_publication_tables
       where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
      raise notice 'realtime: publishing %', t;
    end if;
  end loop;
end $$;

-- A DELETE carries only the primary key unless the whole row is replicated, and
-- a subscription filtered by `user_id` cannot match a row that does not include
-- it. Without this, deleting a transaction on one device would leave it on
-- screen on another. The cost is the old row in the WAL on every update, which
-- for a personal ledger is nothing worth trading a stale screen for.
alter table public.transactions replica identity full;
alter table public.notifications replica identity full;
