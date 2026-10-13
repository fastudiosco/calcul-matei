-- Răspunsurile lui Alex din 13.10 și verificarea pe date reale.
-- 1. Procent exact pe linie (chiria în trei: 100/3), fără să schimbăm tipul coloanei folosite de vederi.
-- 2. Procentul lui Matei pe client/proiect (se propune automat pe linii).
-- 3. TVA inclus pe linie (din august 2026 se calculează fără TVA).
-- 4. Cursuri BNR pe zi.
-- 5. Reguli: semnul sumei în RON, confirmare fără RON, linii confirmate modificate,
--    luni închise (linii manuale, importuri), confirmări de lună invalidate la orice modificare,
--    importuri suprapuse.

alter table public.clasificari add column procent_precis numeric(9,6) check (procent_precis between 0 and 100);
alter table public.clienti add column procent_matei numeric(7,4) check (procent_matei between 0 and 100);
alter table public.clasificari add column tva_ron numeric(14,2);
alter table public.costuri_recurente add column plati_pe_luna int not null default 1 check (plati_pe_luna >= 1);

create table public.curs_bnr (
  data   date not null,
  moneda char(3) not null,
  curs   numeric(12,6) not null check (curs > 0),
  primary key (data, moneda)
);
alter table public.curs_bnr enable row level security;
revoke all on public.curs_bnr from anon;
create policy membri_citesc on public.curs_bnr for select to authenticated using (public.este_membru());
grant select on public.curs_bnr to authenticated;

-- Cursul BNR valabil la o dată: ultimul publicat în ziua respectivă sau înainte (weekend, sărbători).
create or replace function public.curs_bnr_la(p_data date, p_moneda char(3)) returns numeric
language sql stable security definer set search_path = public as $fn$
  select curs from public.curs_bnr where moneda = p_moneda and data <= p_data order by data desc limit 1
$fn$;
revoke execute on function public.curs_bnr_la(date, char) from anon, public;
grant execute on function public.curs_bnr_la(date, char) to authenticated;

-- ---------- Clasificare ----------
create or replace function public.pregateste_clasificare() returns trigger
language plpgsql security definer set search_path = public as $fn$
declare v_t public.tranzactii;
begin
  select * into v_t from public.tranzactii where id = new.tranzactie_id;
  if public.luna_inchisa(v_t.data_extras) then
    raise exception 'Luna % este închisă. Redeschide-o înainte de modificări.', to_char(v_t.data_extras, 'YYYY-MM');
  end if;
  if new.impartire is distinct from 'procent' then new.procent_precis := null;
  elsif tg_op = 'UPDATE' and new.procent_matei is distinct from old.procent_matei
        and new.procent_precis is not distinct from old.procent_precis then
    new.procent_precis := null;  -- s-a schimbat doar procentul cu 2 zecimale: acela contează
  end if;
  new.procent_matei := case new.impartire
    when '50_50' then 50 when 'matei_100' then 100 when 'alex_100' then 0 when 'exclus' then null
    else coalesce(round(new.procent_precis, 2), new.procent_matei) end;
  if new.suma_ron is not null and v_t.suma <> 0 and sign(new.suma_ron) <> sign(v_t.suma) then
    raise exception 'Suma în RON (%) trebuie să aibă același semn ca suma din extras (% %).', new.suma_ron, v_t.suma, v_t.moneda;
  end if;
  if coalesce(new.tva_ron, 0) <> 0 and (new.suma_ron is null or sign(new.tva_ron) <> sign(new.suma_ron) or abs(new.tva_ron) >= abs(new.suma_ron)) then
    raise exception 'TVA-ul (%) trebuie să aibă același semn ca suma în RON și să fie mai mic decât ea (%).', new.tva_ron, new.suma_ron;
  end if;
  if new.stare = 'confirmat' and new.impartire is distinct from 'exclus' and new.suma_ron is null then
    raise exception 'Linia de % % nu are suma în RON. Completează cursul înainte de confirmare.', v_t.suma, v_t.moneda;
  end if;
  if tg_op = 'UPDATE' then
    new.actualizat_de := nullif(public.email_curent(), '');
    new.actualizat_la := now();
    if new.stare = 'confirmat' and (old.stare is distinct from 'confirmat'
        or (new.categorie, new.impartire, new.procent_matei, new.procent_precis, new.suma_ron, new.tva_ron, new.curs, new.client_id,
            new.colaborator_id, new.cost_recurent_id, new.pereche_id)
           is distinct from (old.categorie, old.impartire, old.procent_matei, old.procent_precis, old.suma_ron, old.tva_ron, old.curs, old.client_id,
            old.colaborator_id, old.cost_recurent_id, old.pereche_id)) then
      -- cine salvează o linie confirmată cu alte valori o confirmă din nou, pe numele lui
      new.confirmat_de := new.actualizat_de; new.confirmat_la := now();
    elsif new.stare <> 'confirmat' then
      new.confirmat_de := null; new.confirmat_la := null;
    end if;
  end if;
  return new;
