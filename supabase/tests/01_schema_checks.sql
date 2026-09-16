-- ===========================================================================
-- What the schema is supposed to do, asserted against a real PostgreSQL.
--
-- The parts of MONEYFLOW that cannot be unit-tested in TypeScript live here:
-- the bootstrap trigger, the account-balance bookkeeping, the transfer guard,
-- goal progress, Row Level Security in both directions, recurring
-- materialisation, the demo seed, and that deleting an account really does
-- leave nothing behind.
--
-- Run: scripts/verify-schema.sh
-- ===========================================================================

\set ON_ERROR_STOP on
\pset pager off

-- Two users, so isolation can actually be observed.
insert into auth.users (id, email, raw_user_meta_data)
values ('11111111-1111-1111-1111-111111111111', 'ana@example.md', '{"name":"Ana Pop"}'),
       ('22222222-2222-2222-2222-222222222222', 'bob@example.md', '{"name":"Bob"}');

\echo '--- bootstrap trigger ---'
select (select count(*) from public.profiles)   as profiles,
       (select count(*) from public.categories) as categories,
       (select count(*) from public.accounts)   as accounts;
select name from public.profiles order by name;

\echo '--- timezone defaults and is shape-checked ---'
select timezone as default_timezone from public.profiles limit 1;
do $$
begin
  update public.profiles set timezone = 'Europe/Chisinau'
   where user_id = '11111111-1111-1111-1111-111111111111';
  raise notice 'a real IANA zone is accepted';
end $$;
do $$
begin
  update public.profiles set timezone = 'not a zone; drop table'
   where user_id = '11111111-1111-1111-1111-111111111111';
  raise exception 'a malformed timezone was allowed';
exception when check_violation then
  raise notice 'malformed timezone rejected, as expected';
end $$;

\echo '--- balance triggers ---'
set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
set role authenticated;

insert into public.accounts (user_id, name, type, balance)
values (auth.uid(), 'Victoriabank', 'bank', 6000) returning name, balance;

insert into public.transactions (user_id, account_id, type, amount, date)
select auth.uid(), id, 'income', 15000, current_date from public.accounts where name = 'Victoriabank';

insert into public.transactions (user_id, account_id, type, amount, date)
select auth.uid(), id, 'expense', 4000, current_date from public.accounts where name = 'Victoriabank';

insert into public.transactions (user_id, account_id, to_account_id, type, amount, date)
select auth.uid(),
       (select id from public.accounts where name = 'Victoriabank'),
       (select id from public.accounts where name = 'Cash'),
       'transfer', 2000, current_date;

select name, balance from public.accounts order by name;

\echo '--- editing a transaction re-derives the balance ---'
update public.transactions set amount = 5000
 where type = 'expense' and amount = 4000;
select name, balance from public.accounts where name = 'Victoriabank';

\echo '--- deleting a transaction gives the money back ---'
delete from public.transactions where type = 'expense';
select name, balance from public.accounts where name = 'Victoriabank';

\echo '--- transfer guard rejects a self-transfer ---'
do $$
begin
  insert into public.transactions (user_id, account_id, to_account_id, type, amount, date)
  select auth.uid(), id, id, 'transfer', 100, current_date from public.accounts limit 1;
  raise exception 'self-transfer was allowed';
exception when check_violation then
  raise notice 'self-transfer rejected, as expected';
end $$;

\echo '--- goal contributions drive goal progress ---'
insert into public.goals (user_id, name, target_amount, monthly_contribution)
values (auth.uid(), 'Golf 5', 20000, 1000);
insert into public.goal_contributions (user_id, goal_id, amount, date)
select auth.uid(), id, 12500, current_date from public.goals where name = 'Golf 5';
select name, current_amount, status from public.goals;

insert into public.goal_contributions (user_id, goal_id, amount, date)
select auth.uid(), id, 7500, current_date from public.goals where name = 'Golf 5';
select name, current_amount, status from public.goals;

\echo '--- RLS: Ana sees only her own rows ---'
select count(*) as ana_sees_profiles from public.profiles;
select count(*) as ana_sees_accounts from public.accounts;

\echo '--- RLS: Bob sees none of Ana rows ---'
reset role;
set request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';
set role authenticated;
select count(*) as bob_sees_ana_transactions from public.transactions
 where user_id = '11111111-1111-1111-1111-111111111111';
