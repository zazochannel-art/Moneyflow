-- ===========================================================================
-- MONEYFLOW — owning a row is not the same as owning what it points at
--
-- RLS answers one question: is this row mine? Every policy checks `user_id`,
-- and that is genuinely all it checks. It says nothing about the ids the row
-- carries, so a row that is mine could point at an account that is not — and
-- two holes followed from that.
--
--   1. `transactions` passes RLS on `user_id = auth.uid()` alone. A signed-in
--      user could insert their own transaction naming someone else's
--      `account_id`; the balance trigger then debited the stranger's account.
--      Reproduced on a real database: a second account driven to -5000 by an
--      ordinary authenticated insert.
--
--   2. `apply_transaction_to_balances` was `security definer`, returned void
--      rather than `trigger`, and lived in the exposed `public` schema — so
--      PostgREST published it as an RPC and the grants let `anon` call it.
--      The anon key ships in the browser bundle, so anyone holding it could
--      move any balance they could name. Reproduced: 0 -> 999999 in one call.
--
-- The fix is structural rather than another policy. Composite foreign keys
-- make "belongs to the same user" a property the database checks on every
-- write, in the same place it already checks the reference exists. The helper
-- moves out of the API's reach and stops being `security definer`, so even a
-- caller who reached it would still be standing inside their own RLS.
-- ===========================================================================

-- --- referenced rows must share the owner -----------------------------------
-- A composite key needs a composite target, so each parent gets `(id, user_id)`
-- as a unique key. `id` is already the primary key; this index exists to be
-- pointed at.

-- Added only when missing rather than dropped and recreated: once the foreign
-- keys below exist they depend on this index, so a re-run of this file would
-- otherwise fail trying to drop it.
do $$
declare
  t text;
begin
  foreach t in array array['accounts', 'categories', 'goals', 'budgets',
                           'recurring_transactions']
  loop
    if not exists (
      select 1
        from pg_constraint c
        join pg_class rel on rel.oid = c.conrelid
        join pg_namespace n on n.oid = rel.relnamespace
       where n.nspname = 'public'
         and rel.relname = t
         and c.conname = t || '_id_user_key'
    ) then
      execute format('alter table public.%I add constraint %I unique (id, user_id)',
                     t, t || '_id_user_key');
    end if;
  end loop;
end $$;

-- Nullable references use MATCH SIMPLE: when the id is null there is nothing
-- to point at and the constraint stands down, which is the behaviour we want.
-- `on delete set null (column)` names the column to clear, because the default
-- would try to null `user_id` too and that column is `not null`.

alter table public.transactions
  drop constraint if exists transactions_account_id_fkey,
  drop constraint if exists transactions_to_account_id_fkey,
  drop constraint if exists transactions_category_id_fkey,
  drop constraint if exists transactions_goal_id_fkey,
  drop constraint if exists transactions_recurring_id_fkey,
  drop constraint if exists transactions_account_owner_fkey,
  drop constraint if exists transactions_to_account_owner_fkey,
  drop constraint if exists transactions_category_owner_fkey,
  drop constraint if exists transactions_goal_owner_fkey,
  drop constraint if exists transactions_recurring_owner_fkey;

alter table public.transactions
  add constraint transactions_account_owner_fkey
    foreign key (account_id, user_id) references public.accounts (id, user_id)
    on delete cascade,
  add constraint transactions_to_account_owner_fkey
    foreign key (to_account_id, user_id) references public.accounts (id, user_id)
    on delete cascade,
  add constraint transactions_category_owner_fkey
    foreign key (category_id, user_id) references public.categories (id, user_id)
    on delete set null (category_id),
  add constraint transactions_goal_owner_fkey
    foreign key (goal_id, user_id) references public.goals (id, user_id)
    on delete set null (goal_id),
  add constraint transactions_recurring_owner_fkey
    foreign key (recurring_id, user_id)
    references public.recurring_transactions (id, user_id)
    on delete set null (recurring_id);

alter table public.budget_categories
  drop constraint if exists budget_categories_budget_id_fkey,
  drop constraint if exists budget_categories_category_id_fkey,
  drop constraint if exists budget_categories_budget_owner_fkey,
  drop constraint if exists budget_categories_category_owner_fkey;

alter table public.budget_categories
  add constraint budget_categories_budget_owner_fkey
    foreign key (budget_id, user_id) references public.budgets (id, user_id)
    on delete cascade,
  add constraint budget_categories_category_owner_fkey
    foreign key (category_id, user_id) references public.categories (id, user_id)
    on delete cascade;

alter table public.goal_contributions
  drop constraint if exists goal_contributions_goal_id_fkey,
  drop constraint if exists goal_contributions_account_id_fkey,
  drop constraint if exists goal_contributions_goal_owner_fkey,
  drop constraint if exists goal_contributions_account_owner_fkey;

alter table public.goal_contributions
  add constraint goal_contributions_goal_owner_fkey
    foreign key (goal_id, user_id) references public.goals (id, user_id)
    on delete cascade,
  add constraint goal_contributions_account_owner_fkey
    foreign key (account_id, user_id) references public.accounts (id, user_id)
    on delete set null (account_id);

alter table public.recurring_transactions
  drop constraint if exists recurring_transactions_category_id_fkey,
  drop constraint if exists recurring_transactions_account_id_fkey,
  drop constraint if exists recurring_transactions_category_owner_fkey,
  drop constraint if exists recurring_transactions_account_owner_fkey;