end $fn$;

-- ---------- Confirmările de lună devin invalide la orice modificare din luna respectivă ----------
create or replace function public.invalideaza_confirmari() returns trigger
language plpgsql security definer set search_path = public as $fn$
declare v_luni date[];
begin
  if tg_table_name = 'clasificari' then
    select array_agg(distinct date_trunc('month', t.data_extras)::date) into v_luni
      from public.tranzactii t where t.id in (coalesce(new.tranzactie_id, old.tranzactie_id));
    if tg_op = 'UPDATE' and (new.stare, new.categorie, new.impartire, new.procent_matei, new.procent_precis, new.suma_ron, new.tva_ron, new.curs,
         new.client_id, new.colaborator_id, new.cost_recurent_id, new.pereche_id)
        is not distinct from (old.stare, old.categorie, old.impartire, old.procent_matei, old.procent_precis, old.suma_ron, old.tva_ron, old.curs,
         old.client_id, old.colaborator_id, old.cost_recurent_id, old.pereche_id) then
      return null;
    end if;
  elsif tg_table_name = 'tranzactii' then
    v_luni := array[date_trunc('month', coalesce(new.data_extras, old.data_extras))::date];
  else
    v_luni := array_remove(array[case when tg_op <> 'INSERT' then old.luna end, case when tg_op <> 'DELETE' then new.luna end], null);
  end if;
  update public.confirmari_luna set valida = false where luna = any(v_luni) and valida;
  return null;
end $fn$;

create trigger invalideaza_clasificari after insert or update on public.clasificari
  for each row execute function public.invalideaza_confirmari();
create trigger invalideaza_tranzactii after insert or update or delete on public.tranzactii
  for each row execute function public.invalideaza_confirmari();
create trigger invalideaza_elemente after insert or update or delete on public.elemente_manuale
  for each row execute function public.invalideaza_confirmari();
create trigger invalideaza_rambursari after insert or update or delete on public.rambursari
  for each row execute function public.invalideaza_confirmari();
create trigger invalideaza_alocari after insert or update or delete on public.alocari
  for each row execute function public.invalideaza_confirmari();

-- ---------- Tranzacții: luni închise ----------
create or replace function public.protejeaza_tranzactii() returns trigger
language plpgsql security definer set search_path = public as $fn$
begin
  if tg_op = 'INSERT' then
    if public.luna_inchisa(new.data_extras) then
      raise exception 'Luna % este închisă. Redeschide-o înainte să adaugi linii.', to_char(new.data_extras, 'YYYY-MM');
    end if;
    return new;
  end if;
  if public.luna_inchisa(old.data_extras) or (tg_op = 'UPDATE' and public.luna_inchisa(new.data_extras)) then
    raise exception 'Luna % este închisă. Redeschide-o înainte de modificări.', to_char(old.data_extras, 'YYYY-MM');
  end if;
  if tg_op = 'DELETE' then
    if not old.manual then raise exception 'Liniile importate din extrase nu se pot șterge (tranzacția %).', old.id; end if;
    return old;
  end if;
  if not old.manual and (new.suma, new.moneda, new.data_extras, new.descriere, new.cont_id, new.import_id)
                       is distinct from (old.suma, old.moneda, old.data_extras, old.descriere, old.cont_id, old.import_id) then
    raise exception 'Suma, data și descrierea unei linii din extras nu se pot modifica (tranzacția %).', old.id;
  end if;
  return new;
