-- Creditele firmei și raportul pentru Matei.
--
-- Regula lui Alex (02.11.2026) pentru creditele luate de firmă: banii primiți se împart 50/50 la încasare,
-- ratele plătite 50/50, iar la data de tăiere Matei preia jumătate din capitalul rămas de plată.
-- Banii împrumutați se anulează între ei, așa că Matei suportă jumătate din costul creditului (dobânzi, comisioane,
-- comisionul reținut la acordare) până la ultima rată plătită înainte de data de tăiere.
--
-- Capitalul rămas se ia din graficul de rambursare, după ultima rată găsită în extrase, sau din soldul confirmat de
-- creditor, când e completat. După fiecare import, sincronizeaza_credite() aduce elementul manual la zi; până atunci
-- verificarea „credit_nesincronizat” blochează închiderea lunii.
--
-- Datele creditelor (contract, sume, grafic) și textele regulilor din raport NU sunt în acest fișier: repo-ul e public.
-- Se introduc direct în baza de date.

-- Data de tăiere a calculului (perioada e noiembrie 2025 – octombrie 2026), la fel ca data_inregistrare_tva().
create or replace function public.data_taiere() returns date language sql immutable as $$ select date '2026-10-31' $$;

create table public.credite (
  id                     serial primary key,
  cod                    text not null unique,
  nume                   text not null,
  creditor               text not null,
  contract               text,
  data_acordare          date not null,
  valoare                numeric(14,2) not null check (valoare > 0),
  dobanda                text,
  luni                   integer,
  tranzactie_incasare_id bigint not null unique references public.tranzactii(id),
  -- Ratele se recunosc în extrasele firmei după text și după sumă (BT folosește același text pentru două credite).
  model_plata            text not null check (('' ~* model_plata) is not null),
  plata_min              numeric(14,2) not null check (plata_min > 0),
  plata_max              numeric(14,2) not null check (plata_max >= plata_min),
  procent_matei          numeric(9,6) not null default 50 check (procent_matei between 0 and 100),
  -- Soldul de capital din extrasul creditorului, după o anumită rată: înlocuiește graficul doar cât timp
  -- în extrasele firmei sunt exact atâtea rate (altfel verificarea credit_nesincronizat cere actualizarea lui).
  sold_creditor          numeric(14,2) check (sold_creditor >= 0),
  sold_creditor_dupa_rata integer check (sold_creditor_dupa_rata >= 0),
  data_sold_creditor     date check (data_sold_creditor <= public.data_taiere()),
  sursa_sold_creditor    text,
  element_manual_id      integer unique references public.elemente_manuale(id),
  dovada                 text,
  nota                   text,
  creat_la               timestamptz not null default now(),
  creat_de               text default nullif(public.email_curent(), ''),
  check ((sold_creditor is null) = (data_sold_creditor is null)),
  check ((sold_creditor is null) = (sold_creditor_dupa_rata is null))
);

create table public.credite_grafic (
  credit_id     integer not null references public.credite(id) on delete cascade,
  nr            integer not null check (nr > 0),
  data_scadenta date not null,
  capital       numeric(14,2) not null,
  dobanda       numeric(14,2) not null,
  comision      numeric(14,2) not null default 0,
  rata          numeric(14,2) not null,
  sold          numeric(14,2) not null check (sold >= 0),
  primary key (credit_id, nr),
  check (abs(capital + dobanda + comision - rata) <= 0.01)
);

-- Textele din „Raport pentru Matei”: regulile generale, regula fiecărui bloc de categorii și legenda regulilor
-- numerotate la care trimit notele liniilor („regula 26”).
create table public.raport_reguli (
  id         serial primary key,
  tip        text not null check (tip in ('general','bloc','legenda')),
  ordine     integer not null,
  titlu      text,
  categorii  text[] not null default '{}',
  text       text not null,
  creat_la   timestamptz not null default now()
);

alter table public.credite enable row level security;
alter table public.credite_grafic enable row level security;
alter table public.raport_reguli enable row level security;
revoke all on public.credite, public.credite_grafic, public.raport_reguli from anon;
grant select, insert, update, delete on public.credite, public.credite_grafic, public.raport_reguli to authenticated;
grant usage on sequence public.credite_id_seq, public.raport_reguli_id_seq to authenticated;
do $do$
declare t text;
begin
  foreach t in array array['credite','credite_grafic','raport_reguli'] loop
    execute format('create policy membri_citesc on public.%I for select to authenticated using (public.este_membru())', t);
    execute format('create policy membri_adauga on public.%I for insert to authenticated with check (public.este_editor())', t);
    execute format('create policy membri_modifica on public.%I for update to authenticated using (public.este_editor()) with check (public.este_editor())', t);
    execute format('create policy membri_sterg on public.%I for delete to authenticated using (public.este_editor())', t);
  end loop;
