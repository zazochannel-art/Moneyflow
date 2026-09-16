-- Recurring charges used to post only while someone was looking at them:
-- `mf_run_due_recurring()` was called from the dashboard and nowhere else. A
-- month away from the app meant a month of rent and subscriptions that had not
-- happened as far as the balance was concerned, and the push notifications
-- added since could never fire for them, because nothing ran when the app was
-- closed.
--
-- The work is the same work; what changes is who can ask for it. The body moves
-- into a function that takes the user explicitly, so a scheduled job can run it
-- for everyone, and it returns what it posted so the caller can say so.

create or replace function public.mf_run_due_recurring_for(p_user uuid)
returns table (
  recurring_id uuid,
  name         text,
  amount       numeric,
  type         public.transaction_type,
  date         date
)
language plpgsql
security definer
set search_path = public
as $$
declare
  r public.recurring_transactions%rowtype;
  guard integer;
  next_due date;
begin
  if p_user is null then
    return;
  end if;

  for r in
    select * from public.recurring_transactions
    where user_id = p_user
      and is_active
      and next_date <= current_date
      and account_id is not null
    order by next_date
  loop
    guard := 0;
    next_due := r.next_date;

    -- A charge dormant for months catches up one period at a time; the guard
    -- stops a malformed row from spinning forever.
    while next_due <= current_date and guard < 60 loop
      exit when r.end_date is not null and next_due > r.end_date;

      begin
        insert into public.transactions
          (user_id, account_id, category_id, recurring_id, type, amount, description, date)
        values
          (r.user_id, r.account_id, r.category_id, r.id, r.type, r.amount, r.name, next_due);

        -- Only a row that was really inserted is reported, so a second run of
        -- the same day announces nothing.
        recurring_id := r.id;
        name         := r.name;
        amount       := r.amount;
        type         := r.type;
        date         := next_due;
        return next;
      exception when unique_violation then
        null; -- already posted for this date
      end;

      next_due := public.mf_advance_date(next_due, r.frequency);
      guard := guard + 1;
    end loop;

    update public.recurring_transactions
       set next_date = next_due,
           last_run_at = now(),
           is_active = case
             when end_date is not null and next_due > end_date then false
             else is_active
           end
     where id = r.id;
  end loop;
end;
$$;

-- Posting on behalf of an arbitrary user is exactly the power this function
-- has, so no signed-in session may call it. The two callers below are the only
-- way in: one is fixed to the caller's own id, the other runs from a scheduled
-- job under the service role.
revoke all on function public.mf_run_due_recurring_for(uuid) from public, anon, authenticated;
grant execute on function public.mf_run_due_recurring_for(uuid) to service_role;

-- Unchanged from the caller's side: still the current user, still a count.
--
-- It has to be `security definer` now, because the function it delegates to is
-- out of a session's reach and would refuse it otherwise. That is the same
-- shape `mf_delete_account` has: no arguments, and the only user it can act on
-- is the one `auth.uid()` names, so there is nothing for a caller to point
-- somewhere else.
create or replace function public.mf_run_due_recurring()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := (select auth.uid());
  posted integer;
begin
  if uid is null then
    return 0;
  end if;

  select count(*) into posted from public.mf_run_due_recurring_for(uid);
  return posted;
end;
$$;

grant execute on function public.mf_run_due_recurring() to authenticated;

-- Every user with something due, in one pass. Returns a row per charge posted
-- so the scheduled job knows who to tell and what about.
create or replace function public.mf_run_due_recurring_all()
returns table (
  user_id      uuid,
  recurring_id uuid,
  name         text,
  amount       numeric,
  type         public.transaction_type,
  date         date
)
language plpgsql
security definer
set search_path = public
as $$
declare
  u uuid;
begin
  for u in
    select distinct rt.user_id
    from public.recurring_transactions rt
    where rt.is_active
      and rt.next_date <= current_date
      and rt.account_id is not null
  loop
    return query
      select u, f.recurring_id, f.name, f.amount, f.type, f.date
      from public.mf_run_due_recurring_for(u) f;
  end loop;
end;
$$;

revoke all on function public.mf_run_due_recurring_all() from public, anon, authenticated;
grant execute on function public.mf_run_due_recurring_all() to service_role;
