-- Închiderea lunii și editarea în masă, după verificarea pe date reale.
-- 1. Elementele manuale și rambursările confirmate au sumă în RON, pozitivă (sensul dă semnul).
-- 2. O lună nu se închide cât timp are probleme care schimbă bani sau întrebări generale deschise.
-- 3. Nu se pun întrebări noi pe o lună închisă.
-- 4. Suma în RON a unei linii în valută trebuie să se potrivească cu cursul (verificare nouă).
-- 5. Editarea în masă e o singură operație: totul sau nimic. O linie confirmată care se schimbă
--    redevine „propus”, ca să fie confirmată din nou.
-- 6. Două extrase din același cont nu pot acoperi aceeași perioadă (și la importuri simultane).

alter table public.clasificari add constraint confirmat_are_ron
  check (stare <> 'confirmat' or coalesce(impartire, '') = 'exclus' or suma_ron is not null);
alter table public.elemente_manuale add constraint elemente_confirmat_are_ron check (stare <> 'confirmat' or suma_ron is not null);
alter table public.elemente_manuale add constraint elemente_ron_pozitiv check (suma_ron is null or suma_ron >= 0);
alter table public.rambursari add constraint rambursari_confirmat_are_ron check (stare <> 'confirmat' or suma_ron is not null);
alter table public.rambursari add constraint rambursari_ron_pozitiv check (suma_ron is null or suma_ron >= 0);

create extension if not exists btree_gist with schema extensions;
alter table public.importuri add constraint importuri_fara_suprapunere
  exclude using gist (cont_id with =, daterange(perioada_de, perioada_pana, '[]') with &&);

-- ---------- Verificări: suma în RON față de curs ----------
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
  and v.stare in ('propus','confirmat') and v.tva_ron is null
union all
select 'ron_diferit_de_curs', v.luna, v.id,
       format('%s %s × curs %s = %s RON, dar suma în RON este %s', v.suma, v.moneda, v.curs, round(v.suma * v.curs, 2), v.suma_ron)
from public.v_tranzactii v
where v.moneda <> 'RON' and v.curs is not null and v.suma_ron is not null
  and abs(v.suma_ron - round(v.suma * v.curs, 2)) > greatest(0.01, abs(v.suma_ron) * 0.005);

-- ---------- Confirmarea lunii ----------
create or replace function public.confirma_luna(p_luna date) returns text
language plpgsql security definer set search_path = public as $fn$
declare v_neconf int; v_intreb int; v_gen int; v_total int; v_conf int; v_prob text;
begin
  if not public.este_membru() then raise exception 'Acces interzis.'; end if;
  select count(*) into v_neconf from public.tranzactii t join public.clasificari c on c.tranzactie_id = t.id
   where date_trunc('month', t.data_extras) = p_luna and c.stare <> 'confirmat';
  select count(*) into v_intreb from public.intrebari i
   left join public.tranzactii t on t.id = i.tranzactie_id
   left join public.elemente_manuale e on e.id = i.element_id
   where i.stare <> 'rezolvata' and date_trunc('month', coalesce(t.data_extras, e.luna)) = p_luna;
  if v_neconf > 0 or v_intreb > 0 then
    raise exception 'Luna nu poate fi confirmată: % linii neconfirmate, % întrebări deschise.', v_neconf, v_intreb;
  end if;
  select count(*) into v_gen from public.intrebari where stare <> 'rezolvata' and tranzactie_id is null and element_id is null;
  if v_gen > 0 then
    raise exception 'Sunt % întrebări generale deschise. Rezolvă-le înainte să confirmi o lună.', v_gen;
  end if;
  if exists (select 1 from public.elemente_manuale where luna = p_luna and stare <> 'confirmat')
     or exists (select 1 from public.rambursari where luna = p_luna and stare <> 'confirmat')
     or exists (select 1 from public.alocari where luna = p_luna and stare <> 'confirmat') then
    raise exception 'Luna are elemente manuale, rambursări sau alocări neconfirmate.';
  end if;
  select string_agg(distinct verificare, ', ') into v_prob from public.v_verificari
   where luna = p_luna and verificare in ('lipsa_curs', 'semn_gresit', 'transfer_nu_se_anuleaza', 'manual_fara_ron',
     'rambursare_fara_ron', 'rambursare_legata', 'tva_lipsa', 'ron_diferit_de_curs');
  if v_prob is not null then
    raise exception 'Luna are probleme care schimbă suma (%). Vezi pagina Verificări.', v_prob;
  end if;
  insert into public.confirmari_luna (luna, email) values (p_luna, public.email_curent())
  on conflict (luna, email) do update set valida = true, confirmat_la = now();
  select count(*) into v_total from public.membri;
  select count(*) into v_conf from public.confirmari_luna where luna = p_luna and valida;
  if v_conf >= v_total then
    update public.luni set status = 'inchisa' where luna = p_luna;
    return 'inchisa';
  end if;
  return 'confirmata ' || v_conf || '/' || v_total;