end $do$;

create trigger jurnal_credite after insert or update or delete on public.credite
  for each row execute function public.scrie_jurnal('id');
create trigger jurnal_credite_grafic after insert or update or delete on public.credite_grafic
  for each row execute function public.scrie_jurnal('credit_id');
create trigger jurnal_raport_reguli after insert or update or delete on public.raport_reguli
  for each row execute function public.scrie_jurnal('id');

-- Sumă în format românesc: 1234567.8 → „1.234.567,80”.
create or replace function public.lei(x numeric) returns text
language sql immutable as $$
  select replace(replace(replace(to_char(x, 'FM999,999,999,990.00'), ',', '#'), '.', ','), '#', '.')
$$;

-- Un rând pe credit: ce s-a primit, ce rate s-au plătit până la data de tăiere, cât capital a rămas,
-- cât a costat creditul și cum apare în calcul (încasarea, ratele, elementul manual).
create or replace view public.v_credite with (security_invoker = on) as
with plati as (
  select cr.id as credit_id, t.id as tranzactie_id, t.data_extras, -t.suma as suma
  from public.credite cr
  join public.tranzactii t on t.data_extras between cr.data_acordare and public.data_taiere()
  join public.conturi co on co.id = t.cont_id and co.titular = 'firma'
  where t.moneda = 'RON' and t.suma < 0 and t.descriere ~* cr.model_plata
    and -t.suma between cr.plata_min and cr.plata_max
), pe_credit as (
  select credit_id, count(*)::int as rate_platite, sum(suma) as platit, max(data_extras) as ultima_plata,
         array_agg(tranzactie_id order by data_extras, tranzactie_id) as plati_ids
  from plati group by credit_id
), baza as (
  select cr.id, cr.cod, cr.nume, cr.creditor, cr.contract, cr.data_acordare, cr.valoare, cr.dobanda, cr.luni, cr.procent_matei,
         cr.tranzactie_incasare_id, cr.element_manual_id, cr.dovada, cr.nota,
         cr.sold_creditor, cr.sold_creditor_dupa_rata, cr.data_sold_creditor, cr.sursa_sold_creditor,
         inc.suma as primit,
         (select max(i.perioada_pana) from public.importuri i where i.cont_id = inc.cont_id) as extrase_pana,
         coalesce(p.rate_platite, 0) as rate_platite, coalesce(p.platit, 0) as platit, p.ultima_plata,
         coalesce(p.plati_ids, '{}') as plati_ids,
         case when coalesce(p.rate_platite, 0) = 0 then cr.valoare else gs.sold end as sold_grafic,
         gs.data_scadenta as scadenta_ultima_rata
  from public.credite cr
  join public.tranzactii inc on inc.id = cr.tranzactie_incasare_id
  left join pe_credit p on p.credit_id = cr.id
  left join public.credite_grafic gs on gs.credit_id = cr.id and gs.nr = p.rate_platite
), cu_sold as (
  select b.*,
         case when b.sold_creditor_dupa_rata = b.rate_platite then b.sold_creditor else b.sold_grafic end as sold,
         case when b.sold_creditor_dupa_rata = b.rate_platite then 'creditor' else 'grafic' end as sursa_sold,
         (b.sold_creditor is not null and b.sold_creditor_dupa_rata is distinct from b.rate_platite) as sold_creditor_vechi
  from baza b
)
select b.id, b.cod, b.nume, b.creditor, b.contract, b.data_acordare, b.valoare, b.dobanda, b.luni, b.procent_matei,
       b.tranzactie_incasare_id, b.element_manual_id, b.dovada, b.nota,
       public.data_taiere() as data_taiere, b.extrase_pana,
       b.primit, b.valoare - b.primit as comision_acordare,
       b.rate_platite, b.platit, b.ultima_plata, b.plati_ids, b.scadenta_ultima_rata,
       g.capital as capital_grafic, g.dobanda as dobanda_grafic, g.comision as comision_grafic, g.rata as rate_grafic,
       b.sold_grafic, b.sold_creditor, b.sold_creditor_dupa_rata, b.data_sold_creditor, b.sursa_sold_creditor,
       b.sold, b.sursa_sold, b.sold_creditor_vechi,
       (b.sold is null) as grafic_lipsa,
       b.platit + b.sold - b.primit as cost,
       round(b.sold * b.procent_matei / 100, 2) as parte_matei_sold,
       round((b.platit + b.sold - b.primit) * b.procent_matei / 100, 2) as cost_matei,
       -- Ratele din grafic cu scadența până la data de tăiere care nu sunt (încă) în extrase.
       (select count(*)::int from public.credite_grafic x
         where x.credit_id = b.id and x.nr > b.rate_platite and x.data_scadenta <= public.data_taiere()) as rate_neimportate,
       vi.stare as stare_incasare, vi.impartire as impartire_incasare, vi.efect_matei as efect_incasare,
       r.efect as efect_rate, r.confirmate as rate_confirmate, r.fara_impartire as rate_fara_impartire,
       em.suma_ron as element_suma_ron, em.stare as element_stare, em.luna as element_luna