end $fn$;
create or replace trigger protejeaza_tranzactii before insert or update or delete on public.tranzactii
  for each row execute function public.protejeaza_tranzactii();

-- ---------- Import: luni închise și extrase suprapuse ----------
create or replace function public.importa_extras(p jsonb) returns int
language plpgsql security definer set search_path = public as $fn$
declare
  v_cont public.conturi;
  v_import int;
  v_in numeric(14,2);
  v_out numeric(14,2);
  v_n int;
  v_bad int;
  v_alt public.importuri;
begin
  if not public.este_membru() then raise exception 'Acces interzis.'; end if;
  select * into v_cont from public.conturi where cod = p->>'cont_cod';
  if v_cont.id is null then raise exception 'Cont necunoscut %', p->>'cont_cod'; end if;

  if exists (select 1 from public.importuri where cont_id = v_cont.id and sha256 = p->>'sha256'
             and perioada_de = (p->>'perioada_de')::date and perioada_pana = (p->>'perioada_pana')::date) then
    return null;  -- deja importat
  end if;
  select * into v_alt from public.importuri
   where cont_id = v_cont.id and perioada_de <= (p->>'perioada_pana')::date and perioada_pana >= (p->>'perioada_de')::date
   limit 1;
  if v_alt.id is not null then
    raise exception 'Extrasul % (%) se suprapune cu importul % (%, % - %). Nu se importă de două ori aceeași perioadă.',
      p->>'fisier', p->>'cont_cod', v_alt.id, v_alt.fisier, v_alt.perioada_de, v_alt.perioada_pana;
  end if;
  if exists (select 1 from jsonb_array_elements(p->'linii') l where public.luna_inchisa((l->>'data_extras')::date)) then
    raise exception 'Extrasul % (%) are linii într-o lună închisă.', p->>'fisier', p->>'cont_cod';
  end if;

  select count(*), coalesce(sum((l->>'suma')::numeric) filter (where (l->>'suma')::numeric > 0), 0),
         coalesce(-sum((l->>'suma')::numeric) filter (where (l->>'suma')::numeric < 0), 0)
    into v_n, v_in, v_out
    from jsonb_array_elements(p->'linii') l;
  if v_in <> (p->>'total_intrari')::numeric or v_out <> (p->>'total_iesiri')::numeric then
    raise exception 'Extrasul % (%) nu se reconciliază: intrări % față de %, ieșiri % față de %',
      p->>'fisier', p->>'cont_cod', v_in, p->>'total_intrari', v_out, p->>'total_iesiri';
  end if;
  if (p->>'sold_initial')::numeric + v_in - v_out <> (p->>'sold_final')::numeric then
    raise exception 'Extrasul % (%) : sold inițial + intrări - ieșiri nu dă soldul final', p->>'fisier', p->>'cont_cod';
  end if;
  select count(*) into v_bad from (
    select nullif(l->>'sold_dupa', '')::numeric as sold, (l->>'suma')::numeric as suma,
           lag(nullif(l->>'sold_dupa', '')::numeric) over (order by (l->>'nr')::int) as anterior,
           (l->>'nr')::int as nr
    from jsonb_array_elements(p->'linii') l
  ) x where x.sold is not null and x.nr > 1 and x.anterior + x.suma <> x.sold;
  if v_bad > 0 then raise exception 'Extrasul % (%) : % linii nu se leagă de soldul anterior', p->>'fisier', p->>'cont_cod', v_bad; end if;

  insert into public.importuri (cont_id, fisier, sha256, perioada_de, perioada_pana, sold_initial, sold_final,
                                total_intrari, total_iesiri, nr_linii, importat_de, nota)
  values (v_cont.id, p->>'fisier', p->>'sha256', (p->>'perioada_de')::date, (p->>'perioada_pana')::date,
          (p->>'sold_initial')::numeric, (p->>'sold_final')::numeric, v_in, v_out, v_n, public.email_curent(), p->>'nota')
  returning id into v_import;

  insert into public.tranzactii (import_id, cont_id, nr_linie, data_extras, data_reala, tip, descriere, suma, moneda,
                                 suma_originala, sold_dupa)
  select v_import, v_cont.id, (l->>'nr')::int, (l->>'data_extras')::date, nullif(l->>'data_reala', '')::date,
         nullif(l->>'tip', ''), l->>'descriere', (l->>'suma')::numeric, v_cont.moneda,
         nullif(l->>'suma_originala', ''), nullif(l->>'sold_dupa', '')::numeric
  from jsonb_array_elements(p->'linii') l;

  update public.clasificari c set contrapartida = x.cp
  from (select t.id, l->>'contrapartida' as cp
        from jsonb_array_elements(p->'linii') l
        join public.tranzactii t on t.import_id = v_import and t.nr_linie = (l->>'nr')::int
        where coalesce(l->>'contrapartida', '') <> '') x
  where c.tranzactie_id = x.id;

  return v_import;
