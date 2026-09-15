-- ===========================================================================
-- MONEYFLOW — tranzacții din SMS-ul băncii
--
-- Telefonul primește SMS-ul de la bancă; o aplicație de automatizări îl trimite
-- mai departe. Cererea vine de la un robot, nu dintr-un browser, deci nu are
-- sesiune — iar autentificarea e un token.
--
-- Funcția de scriere e `security definer` și `anon` o poate apela, exact forma
-- pe care am scos-o de pe suprafața API acum câteva ore. Diferența e reală, nu
-- de nuanță: aceea avea încredere în argumentele primite, asta *verifică o
-- credențială* înainte să scrie ceva. Fără token valid nu scrie nimic și nu
-- spune de ce — un endpoint care răspunde diferit la „token greșit" și „cont
-- inexistent" devine un instrument de ghicit.
--
-- Stă în `public` fiindcă acolo trebuie să fie ca PostgREST s-o poată publica;
-- e singurul mod în care ruta aplicației, care n-are sesiune, ajunge la ea.
-- `01_schema_checks.sql` o trece explicit pe o listă de excepții, cu motivul —
-- o interdicție generală pe care o lărgești în tăcere e cum intră gaura
-- următoare.
--
-- Numele nu începe cu `mf_` intenționat: migrarea de întărire revocă `anon` de
-- pe tot ce are prefixul acela, în buclă, iar o re-rulare a ei ar tăia liniștit
-- ingestia. Prefixul separă acum RPC-urile aplicației, care cer sesiune, de
-- acest singur endpoint care cere token.
-- ===========================================================================

-- --- tokenuri ---------------------------------------------------------------
-- Păstrate ca hash: o copie a bazei nu trebuie să dea cuiva dreptul de a scrie
-- tranzacții în contul tău.

create table if not exists public.sms_tokens (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  token_hash   text not null unique,
  label        text,
  created_at   timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at   timestamptz,
  constraint sms_tokens_label_check check (label is null or char_length(label) <= 60)
);

create index if not exists sms_tokens_user_idx on public.sms_tokens (user_id, revoked_at);

-- --- de unde vine o tranzacție ----------------------------------------------
-- Una scrisă de un robot arată altfel decât una scrisă de om: vrei să știi care
-- e care, și vrei să poți găsi tot ce a adus un token compromis.

alter table public.transactions
  add column if not exists source text not null default 'manual';

do $$ begin
  alter table public.transactions
    add constraint transactions_source_check
    check (source in ('manual', 'recurring', 'sms', 'import'));
exception when duplicate_object then null; end $$;

-- Textul brut din care a ieșit, ca să se poată verifica de unde vine un număr.
alter table public.transactions
  add column if not exists source_ref text;

-- Același SMS trimis de două ori (rețea proastă, reîncercare) e aceeași
-- tranzacție, nu două.
create unique index if not exists transactions_source_ref_key
  on public.transactions (user_id, source_ref)
  where source_ref is not null;

-- --- care card e care cont --------------------------------------------------
-- SMS-ul numește cardul prin ultimele cifre. Fără asta, o plată de pe cardul de
-- credit ar ateriza pe contul de debit și ambele solduri ar minți.

alter table public.accounts
  add column if not exists card_last4 text;

do $$ begin
  alter table public.accounts
    add constraint accounts_card_last4_check
    check (card_last4 is null or card_last4 ~ '^[0-9]{4}$');
exception when duplicate_object then null; end $$;

-- --- RLS pe tokenuri --------------------------------------------------------

alter table public.sms_tokens enable row level security;
alter table public.sms_tokens force row level security;

do $$
declare
  p text;
begin
  foreach p in array array['select', 'insert', 'update', 'delete']
  loop
    execute format('drop policy if exists %I on public.sms_tokens', 'sms_tokens_' || p || '_own');
  end loop;
end $$;

create policy sms_tokens_select_own on public.sms_tokens
  for select using (user_id = (select auth.uid()));
create policy sms_tokens_insert_own on public.sms_tokens
  for insert with check (user_id = (select auth.uid()));