from cu_sold b
left join lateral (
  select sum(capital) as capital, sum(dobanda) as dobanda, sum(comision) as comision, sum(rata) as rata
  from public.credite_grafic g where g.credit_id = b.id and g.nr <= b.rate_platite
) g on true
left join lateral (
  select sum(v.efect_matei) as efect,
         count(*) filter (where v.stare = 'confirmat')::int as confirmate,
         count(*) filter (where v.impartire is null)::int as fara_impartire
  from public.v_tranzactii v where v.id = any(b.plati_ids)
) r on true
left join public.v_tranzactii vi on vi.id = b.tranzactie_incasare_id
left join public.elemente_manuale em on em.id = b.element_manual_id;
revoke all on public.v_credite from anon;
grant select on public.v_credite to authenticated;

-- Pune în calcul partea lui Matei din capitalul rămas, ca element manual (Matei → Alex), în luna datei de tăiere.
-- Un element confirmat nu se mai atinge: dacă nu mai corespunde, doar se numără (și verificarea blochează luna).
-- Nota elementului se scrie doar la creare; dovada și suma se țin la zi.
-- Se rulează după fiecare import: select * from public.sincronizeaza_credite();
create or replace function public.sincronizeaza_credite()
 returns table(actualizate integer, confirmate_diferite integer, fara_grafic integer)
 language plpgsql security definer set search_path to 'public'
as $function$
declare
  v_act int := 0; v_dif int := 0; v_fara int := 0;
  r record; v_id int; v_luna date; v_data date; v_desc text; v_dovada text; v_n int;