select count(*) as bob_sees_profiles from public.profiles;

\echo '--- RLS: Bob cannot write rows owned by Ana ---'
do $$
begin
  insert into public.accounts (user_id, name, type)
  values ('11111111-1111-1111-1111-111111111111', 'Hijack', 'cash');
  raise exception 'cross-user insert was allowed';
exception when insufficient_privilege then
  raise notice 'cross-user insert rejected, as expected';
end $$;

\echo '--- a row I own cannot point at rows I do not ---'
-- RLS only ever asks whether `user_id` is mine. It says nothing about the ids
-- the row carries, and for a while nothing else did either: an ordinary
-- authenticated insert naming a stranger's account drove that account to -5000
-- on a real database. The composite foreign keys make the reference and its
-- owner one fact, checked on every write.
--
-- An attacker does not need to read the id to use it, so these carry Ana's ids
-- across the role switch rather than trying to select them as Bob.
reset role;
create temp table stranger_ids as
  select (select id from public.accounts
           where user_id = '11111111-1111-1111-1111-111111111111' order by name limit 1) as account_id,
         (select id from public.goals
           where user_id = '11111111-1111-1111-1111-111111111111' limit 1) as goal_id,
         (select id from public.categories
           where user_id = '11111111-1111-1111-1111-111111111111' order by sort_order limit 1) as category_id;
grant select on stranger_ids to public;

set request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';
set role authenticated;

do $$
begin
  insert into public.transactions (user_id, account_id, type, amount, date)
  select auth.uid(), account_id, 'expense', 5000, current_date from stranger_ids;
  raise exception 'a transaction against a stranger account was allowed';
exception when foreign_key_violation then
  raise notice 'cross-owner account reference rejected, as expected';
end $$;

do $$
begin
  insert into public.goal_contributions (user_id, goal_id, amount, date)
  select auth.uid(), goal_id, 100, current_date from stranger_ids;
  raise exception 'a contribution to a stranger goal was allowed';
exception when foreign_key_violation then
  raise notice 'cross-owner goal reference rejected, as expected';
end $$;

do $$
begin
  insert into public.recurring_transactions
    (user_id, name, amount, type, frequency, next_date, category_id)
  select auth.uid(), 'Leak', 10, 'expense', 'monthly', current_date, category_id
    from stranger_ids;
  raise exception 'a recurring charge under a stranger category was allowed';
exception when foreign_key_violation then
  raise notice 'cross-owner category reference rejected, as expected';
end $$;

\echo '--- the balance helper is not on the API surface ---'
-- It used to be `security definer`, return void rather than `trigger`, and sit
-- in `public` — so PostgREST published it as an RPC and the grants let `anon`
-- call it. The anon key ships in the browser bundle, so that was one request
-- away from moving any balance an attacker could name.
reset role;
select count(*) as helper_left_in_public
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.proname = 'apply_transaction_to_balances';
select count(*) as helper_in_private
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'private' and p.proname = 'apply_transaction_to_balances'
   and not p.prosecdef;
select has_schema_privilege('anon', 'private', 'USAGE') as anon_reaches_private;

do $$
declare
  leaked text;
begin
  -- Trigger-returning functions are left out: PostgreSQL refuses to call them
  -- outside a trigger, so a grant on one is not a way in.
  -- `ingest_sms` is the one on purpose: the SMS forwarder has no session, so a
  -- token is its credential and the function checks it before writing anything.
  -- Named here rather than exempted by a pattern, so adding a second one is a
  -- decision someone has to write down.
  select string_agg(p.proname, ', ') into leaked
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.prosecdef
     and p.prorettype <> 'trigger'::regtype
     and p.proname <> 'ingest_sms'
     and has_function_privilege('anon', p.oid, 'EXECUTE');
  if leaked is not null then
    raise exception 'anon can execute SECURITY DEFINER function(s): %', leaked;
  end if;
  raise notice 'no SECURITY DEFINER function in public is callable by anon';
end $$;

do $$
declare
  unexpected text;
