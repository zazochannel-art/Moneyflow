-- A table created in `public` without Row Level Security is readable by anyone
-- holding the anon key. Nothing in review catches that reliably — it is an
-- omission, not a mistake, and omissions look like nothing at all.
--
-- The database can catch it instead: an event trigger that fires after every
-- DDL statement and enables RLS on any table that just appeared. It is already
-- running on the live project, where it was created outside this repository —
-- which means a deployment built from these migrations alone would not have it.
-- That is the gap this file closes. The definition is the one in production,
-- copied rather than rewritten, so applying this changes nothing there.
--
-- Enabling RLS is not the same as writing policies: a table with RLS on and no
-- policy denies everyone, which is the safe way to be wrong.

create or replace function public.rls_auto_enable()
returns event_trigger
language plpgsql
security definer
set search_path to 'pg_catalog'
as $$
declare
  cmd record;
begin
  for cmd in
    select *
    from pg_event_trigger_ddl_commands()
    where command_tag in ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
      and object_type in ('table', 'partitioned table')
  loop
    if cmd.schema_name is not null
       and cmd.schema_name in ('public')
       and cmd.schema_name not in ('pg_catalog', 'information_schema')
       and cmd.schema_name not like 'pg_toast%'
       and cmd.schema_name not like 'pg_temp%' then
      begin
        execute format('alter table if exists %s enable row level security', cmd.object_identity);
        raise log 'rls_auto_enable: enabled RLS on %', cmd.object_identity;
      exception
        when others then
          raise log 'rls_auto_enable: failed to enable RLS on %', cmd.object_identity;
      end;
    else
      raise log 'rls_auto_enable: skip % (either system schema or not in enforced list: %.)',
        cmd.object_identity, cmd.schema_name;
    end if;
  end loop;
end;
$$;

-- Event triggers have no `if not exists`, and creating one needs privileges a
-- managed database may withhold. Already there: nothing to do. Not allowed: say
-- so loudly and carry on, because failing the whole migration over a safety net
-- would leave the deployment with neither the net nor the schema.
do $$
begin
  if exists (select 1 from pg_event_trigger where evtname = 'ensure_rls') then
    raise notice 'ensure_rls is already installed';
    return;
  end if;

  create event trigger ensure_rls
    on ddl_command_end
    execute function public.rls_auto_enable();

  raise notice 'ensure_rls installed';
exception
  when insufficient_privilege then
    raise warning 'could not install the ensure_rls event trigger: %. New tables will NOT get RLS automatically; enable it by hand in every migration that creates one.', sqlerrm;
end $$;