begin
  if not public.este_editor() and coalesce(public.email_curent(), '') <> '' then raise exception 'Acces interzis.'; end if;
  v_data := public.data_taiere();
  v_luna := date_trunc('month', v_data)::date;
  for r in select * from public.v_credite order by id loop
    if r.grafic_lipsa then v_fara := v_fara + 1; continue; end if;
    if r.parte_matei_sold <= 0 then
      -- Nu mai e nimic de preluat (credit achitat sau 0% Matei): elementul vechi iese din calcul.
      if r.element_manual_id is not null then
        if r.element_stare = 'confirmat' then v_dif := v_dif + 1;
        else
          update public.credite set element_manual_id = null where id = r.id;
          delete from public.elemente_manuale where id = r.element_manual_id;
          v_act := v_act + 1;
        end if;
      end if;
      continue;
    end if;
    v_desc := r.nume || ': ' || public.lei(r.procent_matei) || '% din capitalul rămas de plată după rata ' || r.rate_platite
              || coalesce(' (' || to_char(r.ultima_plata, 'DD.MM.YYYY') || ')', '')
              || case when r.sursa_sold = 'creditor' then ', conform extrasului creditorului' else ', conform graficului' end;
    v_dovada := coalesce(r.dovada || ' ', '') || 'Capital rămas după rata ' || r.rate_platite || ': ' || public.lei(r.sold) || ' lei'
              || case when r.sursa_sold = 'creditor'
                      then ' (sold confirmat de creditor la ' || to_char(r.data_sold_creditor, 'DD.MM.YYYY') || coalesce(', ' || r.sursa_sold_creditor, '') || ')'
                      else ' (din grafic)' end
              || '. Costul creditului până la această rată: ' || public.lei(r.cost) || ', din care Matei ' || public.lei(r.cost_matei) || '.';
    if r.element_manual_id is null then
      insert into public.elemente_manuale (luna, data, descriere, suma, moneda, suma_ron, sens, dovada, stare, nota, creat_de)
      values (v_luna, v_data, v_desc, r.parte_matei_sold, 'RON', r.parte_matei_sold, 'matei_datoreaza_alex', v_dovada, 'propus',
              'Regula creditelor (Alex, 02.11.2026): banii primiți 50/50, ratele 50/50, iar la data de tăiere Matei preia '
              || public.lei(r.procent_matei) || '% din capitalul rămas. Creat de sincronizeaza_credite().',
              coalesce(nullif(public.email_curent(), ''), 'claude'))
      returning id into v_id;
      update public.credite set element_manual_id = v_id where id = r.id;
      v_act := v_act + 1;
    elsif r.element_stare = 'confirmat' then
      if r.element_suma_ron is distinct from r.parte_matei_sold or r.element_luna is distinct from v_luna then v_dif := v_dif + 1; end if;
    else
      update public.elemente_manuale e set
        luna = v_luna, data = v_data, descriere = v_desc, suma = r.parte_matei_sold, moneda = 'RON', curs = null,
        suma_ron = r.parte_matei_sold, sens = 'matei_datoreaza_alex', dovada = v_dovada
      where e.id = r.element_manual_id
        and (e.luna, e.data, e.descriere, e.suma, e.moneda, e.curs, e.suma_ron, e.sens, e.dovada)
            is distinct from (v_luna, v_data, v_desc, r.parte_matei_sold, 'RON'::bpchar, null::numeric,
                              r.parte_matei_sold, 'matei_datoreaza_alex'::text, v_dovada);
      get diagnostics v_n = row_count;
      v_act := v_act + v_n;
    end if;
  end loop;
  return query select v_act, v_dif, v_fara;
end $function$;
revoke execute on function public.sincronizeaza_credite() from anon, public;
grant execute on function public.sincronizeaza_credite() to authenticated;

-- Verificări noi care schimbă suma:
--  • credit_nesincronizat: elementul manual al unui credit nu mai corespunde ratelor din extrase (sau lipsește graficul);
--  • tva_lipsa acoperă și facturile FA plătite de Librio / TH Media (bani puși de Matei), care din 20.08.2026 au TVA.
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
select 'tva_lipsa', v.luna, v.id, format('%s %s din %s fără TVA completat (din august 2026 se socotește fără TVA)', v.suma, v.moneda, v.data_extras)
from public.v_tranzactii v
where v.titular = 'firma' and v.stare in ('propus','confirmat') and v.tva_ron is null
  and ((v.data_extras >= '2026-08-01' and v.categorie in ('venit_client', 'colaborator'))
       or (v.data_extras >= public.data_inregistrare_tva() and v.categorie = 'rambursare_matei' and v.suma > 0
           and v.descriere ~* 'FSF ?[0-9]'))
union all
select 'ron_diferit_de_curs', v.luna, v.id,
       format('%s %s × curs %s = %s RON, dar suma în RON este %s', v.suma, v.moneda, v.curs, round(v.suma * v.curs, 2), v.suma_ron)
from public.v_tranzactii v
where v.moneda <> 'RON' and v.curs is not null and v.suma_ron is not null
  and abs(v.suma_ron - round(v.suma * v.curs, 2)) > greatest(0.01, abs(v.suma_ron) * 0.005)