end $fn$;

-- ---------- Întrebări pe luni închise ----------
create or replace function public.blocheaza_intrebari_luna_inchisa() returns trigger
language plpgsql security definer set search_path = public as $fn$
declare v_data date;
begin
  if new.stare = 'rezolvata' then return new; end if;
  if new.tranzactie_id is not null then
    select data_extras into v_data from public.tranzactii where id = new.tranzactie_id;
  elsif new.element_id is not null then
    select luna into v_data from public.elemente_manuale where id = new.element_id;
  end if;
  if v_data is not null and public.luna_inchisa(v_data) then
    raise exception 'Luna % este închisă. Redeschide-o înainte să pui întrebări pe ea.', to_char(v_data, 'YYYY-MM');
  end if;
  return new;
end $fn$;
create trigger blocheaza_intrebari before insert or update on public.intrebari
  for each row execute function public.blocheaza_intrebari_luna_inchisa();

-- ---------- Editare în masă ----------
-- p: câmpurile de schimbat (categorie, impartire, procent_matei, procent_precis, stare, client_id, cost_recurent_id, nota).
-- Un câmp lipsă rămâne neschimbat. Fără „stare”, o linie confirmată care se schimbă redevine „propus”.
create or replace function public.clasifica_in_masa(p_ids bigint[], p jsonb) returns int
language plpgsql security invoker set search_path = public as $fn$
declare n int;
begin
  if not public.este_membru() then raise exception 'Acces interzis.'; end if;
  update public.clasificari c set
    categorie = x.categorie, impartire = x.impartire, procent_matei = x.procent_matei, procent_precis = x.procent_precis,
    client_id = x.client_id, cost_recurent_id = x.cost_recurent_id, nota = x.nota,
    stare = case
      when p ? 'stare' then p->>'stare'
      when c.stare = 'confirmat' and (x.categorie, x.impartire, x.procent_matei, x.procent_precis, x.client_id, x.cost_recurent_id)
           is distinct from (c.categorie, c.impartire, c.procent_matei, c.procent_precis, c.client_id, c.cost_recurent_id) then 'propus'
      else c.stare end
  from (select c2.tranzactie_id,
          case when p ? 'categorie' then p->>'categorie' else c2.categorie end as categorie,
          case when p ? 'impartire' then p->>'impartire' else c2.impartire end as impartire,
          case when p ? 'procent_matei' then (p->>'procent_matei')::numeric else c2.procent_matei end as procent_matei,
          case when p ? 'procent_precis' then (p->>'procent_precis')::numeric
               when p ? 'procent_matei' then null else c2.procent_precis end as procent_precis,
          case when p ? 'client_id' then (p->>'client_id')::int else c2.client_id end as client_id,
          case when p ? 'cost_recurent_id' then (p->>'cost_recurent_id')::int else c2.cost_recurent_id end as cost_recurent_id,
          case when p ? 'nota' then p->>'nota' else c2.nota end as nota
        from public.clasificari c2 where c2.tranzactie_id = any(p_ids)) x
  where c.tranzactie_id = x.tranzactie_id;
  get diagnostics n = row_count;
  return n;
end $fn$;
revoke execute on function public.clasifica_in_masa(bigint[], jsonb) from anon, public;
grant execute on function public.clasifica_in_masa(bigint[], jsonb) to authenticated;
