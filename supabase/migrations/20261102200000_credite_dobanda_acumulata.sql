-- Creditele firmei: dobânda și comisioanele acumulate până la data de tăiere.
--
-- Alex, 02.11.2026: Matei suportă și dobânda și comisioanele care se adună de la ultima rată de dinainte de tăiere
-- până la 31.10.2026 (se plătesc cu ratele din noiembrie). La data de tăiere Matei preia deci partea lui din tot ce
-- mai era de plătit: capitalul rămas plus dobânda și comisioanele acumulate, din grafic:
--  • ratele scadente până la data de tăiere care nu sunt (încă) în extrase intră cu toată dobânda și tot comisionul;
--  • prima rată de după data de tăiere intră pe zile, de la scadența ratei dinaintea ei până la data de tăiere.
-- Costul suportat de Matei nu se mai schimbă când se importă o rată plătită conform graficului: dobânda ei e deja
-- socotită și trece doar de la „acumulat” la „rate plătite”.
--
-- v_credite: aceleași coloane, cu cost / parte_matei_sold / cost_matei calculate pe datoria de la data de tăiere și
-- grafic_lipsa adevărat și când graficul nu are rândurile pentru dobânda acumulată; coloanele noi sunt la sfârșit.
-- sincronizeaza_credite(): aceeași logică, textele elementului manual spun și dobânda acumulată.
-- v_verificari: doar mesajele verificării credit_nesincronizat.
-- La sfârșit, elementele manuale ale creditelor se aduc la zi (altfel credit_nesincronizat ar bloca luna până la
-- prima „Recalculează creditele”).