union all
select 'credit_nesincronizat', m.luna, c.tranzactie_incasare_id,
       c.nume || ': ' || concat_ws('; ',
         case when c.grafic_lipsa then 'lipsește rândul ' || c.rate_platite || ' din grafic (sau soldul de la creditor după această rată)' end,
         case when c.sold_creditor_vechi then 'soldul de la creditor e după rata ' || c.sold_creditor_dupa_rata
                                              || ', dar în extrase sunt ' || c.rate_platite || ' rate: actualizează soldul' end,
         case when c.element_stare = 'confirmat' and c.parte_matei_sold > 0
                   and (c.element_suma_ron is distinct from c.parte_matei_sold
                        or c.element_luna is distinct from date_trunc('month', public.data_taiere())::date)
              then 'elementul manual e confirmat, dar nu mai corespunde: trece-l pe Propus în Sume manuale, apoi Recalculează creditele' end,
         case when coalesce(c.element_stare, '') <> 'confirmat' and c.parte_matei_sold > 0 and c.element_suma_ron is distinct from c.parte_matei_sold
              then 'elementul manual are ' || coalesce(public.lei(c.element_suma_ron), 'nimic') || ' lei, după ratele din extrase ar trebui '
                   || public.lei(c.parte_matei_sold) || ' lei: Recalculează creditele' end,
         case when coalesce(c.element_stare, '') <> 'confirmat' and c.parte_matei_sold > 0
                   and c.element_luna is distinct from date_trunc('month', public.data_taiere())::date and c.element_manual_id is not null
              then 'elementul manual e pe ' || to_char(c.element_luna, 'MM.YYYY') || ', trebuie pe luna datei de tăiere: Recalculează creditele' end,
         case when c.parte_matei_sold <= 0 and c.element_manual_id is not null then 'nu mai e capital de preluat, dar elementul manual a rămas' end,
         case when not c.grafic_lipsa and abs(coalesce(c.efect_incasare, 0) + coalesce(c.efect_rate, 0) + coalesce(c.element_suma_ron, 0) - c.cost_matei)
                   > 0.01 * (c.rate_platite + 2)
              then 'încasarea și ratele nu sunt împărțite cu ' || public.lei(c.procent_matei) || '% Matei' end)
from public.v_credite c
cross join lateral (select date_trunc('month', public.data_taiere())::date as luna
                    union select c.element_luna where c.element_luna is not null) m
where c.grafic_lipsa
   or c.sold_creditor_vechi
   or (c.parte_matei_sold > 0 and (c.element_suma_ron is distinct from c.parte_matei_sold
                                   or c.element_luna is distinct from date_trunc('month', public.data_taiere())::date))
   or (c.parte_matei_sold <= 0 and c.element_manual_id is not null)
   or (not c.grafic_lipsa and abs(coalesce(c.efect_incasare, 0) + coalesce(c.efect_rate, 0) + coalesce(c.element_suma_ron, 0) - c.cost_matei)
       > 0.01 * (c.rate_platite + 2));

-- Pagina „Ce lipsește” arată și creditele nesincronizate printre problemele care schimbă suma.
create or replace view public.v_lipsuri with (security_invoker = on) as
with acoperire as (
  -- Pentru fiecare cont cu extrase și fiecare lună de la primul extras: până unde avem date.
  select c.id as cont_id, c.nume, l.luna,
         max(i.perioada_pana) filter (where i.perioada_de <= l.luna and i.perioada_pana >= l.luna) as pana
  from public.conturi c
  join public.luni l on l.luna >= (select date_trunc('month', min(i2.perioada_de))::date from public.importuri i2 where i2.cont_id = c.id)
  left join public.importuri i on i.cont_id = c.id
  where exists (select 1 from public.importuri i3 where i3.cont_id = c.id)
  group by c.id, c.nume, l.luna
), suma as (
  select v.*, abs(coalesce(v.suma_ron, v.suma)) as valoare from public.v_tranzactii v
)
select 1 as ordine, 'Extrase lipsă'::text as zona,
       a.nume || case when a.pana is null then ': lipsește toată luna' else ': avem doar până la ' || to_char(a.pana, 'DD.MM.YYYY') end as ce,
       a.luna, null::int as linii, null::numeric as suma, 'import'::text as pagina, null::text as filtru
from acoperire a where a.pana is null or a.pana < (a.luna + interval '1 month - 1 day')::date
union all
select 2, 'Linii neclasificate', coalesce(cat.eticheta, 'fără categorie'), null, count(*)::int, sum(s.valoare),
       'tranzactii', 'stare=neclasificat&categorie=' || coalesce(s.categorie, '-')
from suma s left join public.categorii cat on cat.cod = s.categorie
where s.stare = 'neclasificat' group by cat.eticheta, s.categorie
union all
select 3, 'Linii cu întrebări', coalesce(cat.eticheta, 'fără categorie'), null, count(*)::int, sum(s.valoare),
       'tranzactii', 'stare=intrebare&categorie=' || coalesce(s.categorie, '-')
from suma s left join public.categorii cat on cat.cod = s.categorie
where s.stare = 'intrebare' group by cat.eticheta, s.categorie
union all
-- Întrebările deschise (și cele pe linii deja confirmate sau propuse): se rezolvă din pagina Întrebări.
select 3, 'Întrebări deschise',
       'pentru ' || coalesce(m.nume, i.pentru, 'oricine') || case when i.stare = 'raspunsa' then ': au răspuns, de închis' else ': așteaptă răspuns' end,
       null, count(*)::int, sum(s.valoare), 'intrebari', 'stare=' || i.stare