create policy sms_tokens_update_own on public.sms_tokens
  for update using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy sms_tokens_delete_own on public.sms_tokens
  for delete using (user_id = (select auth.uid()));

grant select, insert, update, delete on public.sms_tokens to authenticated;

-- --- scrierea ---------------------------------------------------------------
-- `extensions` e în search_path fiindcă acolo ține Supabase pgcrypto; local
-- stă în `public`. O schemă inexistentă în search_path e ignorată, deci
-- aceeași linie merge în amândouă.

create or replace function public.ingest_sms(
  p_token       text,
  p_amount      numeric,
  p_type        public.transaction_type,
  p_description text,
  p_date        date,
  p_card_last4  text,
  p_source_ref  text,
  p_raw         text default null
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public, extensions
as $$
declare
  uid uuid;
  target_account uuid;
  target_category uuid;
  new_id uuid;
begin
  if p_token is null or char_length(p_token) < 20 then
    return null;
  end if;

  select user_id into uid
    from public.sms_tokens
   where token_hash = encode(digest(p_token, 'sha256'), 'hex')
     and revoked_at is null
   limit 1;

  if uid is null then
    return null;
  end if;

  -- Un mesaj pe care parserul nu l-a înțeles nu se pierde: ajunge în clopoțel,
  -- cu textul lui, ca să se vadă că a venit ceva și să poată fi adăugat un
  -- tipar pentru el. Alternativa — să dispară în tăcere — e cum afli peste o
  -- lună că jumătate din cheltuieli lipsesc.
  if p_amount is null or p_amount <= 0 then
    if nullif(trim(coalesce(p_raw, '')), '') is not null then
      insert into public.notifications (user_id, kind, severity, title, body, dedupe_key)
      values (uid, 'sms_unparsed', 'warning', 'Mesaj neînțeles de la bancă',
              left(p_raw, 300), coalesce(p_source_ref, 'sms:' || md5(p_raw)))
      on conflict do nothing;
    end if;
    return null;
  end if;

  -- Cardul spune contul. Dacă nu se potrivește niciunul, primul cont activ —
  -- mai bine pe contul greșit și vizibil decât pierdut de tot.
  if p_card_last4 is not null then
    select id into target_account
      from public.accounts
     where user_id = uid and not is_archived and card_last4 = p_card_last4
     limit 1;
  end if;

  if target_account is null then
    select id into target_account
      from public.accounts
     where user_id = uid and not is_archived
     order by created_at
     limit 1;
  end if;

  if target_account is null then
    return null;  -- nimic în care să scrie
  end if;

  -- Dacă ai mai pus o dată FIDESCO pe Sănătate, a doua oară nu te mai întreabă.
  -- Cea mai recentă tranzacție cu aceeași descriere spune unde vrei să meargă —
  -- e o preferință pe care ai exprimat-o deja, nu o ghicire.
  if nullif(trim(coalesce(p_description, '')), '') is not null then
    select t.category_id into target_category
      from public.transactions t
     where t.user_id = uid
       and t.category_id is not null
       and lower(t.description) = lower(trim(p_description))
     order by t.date desc, t.created_at desc
     limit 1;
  end if;

  -- Altfel, cea neutră: mai bine necategorisit decât categorisit greșit.
  if target_category is null then
    select id into target_category
      from public.categories
     where user_id = uid and name = 'Other'
     limit 1;
  end if;

  insert into public.transactions
    (user_id, account_id, category_id, type, amount, description, date, source, source_ref)
  values
    (uid, target_account, target_category, p_type, p_amount,
     nullif(trim(coalesce(p_description, '')), ''), coalesce(p_date, current_date),
     'sms', p_source_ref)
  on conflict do nothing
  returning id into new_id;

  update public.sms_tokens
     set last_used_at = now()
   where user_id = uid and revoked_at is null;

  return new_id;
end;
$$;

revoke all on function public.ingest_sms(
  text, numeric, public.transaction_type, text, date, text, text, text) from public;
grant execute on function public.ingest_sms(
  text, numeric, public.transaction_type, text, date, text, text, text) to anon, authenticated;