-- Un rând pe credit: ce s-a primit, ce rate s-au plătit până la data de tăiere, cât capital a rămas, ce dobândă și
-- comisioane s-au adunat până la data de tăiere, cât a costat creditul și cum apare în calcul (încasarea, ratele,
-- elementul manual).
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
), cu_acumulat as (
  -- Dobânda și comisioanele câștigate de creditor până la data de tăiere, minus cele cuprinse în ratele găsite în
  -- extrase, după grafic. Ratele scadente până la tăiere care nu sunt (încă) în extrase intră întregi; prima rată
  -- scadentă după tăiere intră pe zile, de la scadența ratei dinaintea ei (zilele = diferența dintre date, ca în
  -- grafic); o rată plătită înainte, dar scadentă după tăiere, scade cu partea ei de după tăiere.
  -- Dacă graficul nu are rândurile de care e nevoie, graficul e incomplet și sumele rămân null (grafic_lipsa).
  select b.*,
         case when b.rate_platite = 0 then b.data_acordare else b.scadenta_ultima_rata end as acumulat_de_la,
         ap.nr as rata_partiala,
         public.data_taiere() - ap.de_la as zile_partiale,
         ap.data_scadenta - ap.de_la as zile_rata_partiala,
         (b.sold is null
          or (b.rate_platite > 0 and b.scadenta_ultima_rata is null)
          or (ap.nr is null and b.sold - ai.capital > 0.005)
          or (ap.nr is not null and (ap.de_la is null or ai.n + pa.n <> abs(ap.nr - 1 - b.rate_platite)))) as grafic_incomplet,
         ai.dobanda - pa.dobanda
           + coalesce(ap.dobanda * (public.data_taiere() - ap.de_la) / nullif(ap.data_scadenta - ap.de_la, 0), 0) as dobanda_bruta,
         ai.comision - pa.comision
           + coalesce(ap.comision * (public.data_taiere() - ap.de_la) / nullif(ap.data_scadenta - ap.de_la, 0), 0) as comision_brut
  from cu_sold b
  -- Ratele scadente până la data de tăiere care nu sunt (încă) în extrase.
  left join lateral (
    select count(*)::int as n, coalesce(sum(g.capital), 0) as capital,
           coalesce(sum(g.dobanda), 0) as dobanda, coalesce(sum(g.comision), 0) as comision
    from public.credite_grafic g
    where g.credit_id = b.id and g.nr > b.rate_platite and g.data_scadenta <= public.data_taiere()
  ) ai on true
  -- Ratele găsite în extrase, dar scadente după data de tăiere (plătite înainte).
  left join lateral (
    select count(*)::int as n, coalesce(sum(g.dobanda), 0) as dobanda, coalesce(sum(g.comision), 0) as comision
    from public.credite_grafic g
    where g.credit_id = b.id and g.nr <= b.rate_platite and g.data_scadenta > public.data_taiere()
  ) pa on true
  -- Prima rată scadentă după data de tăiere și scadența ratei dinaintea ei.
  left join lateral (
    select g.nr, g.data_scadenta, g.dobanda, g.comision,
           case when g.nr = 1 then b.data_acordare
                else (select p.data_scadenta from public.credite_grafic p where p.credit_id = g.credit_id and p.nr = g.nr - 1) end as de_la
    from public.credite_grafic g
    where g.credit_id = b.id and g.data_scadenta > public.data_taiere()
    order by g.nr limit 1
  ) ap on true
), cu_rotunjit as (
  select a.*,
         case when a.grafic_incomplet then null else round(a.dobanda_bruta, 2) end as dobanda_acumulata,
         case when a.grafic_incomplet then null else round(a.comision_brut, 2) end as comision_acumulat
  from cu_acumulat a
), cu_total as (
  select a.*, a.dobanda_acumulata + a.comision_acumulat as acumulat from cu_rotunjit a
)
select b.id, b.cod, b.nume, b.creditor, b.contract, b.data_acordare, b.valoare, b.dobanda, b.luni, b.procent_matei,
       b.tranzactie_incasare_id, b.element_manual_id, b.dovada, b.nota,
       public.data_taiere() as data_taiere, b.extrase_pana,
       b.primit, b.valoare - b.primit as comision_acordare,
       b.rate_platite, b.platit, b.ultima_plata, b.plati_ids, b.scadenta_ultima_rata,
       g.capital as capital_grafic, g.dobanda as dobanda_grafic, g.comision as comision_grafic, g.rata as rate_grafic,
       b.sold_grafic, b.sold_creditor, b.sold_creditor_dupa_rata, b.data_sold_creditor, b.sursa_sold_creditor,
       b.sold, b.sursa_sold, b.sold_creditor_vechi,
       (b.sold is null or b.acumulat is null) as grafic_lipsa,
       -- Costul până la data de tăiere și partea lui Matei din ce mai era de plătit atunci: capitalul rămas
       -- plus dobânda și comisioanele acumulate (Alex, 02.11.2026).
       b.platit + b.sold + b.acumulat - b.primit as cost,
       round((b.sold + b.acumulat) * b.procent_matei / 100, 2) as parte_matei_sold,
       round((b.platit + b.sold + b.acumulat - b.primit) * b.procent_matei / 100, 2) as cost_matei,
       -- Ratele din grafic cu scadența până la data de tăiere care nu sunt (încă) în extrase.
       (select count(*)::int from public.credite_grafic x
         where x.credit_id = b.id and x.nr > b.rate_platite and x.data_scadenta <= public.data_taiere()) as rate_neimportate,
       vi.stare as stare_incasare, vi.impartire as impartire_incasare, vi.efect_matei as efect_incasare,
       r.efect as efect_rate, r.confirmate as rate_confirmate, r.fara_impartire as rate_fara_impartire,
       em.suma_ron as element_suma_ron, em.stare as element_stare, em.luna as element_luna,
       b.dobanda_acumulata, b.comision_acumulat, b.acumulat, b.acumulat_de_la,
       b.rata_partiala, b.zile_partiale, b.zile_rata_partiala,
       -- Ce mai era de plătit la data de tăiere: capitalul rămas plus dobânda și comisioanele acumulate.
       b.sold + b.acumulat as sold_taiere