alter table public.recurring_transactions
  add constraint recurring_transactions_category_owner_fkey
    foreign key (category_id, user_id) references public.categories (id, user_id)
    on delete set null (category_id),
  add constraint recurring_transactions_account_owner_fkey
    foreign key (account_id, user_id) references public.accounts (id, user_id)
    on delete set null (account_id);

-- --- internal helpers leave the API surface ---------------------------------
-- PostgREST publishes what it finds in the exposed schemas. `private` is not
-- one of them, so nothing here has a URL, whatever the grants say.
--
-- The trigger functions themselves are a different case: a trigger runs its
-- function regardless of what the caller holds — EXECUTE is checked when the
-- trigger is created, not when it fires — so revoking there costs nothing and
-- is done at the end of this file.

create schema if not exists private;
revoke all on schema private from public, anon;

-- `authenticated` needs USAGE because the balance trigger is `security invoker`
-- and therefore runs as the person inserting the transaction. That grant does
-- not put the function on the API: PostgREST publishes the schemas it is
-- configured to expose, and `private` is not one of them. And the function is
-- `security invoker`, so a caller who reached it another way would still be
-- inside their own RLS — able to move only balances they can already update
-- directly through `accounts`.
grant usage on schema private to authenticated, service_role;

create or replace function private.apply_transaction_to_balances(
  p_type public.transaction_type,
  p_account_id uuid,
  p_to_account_id uuid,
  p_amount numeric,
  p_sign int
)
returns void
language plpgsql
security invoker
set search_path = public
as $$
begin
  if p_type = 'income' then
    update public.accounts set balance = balance + (p_amount * p_sign)
      where id = p_account_id;
  elsif p_type = 'expense' then
    update public.accounts set balance = balance - (p_amount * p_sign)
      where id = p_account_id;
  elsif p_type = 'transfer' then
    update public.accounts set balance = balance - (p_amount * p_sign)
      where id = p_account_id;
    update public.accounts set balance = balance + (p_amount * p_sign)
      where id = p_to_account_id;
  end if;
end;
$$;

revoke all on function private.apply_transaction_to_balances(
  public.transaction_type, uuid, uuid, numeric, int) from public, anon;
grant execute on function private.apply_transaction_to_balances(
  public.transaction_type, uuid, uuid, numeric, int) to authenticated, service_role;

-- `security invoker` is the point: the update now runs inside the caller's own
-- RLS, so the only balance it can reach is one the policies already let them
-- write. The composite keys above make that the same account the transaction
-- names.
create or replace function public.transactions_sync_balance()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    perform private.apply_transaction_to_balances(
      new.type, new.account_id, new.to_account_id, new.amount, 1);
    return new;
  elsif tg_op = 'UPDATE' then
    perform private.apply_transaction_to_balances(
      old.type, old.account_id, old.to_account_id, old.amount, -1);
    perform private.apply_transaction_to_balances(
      new.type, new.account_id, new.to_account_id, new.amount, 1);
    return new;
  else
    perform private.apply_transaction_to_balances(
      old.type, old.account_id, old.to_account_id, old.amount, -1);
    return old;
  end if;
end;
$$;

drop function if exists public.apply_transaction_to_balances(
  public.transaction_type, uuid, uuid, numeric, int);

create or replace function public.goals_sync_progress()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  target_goal uuid := coalesce(new.goal_id, old.goal_id);
  total numeric;
begin
  select coalesce(sum(amount), 0) into total
    from public.goal_contributions where goal_id = target_goal;

  update public.goals
     set current_amount = greatest(total, 0),
         -- An archived goal stays archived; everything else follows the money.
         status = (case
           when status = 'archived' then 'archived'
           when total >= target_amount then 'reached'
           else 'active'
         end)::public.goal_status
   where id = target_goal;

  return coalesce(new, old);
end;
$$;

-- `handle_new_user` stays `security definer`: it runs on the auth trigger,
-- before the new user has a session, so there is no invoker to borrow rights
-- from. It only ever writes rows keyed to the id auth just created.
revoke all on function public.transactions_sync_balance() from public, anon, authenticated;
revoke all on function public.goals_sync_progress() from public, anon, authenticated;
revoke all on function public.handle_new_user() from public, anon, authenticated;

-- --- pinned search paths ----------------------------------------------------
-- Neither is `security definer`, so this is hygiene rather than a hole: it
-- stops a caller's search_path from deciding which `now()` these resolve to.

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create or replace function public.mf_advance_date(
  p_date date,
  p_frequency public.recurrence_frequency
)
returns date
language sql
immutable
set search_path = pg_catalog, public
as $$
  select case p_frequency
    when 'daily'     then p_date + interval '1 day'
    when 'weekly'    then p_date + interval '1 week'
    when 'biweekly'  then p_date + interval '2 weeks'
    when 'monthly'   then p_date + interval '1 month'
    when 'quarterly' then p_date + interval '3 months'
    when 'yearly'    then p_date + interval '1 year'
  end::date;
$$;

revoke all on function public.touch_updated_at() from public, anon, authenticated;

-- --- the reporting RPCs are for signed-in users --------------------------------
-- PostgreSQL grants EXECUTE to PUBLIC by default, and `anon` inherits it, so
-- these ended up callable without signing in by omission rather than by choice.
-- Every one is `security invoker` and filters on `auth.uid()`, so an anonymous
-- call returns nothing and writes nothing — but "harmless because RLS catches
-- it" is a worse reason than "not granted".
do $$
declare
  f record;
begin
  for f in
    select p.oid::regprocedure as sig
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname like 'mf\_%'
  loop
    execute format('revoke all on function %s from public, anon', f.sig);
    execute format('grant execute on function %s to authenticated', f.sig);
  end loop;
end $$;