end $fn$;

-- ---------- Vederi ----------
-- Efectul pe linie, pe suma fără TVA:
--   cont al lui Alex / al firmei: efect = -(suma_ron - tva_ron) * procent_matei / 100
--   cont al lui Matei:            efect =  (suma_ron - tva_ron) * (100 - procent_matei) / 100
create or replace view public.v_tranzactii with (security_invoker = true) as
select t.id, t.import_id, t.cont_id, co.cod as cont_cod, co.nume as cont_nume, co.banca, co.titular,
       date_trunc('month', t.data_extras)::date as luna,
       t.data_extras, t.data_reala, t.tip, t.descriere, t.suma, t.moneda, t.suma_originala, t.sold_dupa, t.manual,
       c.stare, c.categorie, c.impartire, c.procent_matei, c.contrapartida, c.client_id, c.colaborator_id,
       c.cost_recurent_id, c.pereche_id, c.suma_ron, c.curs, c.sursa_curs, c.nota,
       c.actualizat_de, c.actualizat_la, c.confirmat_de, c.confirmat_la,
       case
         when c.impartire is null or c.impartire = 'exclus' or c.suma_ron is null or c.procent_matei is null then null
         when co.titular = 'matei' then round((c.suma_ron - coalesce(c.tva_ron, 0)) * (100 - coalesce(c.procent_precis, c.procent_matei)) / 100, 2)
         else round(-(c.suma_ron - coalesce(c.tva_ron, 0)) * coalesce(c.procent_precis, c.procent_matei) / 100, 2)
       end as efect_matei,
       (select count(*) from public.intrebari i where i.tranzactie_id = t.id and i.stare <> 'rezolvata') as intrebari_deschise,
       c.tva_ron, c.procent_precis
from public.tranzactii t
join public.clasificari c on c.tranzactie_id = t.id
join public.conturi co on co.id = t.cont_id;

create or replace view public.v_verificari with (security_invoker = true) as
select 'extras_nereconciliat'::text as verificare, null::date as luna, null::bigint as tranzactie_id,
       format('Importul %s (%s): intrări %s / ieșiri %s în baza de date, față de %s / %s în extras',
              i.id, i.fisier, s.intrari, s.iesiri, i.total_intrari, i.total_iesiri) as detaliu