begin
  -- `mf_delete_account` is the one on purpose: it must reach `auth.users`, and
  -- it only ever deletes the caller's own id.
  select string_agg(p.proname, ', ') into unexpected
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.prosecdef
     and p.prorettype <> 'trigger'::regtype
     and p.proname not in ('mf_delete_account', 'ingest_sms')
     and has_function_privilege('authenticated', p.oid, 'EXECUTE');
  if unexpected is not null then
    raise exception 'signed-in users can execute unexpected SECURITY DEFINER function(s): %', unexpected;
  end if;
  raise notice 'mf_delete_account is the only definer function signed-in users can call';
end $$;

drop table stranger_ids;

\echo '--- the reporting RPCs need a signed-in caller ---'
do $$
declare
  open_to_anon text;
begin
  select string_agg(p.proname, ', ') into open_to_anon
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname like 'mf\_%'
     and has_function_privilege('anon', p.oid, 'EXECUTE');
  if open_to_anon is not null then
    raise exception 'anon can execute RPC(s): %', open_to_anon;
  end if;
  raise notice 'no mf_ RPC is callable without signing in';
end $$;

do $$
declare
  missing text;
begin
  select string_agg(p.proname, ', ') into missing
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname like 'mf\_%'
     and not has_function_privilege('authenticated', p.oid, 'EXECUTE');
  if missing is not null then
    raise exception 'signed-in users lost access to RPC(s): %', missing;
  end if;
  raise notice 'every mf_ RPC is still callable by signed-in users';
end $$;


\echo '--- SMS ingest writes only for a valid token ---'
-- The forwarder has no session: the token is the whole of its authority. These
-- assert that it is also the whole of its reach.
reset role;
insert into public.sms_tokens (user_id, token_hash, label)
values ('22222222-2222-2222-2222-222222222222',
        encode(digest('bob-token-0123456789abcdef', 'sha256'), 'hex'), 'phone');

-- Ana's card, so a mis-routed message would be visible immediately.
update public.accounts set card_last4 = '4321'
 where user_id = '11111111-1111-1111-1111-111111111111' and name = 'Cash';

select public.ingest_sms('bob-token-0123456789abcdef', 250.00, 'expense',
                         'LINELLA', current_date, null, 'sms:1') is not null
       as valid_token_wrote;

select public.ingest_sms('not-the-right-token-at-all', 999.00, 'expense',
                         'HACK', current_date, null, 'sms:2') is null
       as wrong_token_wrote_nothing;

select public.ingest_sms(null, 999.00, 'expense', 'HACK', current_date, null, 'sms:3') is null
       as null_token_wrote_nothing;

select public.ingest_sms('bob-token-0123456789abcdef', -5, 'expense',
                         'NEGATIVE', current_date, null, 'sms:4') is null
       as negative_amount_refused;

\echo '--- SMS ingest cannot reach across users ---'
-- Bob's token names Ana's card number. The account lookup is scoped to the
-- token's owner, so the only thing that can happen is Bob's own account.
select public.ingest_sms('bob-token-0123456789abcdef', 77.00, 'expense',
                         'CROSS', current_date, '4321', 'sms:5') is not null
       as wrote_somewhere;
select count(*) as landed_on_ana from public.transactions
 where user_id = '11111111-1111-1111-1111-111111111111' and description = 'CROSS';
select count(*) as landed_on_bob from public.transactions
 where user_id = '22222222-2222-2222-2222-222222222222' and description = 'CROSS';

\echo '--- the same message twice is one transaction ---'
select public.ingest_sms('bob-token-0123456789abcdef', 250.00, 'expense',
                         'LINELLA', current_date, null, 'sms:1') is null
       as duplicate_refused;
select count(*) as linella_rows from public.transactions where description = 'LINELLA';

\echo '--- a revoked token writes nothing ---'
update public.sms_tokens set revoked_at = now()
 where user_id = '22222222-2222-2222-2222-222222222222';
select public.ingest_sms('bob-token-0123456789abcdef', 10.00, 'expense',
                         'AFTER-REVOKE', current_date, null, 'sms:6') is null
       as revoked_token_wrote_nothing;
update public.sms_tokens set revoked_at = null
 where user_id = '22222222-2222-2222-2222-222222222222';