from cu_total b
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

-- Pune în calcul partea lui Matei din ce mai era de plătit la data de tăiere (capitalul rămas plus dobânda și
-- comisioanele acumulate), ca element manual (Matei → Alex), în luna datei de tăiere.
-- Un element confirmat nu se mai atinge: dacă nu mai corespunde, doar se numără (și verificarea blochează luna).
-- Nota elementului se scrie doar la creare; dovada și suma se țin la zi.
-- Se rulează după fiecare import: select * from public.sincronizeaza_credite();
create or replace function public.sincronizeaza_credite()
 returns table(actualizate integer, confirmate_diferite integer, fara_grafic integer)
 language plpgsql security definer set search_path to 'public'
as $function$
declare
  v_act int := 0; v_dif int := 0; v_fara int := 0;
  r record; v_id int; v_luna date; v_data date; v_desc text; v_dovada text; v_n int; v_rate text; v_scad text;
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
    -- Ratele scadente până la data de tăiere care nu sunt încă în extrase (numerele și scadențele lor).
    select string_agg(g.nr::text, ', ' order by g.nr), string_agg(to_char(g.data_scadenta, 'DD.MM.YYYY'), ', ' order by g.nr)
      into v_rate, v_scad
    from public.credite_grafic g where g.credit_id = r.id and g.nr > r.rate_platite and g.data_scadenta <= v_data;
    v_desc := r.nume || ': ' || public.lei(r.procent_matei) || '% din ce mai era de plătit la ' || to_char(v_data, 'DD.MM.YYYY')
              || ' (capitalul rămas după rata ' || r.rate_platite
              || coalesce(', plătită pe ' || to_char(r.ultima_plata, 'DD.MM.YYYY'), '')
              || ', plus dobânda și comisioanele acumulate până atunci)'
              || case when r.sursa_sold = 'creditor' then ', capitalul conform extrasului creditorului, dobânda conform graficului'
                      else ', conform graficului' end;
    v_dovada := coalesce(r.dovada || ' ', '') || 'Capital rămas după rata ' || r.rate_platite || ': ' || public.lei(r.sold) || ' lei'
              || case when r.sursa_sold = 'creditor'
                      then ' (sold confirmat de creditor la ' || to_char(r.data_sold_creditor, 'DD.MM.YYYY') || coalesce(', ' || r.sursa_sold_creditor, '') || ')'
                      else ' (din grafic)' end
              || case when r.acumulat >= 0
                      then '. Dobânda și comisioanele acumulate de la ' || to_char(r.acumulat_de_la, 'DD.MM.YYYY') || ' până la ' || to_char(v_data, 'DD.MM.YYYY')
                           || ', din grafic: ' || public.lei(r.dobanda_acumulata) || ' + ' || public.lei(r.comision_acumulat)
                           || ' = ' || public.lei(r.acumulat) || ' lei'
                      else '. Dobânda și comisioanele plătite în avans pentru după ' || to_char(v_data, 'DD.MM.YYYY')
                           || ', din grafic: ' || public.lei(-r.acumulat) || ' lei' end
              || case when v_rate is null then ''
                      when r.rate_neimportate = 1 then ' (rata ' || v_rate || ', scadentă ' || v_scad || ', care nu e încă în extrase: toată dobânda și tot comisionul'
                      else ' (ratele ' || v_rate || ', scadente ' || v_scad || ', care nu sunt încă în extrase: toată dobânda și tot comisionul' end
              || case when r.acumulat >= 0 and r.rata_partiala is not null and r.zile_partiale > 0
                      then case when v_rate is not null then '; ' else ' (' end
                           || 'rata ' || r.rata_partiala || ': partea pentru ' || r.zile_partiale || ' din cele ' || r.zile_rata_partiala
                           || case when r.zile_rata_partiala % 100 = 0 or r.zile_rata_partiala % 100 >= 20 then ' de zile)' else ' zile)' end
                      when v_rate is not null then ')'
                      else '' end
              || '. Ce mai era de plătit la ' || to_char(v_data, 'DD.MM.YYYY') || ': ' || public.lei(r.sold)
              || case when r.acumulat >= 0 then ' + ' || public.lei(r.acumulat) else ' − ' || public.lei(-r.acumulat) end
              || ' = ' || public.lei(r.sold_taiere) || ' lei; Matei preia ' || public.lei(r.procent_matei) || '%: ' || public.lei(r.parte_matei_sold) || ' lei'
              || '. Costul creditului până la data de tăiere (rate plătite + ce mai era de plătit − bani primiți): '
              || public.lei(r.platit) || ' + ' || public.lei(r.sold_taiere) || ' − ' || public.lei(r.primit) || ' = ' || public.lei(r.cost)
              || ' lei, din care Matei ' || public.lei(r.cost_matei) || ' lei.';
    if r.element_manual_id is null then
      insert into public.elemente_manuale (luna, data, descriere, suma, moneda, suma_ron, sens, dovada, stare, nota, creat_de)
      values (v_luna, v_data, v_desc, r.parte_matei_sold, 'RON', r.parte_matei_sold, 'matei_datoreaza_alex', v_dovada, 'propus',
              'Regula creditelor (Alex, 02.11.2026): banii primiți 50/50, ratele 50/50, iar la data de tăiere Matei preia '
              || public.lei(r.procent_matei) || '% din ce mai era de plătit: capitalul rămas și dobânda și comisioanele acumulate'
              || ' până atunci (pe zile, din grafic). Creat de sincronizeaza_credite().',
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

-- Mesajele verificării credit_nesincronizat spun și când graficul nu ajunge pentru dobânda acumulată.
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
         case when c.sold is null then 'lipsește rândul ' || c.rate_platite || ' din grafic (sau soldul de la creditor după această rată)'
              when c.grafic_lipsa then 'graficul nu are toate ratele necesare pentru dobânda acumulată (de la ultima rată din extrase până la prima de după data de tăiere)' end,
         case when c.sold_creditor_vechi then 'soldul de la creditor e după rata ' || c.sold_creditor_dupa_rata
                                              || ', dar în extrase sunt ' || c.rate_platite || ' rate: actualizează soldul' end,
         case when c.element_stare = 'confirmat' and c.parte_matei_sold > 0
                   and (c.element_suma_ron is distinct from c.parte_matei_sold
                        or c.element_luna is distinct from date_trunc('month', public.data_taiere())::date)
              then 'elementul manual e confirmat, dar nu mai corespunde: trece-l pe Propus în Sume manuale, apoi Recalculează creditele' end,
         case when coalesce(c.element_stare, '') <> 'confirmat' and c.parte_matei_sold > 0 and c.element_suma_ron is distinct from c.parte_matei_sold
              then 'elementul manual are ' || coalesce(public.lei(c.element_suma_ron), 'nimic') || ' lei, după calculul creditului ar trebui '
                   || public.lei(c.parte_matei_sold) || ' lei: Recalculează creditele' end,
         case when coalesce(c.element_stare, '') <> 'confirmat' and c.parte_matei_sold > 0
                   and c.element_luna is distinct from date_trunc('month', public.data_taiere())::date and c.element_manual_id is not null
              then 'elementul manual e pe ' || to_char(c.element_luna, 'MM.YYYY') || ', trebuie pe luna datei de tăiere: Recalculează creditele' end,
         case when c.parte_matei_sold <= 0 and c.element_manual_id is not null then 'nu mai e nimic de preluat, dar elementul manual a rămas' end,
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


-- Elementele manuale ale creditelor, la zi cu noua regulă.
select * from public.sincronizeaza_credite();
