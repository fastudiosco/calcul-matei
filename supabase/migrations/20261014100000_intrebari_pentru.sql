-- Întrebări adresate cuiva: Robert clasifică ce știe și lasă o întrebare pentru Alex (sau invers),
-- fără să piardă clasificarea propusă. Când toate întrebările liniei sunt rezolvate, linia revine singură
-- la „propus” (dacă are împărțire) sau la „neclasificat”, ca să poată fi confirmată.

alter table public.intrebari add column if not exists pentru text;
comment on column public.intrebari.pentru is 'Emailul membrului care trebuie să răspundă (null = oricine).';

-- Starea liniei urmează întrebările ei.
create or replace function public.stare_linie_dupa_intrebari() returns trigger
language plpgsql security invoker set search_path = public as $fn$
declare v_id bigint := coalesce(new.tranzactie_id, old.tranzactie_id);
begin
  if v_id is null then return null; end if;
  if exists (select 1 from public.intrebari i where i.tranzactie_id = v_id and i.stare <> 'rezolvata') then
    update public.clasificari set stare = 'intrebare'
     where tranzactie_id = v_id and stare in ('neclasificat', 'propus');
  else
    update public.clasificari set stare = case when impartire is not null then 'propus' else 'neclasificat' end
     where tranzactie_id = v_id and stare = 'intrebare';
  end if;
  return null;
end $fn$;

drop trigger if exists stare_linie_dupa_intrebari on public.intrebari;
create trigger stare_linie_dupa_intrebari
  after insert or update of stare, tranzactie_id on public.intrebari
  for each row execute function public.stare_linie_dupa_intrebari();

-- Aceeași întrebare pe mai multe linii deodată (din selecția de pe pagina Tranzacții). Tot-sau-nimic.
create or replace function public.intreaba_linii(p_ids bigint[], p_titlu text, p_pentru text default null) returns int
language plpgsql security invoker set search_path = public as $fn$
declare n int;
begin
  if not public.este_membru() then raise exception 'Acces interzis.'; end if;
  if coalesce(trim(p_titlu), '') = '' then raise exception 'Scrie întrebarea.'; end if;
  if p_pentru is not null and not exists (select 1 from public.membri where lower(email) = lower(p_pentru)) then
    raise exception 'Destinatarul nu este membru.';
  end if;
  insert into public.intrebari (tranzactie_id, titlu, pentru)
  select t.id, trim(p_titlu), lower(p_pentru) from public.tranzactii t where t.id = any(p_ids);
  get diagnostics n = row_count;
  return n;
end $fn$;
revoke execute on function public.intreaba_linii(bigint[], text, text) from anon, public;
grant execute on function public.intreaba_linii(bigint[], text, text) to authenticated;