\echo '--- a message the parser could not read is kept, not dropped ---'
select public.ingest_sms('bob-token-0123456789abcdef', null, 'expense',
                         null, current_date, null, 'sms:7',
                         'Ceva ce nu seamana cu nimic cunoscut') is null
       as unparsed_wrote_no_transaction;
select count(*) as unparsed_notifications from public.notifications
 where user_id = '22222222-2222-2222-2222-222222222222' and kind = 'sms_unparsed';

\echo '--- an unparsed message without a token is still nothing ---'
select public.ingest_sms('wrong-token-entirely-here', null, 'expense',
                         null, current_date, null, 'sms:8', 'text oarecare') is null
       as no_token_no_notification;
select count(*) as total_unparsed from public.notifications where kind = 'sms_unparsed';

\echo '--- a token that was used says so, whatever the message was ---'
-- Written only at the very end, the timestamp stayed empty for exactly the
-- message someone sends while setting the phone up: a test string the parser
-- cannot read. The settings screen then said "no messages yet", which is also
-- what it says for a wrong token — the same words for the one case that works
-- and the one that does not. Asserted rather than printed, because this is the
-- only feedback the setup has.
reset role;
do $$
begin
  update public.sms_tokens set last_used_at = null
   where user_id = '22222222-2222-2222-2222-222222222222';

  if public.ingest_sms('bob-token-0123456789abcdef', null, 'expense',
                       null, current_date, null, 'sms:9', 'inca un test') is not null then
    raise exception 'an unreadable message produced a transaction';
  end if;

  if not exists (select 1 from public.sms_tokens
                  where user_id = '22222222-2222-2222-2222-222222222222'
                    and last_used_at is not null) then
    raise exception 'a message that arrived with a good token left no trace of it';
  end if;

  raise notice 'a valid token is marked used even by a message nobody could read';
end $$;

do $$
begin
  update public.sms_tokens set last_used_at = null
   where user_id = '22222222-2222-2222-2222-222222222222';

  if public.ingest_sms('wrong-token-entirely-here', 20.00, 'expense',
                       'NOPE', current_date, null, 'sms:10') is not null then
    raise exception 'a wrong token wrote a transaction';
  end if;

  if exists (select 1 from public.sms_tokens where last_used_at is not null) then
    raise exception 'a wrong token marked someone else token as used';
  end if;

  raise notice 'a wrong token leaves no mark, as expected';
end $$;

\echo '--- a purchase with nowhere to land is still seen ---'
-- The money left the card whether or not this app has an account to put it in,
-- so the message goes to the bell rather than nowhere.
do $$
begin
  update public.accounts set is_archived = true
   where user_id = '22222222-2222-2222-2222-222222222222';

  if public.ingest_sms('bob-token-0123456789abcdef', 33.00, 'expense',
                       'NO-ACCOUNT', current_date, null, 'sms:11') is not null then
    raise exception 'a transaction was written without an account to hold it';
  end if;

  if not exists (select 1 from public.notifications
                  where user_id = '22222222-2222-2222-2222-222222222222'
                    and kind = 'sms_no_account') then
    raise exception 'a purchase with nowhere to land disappeared silently';
  end if;

  update public.accounts set is_archived = false
   where user_id = '22222222-2222-2222-2222-222222222222';

  raise notice 'a purchase with no account to hold it reaches the bell, as expected';
end $$;

\echo '--- a forwarded SMS is dated by the user clock, not the server one ---'
-- `current_date` on Supabase is UTC. Between local midnight and the UTC
-- rollover that is yesterday, so a purchase made just after midnight landed on
-- the wrong day -- in the app whose one number is "how much can I spend today".
-- Two zones on purpose: at any instant at least one of them is on a different
-- date from UTC, so this cannot pass by accident on a run where they agree.
do $$
declare
  stored  date;
  local   date;
  differed boolean := false;
  zone    text;