from (select distinct on (coalesce(tranzactie_id, -id)) id, tranzactie_id, pentru, stare
      from public.intrebari where stare <> 'rezolvata' and element_id is null
      order by coalesce(tranzactie_id, -id), creat_la) i
left join suma s on s.id = i.tranzactie_id
left join public.membri m on lower(m.email) = lower(i.pentru)
group by m.nume, i.pentru, i.stare
union all
select 4, 'De confirmat (propuse)', coalesce(cat.eticheta, 'fără categorie'), null, count(*)::int, sum(s.valoare),
       'tranzactii', 'stare=propus&categorie=' || coalesce(s.categorie, '-')
from suma s left join public.categorii cat on cat.cod = s.categorie
where s.stare = 'propus' group by cat.eticheta, s.categorie
union all
select 5, 'Probleme care schimbă suma', x.verificare, null, count(*)::int, null, 'verificari', null
from public.v_verificari x
where x.verificare in ('lipsa_curs', 'semn_gresit', 'transfer_nu_se_anuleaza', 'manual_fara_ron',
  'rambursare_fara_ron', 'rambursare_legata', 'tva_lipsa', 'ron_diferit_de_curs', 'credit_nesincronizat')
group by x.verificare
union all
select 5, 'Probleme care schimbă suma', 'TVA din facturi neaplicat', p.luna, count(*)::int,
       sum(abs(p.tva_calculat - coalesce(p.tva_actual, 0))), 'facturi', null
from public.v_tva_propuneri p
where p.situatie in ('nou', 'diferit') and p.tva_calculat <> coalesce(p.tva_actual, 0) and not p.inchisa
  and coalesce(p.impartire, '') not in ('alex_100', 'exclus')
  and not (p.tip in ('incasare', 'colaborator') and p.tva_actual is null)
group by p.luna
union all
select 6, 'Sume manuale neconfirmate', e.descriere, e.luna, null, abs(e.suma_ron), 'manual', null
from public.elemente_manuale e where e.stare <> 'confirmat'
union all
select 6, 'Rambursări neconfirmate', coalesce(r.nota, 'rambursare #' || r.id), r.luna, null, abs(r.suma_ron), 'manual', null
from public.rambursari r where r.stare <> 'confirmat'
union all
select 7, 'Costuri recurente neconfirmate', r.nume || coalesce(' (' || to_char(r.suma, 'FM999G999G990D00') || ' ' || r.moneda || ')', ''),
       r.prima_luna, null, null::numeric, 'nomenclatoare', null
from public.costuri_recurente r where not r.confirmat
union all
select 8, 'Luni neînchise',
       case when exists (select 1 from public.confirmari_luna k where k.luna = l.luna and k.valida)
            then 'confirmată doar de ' || (select string_agg(k.email, ', ') from public.confirmari_luna k where k.luna = l.luna and k.valida)
            else 'neconfirmată' end,
       l.luna, null, null, 'prezentare', null
from public.luni l where l.status <> 'inchisa';

-- O lună nu se închide cât timp elementul unui credit nu corespunde ratelor din extrase.
create or replace function public.confirma_luna(p_luna date)
 returns text
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare v_neconf int; v_intreb int; v_gen int; v_total int; v_conf int; v_prob text;
begin
  if not public.este_editor() then raise exception 'Acces interzis.'; end if;
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
     'rambursare_fara_ron', 'rambursare_legata', 'tva_lipsa', 'ron_diferit_de_curs', 'credit_nesincronizat');
  if v_prob is not null then
    raise exception 'Luna are probleme care schimbă suma (%). Vezi pagina Verificări.', v_prob;
  end if;
  insert into public.confirmari_luna (luna, email) values (p_luna, public.email_curent())
  on conflict (luna, email) do update set valida = true, confirmat_la = now();
  select count(*) into v_total from public.membri where rol in ('admin','editor');
  select count(*) into v_conf from public.confirmari_luna k join public.membri m on lower(m.email) = lower(k.email)
   where k.luna = p_luna and k.valida and m.rol in ('admin','editor');
  if v_conf >= v_total then
    update public.luni set status = 'inchisa' where luna = p_luna;
    return 'inchisa';
  end if;
  return 'confirmata ' || v_conf || '/' || v_total;
end $function$;
