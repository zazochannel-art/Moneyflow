-- MONEYFLOW · notificări care ajung pe telefon
--
-- Clopoțelul din aplicație se umple singur, dar îl vezi doar dacă deschizi
-- aplicația — iar momentul în care contează („mesaj neînțeles de la bancă",
-- „cheltuială fără cont") e exact cel în care n-o ai deschisă.
--
-- Din iOS 16.4, un PWA instalat pe ecranul principal poate primi notificări
-- push. Ce urmează ține abonamentele și dă căii dinspre SMS un mod de a le
-- găsi.

create table if not exists public.push_subscriptions (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  endpoint    text not null,
  p256dh      text not null,
  auth        text not null,
  user_agent  text,
  created_at  timestamptz not null default now(),
  last_sent_at timestamptz,
  -- Un browser dă un endpoint unic per instalare; același de două ori e
  -- aceeași instalare care s-a reabonat, nu una nouă.
  constraint push_subscriptions_endpoint_key unique (endpoint)
);

create index if not exists push_subscriptions_user_idx
  on public.push_subscriptions (user_id);

alter table public.push_subscriptions enable row level security;
alter table public.push_subscriptions force row level security;

drop policy if exists push_subscriptions_select_own on public.push_subscriptions;
drop policy if exists push_subscriptions_insert_own on public.push_subscriptions;
drop policy if exists push_subscriptions_update_own on public.push_subscriptions;
drop policy if exists push_subscriptions_delete_own on public.push_subscriptions;

create policy push_subscriptions_select_own on public.push_subscriptions
  for select using (user_id = (select auth.uid()));
create policy push_subscriptions_insert_own on public.push_subscriptions
  for insert with check (user_id = (select auth.uid()));
create policy push_subscriptions_update_own on public.push_subscriptions
  for update using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy push_subscriptions_delete_own on public.push_subscriptions
  for delete using (user_id = (select auth.uid()));

grant select, insert, update, delete on public.push_subscriptions to authenticated;

-- --- cum găsește ruta de SMS unde să trimită -------------------------------
--
-- Ruta care primește SMS-ul n-are sesiune: tokenul e toată autoritatea ei. Ca
-- să trimită o notificare trebuie să afle unde, iar asta înseamnă să citească
-- abonamentele proprietarului acelui token.
--
-- E o lărgire a ce poate face tokenul, și merită spus pe față: cine îl fură
-- poate afla adresele de push ale telefonului. Alegerea e conștientă, fiindcă
-- același token poate deja scrie tranzacții în contul omului — iar alternativa,
-- să nu ajungă nicio notificare exact la mesajul pe care aplicația nu l-a
-- înțeles, golește de sens toată funcția.
--
-- Cheile de criptare ies de aici pentru că fără ele nu se poate trimite;
-- protocolul cere ca mesajul să fie criptat pentru browserul destinatar.

create or replace function public.sms_push_targets(p_token text)
returns table (endpoint text, p256dh text, auth text)
language plpgsql
security definer
set search_path = pg_catalog, public, extensions
as $$
declare
  uid uuid;
begin
  if p_token is null or char_length(p_token) < 20 then
    return;
  end if;

  select s.user_id into uid
    from public.sms_tokens s
   where s.token_hash = encode(digest(p_token, 'sha256'), 'hex')
     and s.revoked_at is null
   limit 1;

  if uid is null then
    return;
  end if;

  return query
    select p.endpoint, p.p256dh, p.auth
      from public.push_subscriptions p
     where p.user_id = uid;
end;
$$;

revoke all on function public.sms_push_targets(text) from public;
grant execute on function public.sms_push_targets(text) to anon, authenticated;