begin
  foreach zone in array array['Pacific/Kiritimati', 'Pacific/Niue']
  loop
    update public.profiles set timezone = zone
     where user_id = '22222222-2222-2222-2222-222222222222';

    delete from public.transactions
     where user_id = '22222222-2222-2222-2222-222222222222'
       and source_ref = 'sms:zone';

    perform public.ingest_sms('bob-token-0123456789abcdef', 12.00, 'expense',
                              'ZONE', null, null, 'sms:zone');

    select t.date into stored from public.transactions t
     where t.user_id = '22222222-2222-2222-2222-222222222222'
       and t.source_ref = 'sms:zone';

    local := (now() at time zone zone)::date;

    if stored is null then
      raise exception 'no transaction was written for zone %', zone;
    end if;

    if stored <> local then
      raise exception 'zone %: stored % but the user day is %', zone, stored, local;
    end if;

    if local <> current_date then
      differed := true;
    end if;
  end loop;

  if not differed then
    raise exception 'neither zone differed from the server date; the check proved nothing';
  end if;

  raise notice 'an SMS is dated by the user own day, as expected';
end $$;

\echo '--- a timezone the server cannot read does not swallow the message ---'
-- The profile constraint checks the shape of the name, not that the zone
-- exists. An impossible one must not take the whole ingest down with it.
do $$
declare
  written uuid;
begin
  update public.profiles set timezone = 'Europe/Nowhere'
   where user_id = '22222222-2222-2222-2222-222222222222';

  delete from public.transactions
   where user_id = '22222222-2222-2222-2222-222222222222'
     and source_ref = 'sms:badzone';

  written := public.ingest_sms('bob-token-0123456789abcdef', 13.00, 'expense',
                               'BADZONE', null, null, 'sms:badzone');

  if written is null then
    raise exception 'an unreadable timezone lost the message';
  end if;

  raise notice 'an impossible timezone falls back to the server day, as expected';
end $$;

update public.profiles set timezone = 'Europe/Chisinau'
 where user_id = '22222222-2222-2222-2222-222222222222';

\echo '--- a token is only ever visible to its owner ---'
set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
set role authenticated;
select count(*) as ana_sees_bob_tokens from public.sms_tokens
 where user_id = '22222222-2222-2222-2222-222222222222';
reset role;

\echo '--- recurring materialisation is idempotent ---'
reset role;
set request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';
set role authenticated;
insert into public.recurring_transactions (user_id, name, amount, type, frequency, next_date, account_id)
select auth.uid(), 'Netflix', 150, 'expense', 'monthly', current_date - 40,
       (select id from public.accounts where user_id = auth.uid() limit 1);
select public.mf_run_due_recurring() as posted_first_run;
select public.mf_run_due_recurring() as posted_second_run;
select count(*) as netflix_rows from public.transactions where description = 'Netflix';
select next_date > current_date as next_date_moved_forward from public.recurring_transactions;

\echo '--- demo seed ---'
reset role;
set request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';
set role authenticated;
select public.mf_seed_demo_data();
select (select count(*) from public.transactions where user_id = auth.uid()) as demo_transactions,
       (select count(*) from public.goals where user_id = auth.uid())        as demo_goals,
       (select count(*) from public.budget_categories where user_id = auth.uid()) as demo_budget_lines,
       (select count(*) from public.debts where user_id = auth.uid())        as demo_debts,
       (select is_demo from public.profiles where user_id = auth.uid())      as flagged_demo;

\echo '--- reporting RPCs ---'
select count(*) as monthly_rows from public.mf_monthly_totals(current_date - 120, current_date);
select name, total from public.mf_category_totals(date_trunc('month', current_date)::date, current_date, 'expense') limit 3;
select count(*) as balance_points from public.mf_balance_series(current_date - 6, current_date);

\echo '--- demo clear leaves nothing behind ---'
select public.mf_clear_demo_data();
select (select count(*) from public.transactions where user_id = auth.uid()) as after_clear_transactions,
       (select count(*) from public.accounts where user_id = auth.uid())     as after_clear_accounts,
       (select is_demo from public.profiles where user_id = auth.uid())      as after_clear_flag;

\echo '--- account deletion cascades ---'
reset role;
select count(*) as ana_rows_before from public.transactions where user_id = '11111111-1111-1111-1111-111111111111';
delete from auth.users where id = '11111111-1111-1111-1111-111111111111';
select (select count(*) from public.transactions where user_id = '11111111-1111-1111-1111-111111111111') as tx_after,
       (select count(*) from public.profiles where user_id = '11111111-1111-1111-1111-111111111111')     as profile_after,
       (select count(*) from public.accounts where user_id = '11111111-1111-1111-1111-111111111111')     as accounts_after;
