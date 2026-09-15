-- MONEYFLOW · SMS: semnal la configurare și niciun mesaj pierdut
--
-- Două lucruri se văd abia când cineva configurează telefonul pentru prima
-- dată, și amândouă arată la fel din afară: „nu se întâmplă nimic".
--
-- 1. `last_used_at` se scria doar când se năștea o tranzacție. Un mesaj de
--    test — orice text care nu e SMS-ul băncii — ajungea corect în clopoțel,
--    dar ecranul de Setări rămânea la „Niciun mesaj primit încă.". Adică exact
--    ce scrie și când tokenul e greșit. Acum ora se scrie imediat ce tokenul e
--    recunoscut, fiindcă asta și spune: telefonul a ajuns până aici.
-- 2. Un mesaj care nu avea în ce cont să intre dispărea în tăcere. Acum ajunge
--    în clopoțel, ca oricare altul pe care aplicația nu-l poate duce la capăt.

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
  uid            uuid;
  token_digest   text;
  target_account uuid;
  target_category uuid;
  new_id         uuid;
begin
  if p_token is null or char_length(p_token) < 20 then
    return null;
  end if;

  token_digest := encode(digest(p_token, 'sha256'), 'hex');

  select user_id into uid
    from public.sms_tokens
   where token_hash = token_digest
     and revoked_at is null
   limit 1;

  if uid is null then
    return null;
  end if;

  -- Ora asta e singurul semn, la configurare, că telefonul a ajuns până aici cu
  -- un token bun — de aceea se scrie acum, nu la sfârșit. Scrisă doar când iese
  -- o tranzacție, ar fi tăcut fix la mesajul de test.
  update public.sms_tokens
     set last_used_at = now()
   where token_hash = token_digest;

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

  -- Fără niciun cont activ nu există unde scrie suma. Mesajul tot se vede, în
  -- clopoțel: cheltuiala s-a făcut, indiferent că aplicația n-are unde s-o
  -- pună. Cheia de dedupe e prefixată ca să nu se calce cu cea de mai sus —
  -- același mesaj poate trece pe aici înainte de a exista un cont.
  if target_account is null then
    insert into public.notifications (user_id, kind, severity, title, body, dedupe_key)
    values (uid, 'sms_no_account', 'warning', 'Cheltuială fără cont în care să intre',
            left(coalesce(p_raw, ''), 300),
            'sms-no-account:' || coalesce(p_source_ref, md5(coalesce(p_raw, ''))))
    on conflict do nothing;
    return null;
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

  return new_id;
end;
$$;

-- `create or replace` păstrează drepturile existente; se rescriu oricum, ca
-- fișierul ăsta să spună singur cine poate chema funcția.
revoke all on function public.ingest_sms(
  text, numeric, public.transaction_type, text, date, text, text, text) from public;
grant execute on function public.ingest_sms(
  text, numeric, public.transaction_type, text, date, text, text, text) to anon, authenticated;