from public.importuri i
join lateral (select coalesce(sum(suma) filter (where suma > 0), 0) as intrari,
                     coalesce(-sum(suma) filter (where suma < 0), 0) as iesiri
              from public.tranzactii t where t.import_id = i.id) s on true
where i.total_intrari is not null and (s.intrari <> i.total_intrari or s.iesiri <> i.total_iesiri)
union all
select 'lipsa_curs', v.luna, v.id, format('%s %s din %s nu are suma în RON', v.suma, v.moneda, v.data_extras)
from public.v_tranzactii v
where v.stare in ('propus','confirmat') and v.impartire is distinct from 'exclus' and v.suma_ron is null
union all
select 'semn_gresit', v.luna, v.id, format('suma %s %s, dar în RON %s', v.suma, v.moneda, v.suma_ron)
from public.v_tranzactii v
where v.suma_ron is not null and sign(v.suma_ron) <> sign(v.suma)
union all
select 'transfer_fara_pereche', v.luna, v.id, format('%s %s, transfer intern fără linia corespondentă', v.suma, v.moneda)
from public.v_tranzactii v
where v.categorie = 'transfer_intern' and v.pereche_id is null
union all
select 'transfer_nu_se_anuleaza', v.luna, v.id, format('%s RON față de %s RON în linia pereche %s', v.suma_ron, p.suma_ron, p.tranzactie_id)
from public.v_tranzactii v join public.clasificari p on p.tranzactie_id = v.pereche_id
where v.categorie = 'transfer_intern' and v.suma_ron is not null and p.suma_ron is not null and v.suma_ron + p.suma_ron <> 0
union all
select 'cost_recurent', l.luna, null,
       format('%s, %s plăți legate în luna aceasta (așteptat %s)', r.nume, count(t.id), r.plati_pe_luna)
from public.costuri_recurente r
join public.luni l on l.luna >= coalesce(r.prima_luna, '2025-11-01') and l.luna <= coalesce(r.ultima_luna, '2026-10-01')
left join public.clasificari c on c.cost_recurent_id = r.id
left join public.tranzactii t on t.id = c.tranzactie_id and date_trunc('month', t.data_extras) = l.luna
where r.confirmat
group by r.id, r.nume, r.plati_pe_luna, l.luna
having count(t.id) <> r.plati_pe_luna
union all
select 'alocare_incompleta', a.luna, null,
       format('%s, alocat %s%%', co.nume, sum(a.procent))
from public.alocari a join public.colaboratori co on co.id = a.colaborator_id
group by a.luna, co.nume
having sum(a.procent) <> 100
union all
select 'manual_fara_ron', e.luna, null, format('Element manual %s, %s %s fără sumă în RON', e.id, e.suma, e.moneda)
from public.elemente_manuale e where e.suma_ron is null
union all
select 'rambursare_fara_ron', r.luna, null, format('Rambursare %s, %s %s fără sumă în RON', r.id, r.suma, r.moneda)
from public.rambursari r where r.suma_ron is null
union all
select 'rambursare_legata', r.luna, r.tranzactie_id,
       format('Rambursarea %s e legată de linia %s, dar linia nu e confirmată ca bani primiți de la Matei (100%% Matei)', r.id, r.tranzactie_id)
from public.rambursari r join public.clasificari c on c.tranzactie_id = r.tranzactie_id
where r.stare = 'confirmat' and (c.stare <> 'confirmat' or c.impartire is distinct from 'matei_100')
union all
select 'tva_lipsa', v.luna, v.id, format('%s %s din %s (după 1 august 2026) fără TVA completat', v.suma, v.moneda, v.data_extras)
from public.v_tranzactii v
where v.data_extras >= '2026-08-01' and v.titular = 'firma' and v.categorie in ('venit_client', 'colaborator')
  and v.stare in ('propus','confirmat') and v.tva_ron is null;

