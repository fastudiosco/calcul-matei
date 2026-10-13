-- Calculul: efectul fiecărei linii asupra sumei "Matei datorează lui Alex".
--   Cont al lui Alex / al firmei: efect = -suma_ron * procent_matei / 100
--     (o plată de 100 împărțită 50/50 => Matei datorează +50; o încasare de 100 cu 50% a lui Matei => -50)
--   Cont al lui Matei: efect = suma_ron * (100 - procent_matei) / 100
--     (Matei plătește 100 pe un cost 50/50 => Alex îi datorează 50, deci efect -50)
-- Liniile excluse nu au efect. Doar liniile confirmate intră în totalul final.

create view public.v_tranzactii with (security_invoker = true) as
select t.id, t.import_id, t.cont_id, co.cod as cont_cod, co.nume as cont_nume, co.banca, co.titular,
       date_trunc('month', t.data_extras)::date as luna,
       t.data_extras, t.data_reala, t.tip, t.descriere, t.suma, t.moneda, t.suma_originala, t.sold_dupa, t.manual,
       c.stare, c.categorie, c.impartire, c.procent_matei, c.contrapartida, c.client_id, c.colaborator_id,
       c.cost_recurent_id, c.pereche_id, c.suma_ron, c.curs, c.sursa_curs, c.nota,
       c.actualizat_de, c.actualizat_la, c.confirmat_de, c.confirmat_la,
       case
         when c.impartire is null or c.impartire = 'exclus' or c.suma_ron is null or c.procent_matei is null then null
         when co.titular = 'matei' then round(c.suma_ron * (100 - c.procent_matei) / 100, 2)
         else round(-c.suma_ron * c.procent_matei / 100, 2)
       end as efect_matei,
       (select count(*) from public.intrebari i where i.tranzactie_id = t.id and i.stare <> 'rezolvata') as intrebari_deschise
from public.tranzactii t
join public.clasificari c on c.tranzactie_id = t.id
join public.conturi co on co.id = t.cont_id;

create view public.v_rezumat_luna with (security_invoker = true) as
with tx as (
  select luna,
         count(*) as linii,
         count(*) filter (where stare = 'neclasificat') as neclasificate,
         count(*) filter (where stare = 'propus') as propuse,
         count(*) filter (where stare = 'intrebare') as cu_intrebari,
         count(*) filter (where stare = 'confirmat') as confirmate,
         coalesce(sum(efect_matei) filter (where stare = 'confirmat'), 0) as efect_confirmat,
         coalesce(sum(efect_matei) filter (where stare = 'propus'), 0) as efect_propus
  from public.v_tranzactii group by luna
), man as (
  select luna,
         coalesce(sum(case sens when 'matei_datoreaza_alex' then suma_ron else -suma_ron end) filter (where stare = 'confirmat'), 0) as manual_confirmat,
         coalesce(sum(case sens when 'matei_datoreaza_alex' then suma_ron else -suma_ron end) filter (where stare <> 'confirmat'), 0) as manual_neconfirmat,
         count(*) filter (where stare = 'confirmat' and suma_ron is null) as manual_fara_ron
  from public.elemente_manuale group by luna
), ramb as (
  -- rambursările legate de o linie din extras sunt deja numărate prin acea linie
  select luna,
         coalesce(sum(suma_ron) filter (where stare = 'confirmat' and tranzactie_id is null), 0) as rambursari_confirmate,
         coalesce(sum(suma_ron) filter (where stare <> 'confirmat' and tranzactie_id is null), 0) as rambursari_neconfirmate
  from public.rambursari group by luna
), intr as (
  select date_trunc('month', coalesce(t.data_extras, e.luna))::date as luna, count(*) as intrebari_deschise
  from public.intrebari i
  left join public.tranzactii t on t.id = i.tranzactie_id
  left join public.elemente_manuale e on e.id = i.element_id
  where i.stare <> 'rezolvata' and coalesce(t.data_extras, e.luna) is not null
  group by 1
), conf as (
  select luna, string_agg(email, ', ' order by email) as confirmata_de
  from public.confirmari_luna where valida group by luna
)
select l.luna, l.status, l.nota,
       coalesce(tx.linii, 0) as linii, coalesce(tx.neclasificate, 0) as neclasificate, coalesce(tx.propuse, 0) as propuse,
       coalesce(tx.cu_intrebari, 0) as cu_intrebari, coalesce(tx.confirmate, 0) as confirmate,
       coalesce(tx.efect_confirmat, 0) as efect_tranzactii,
       coalesce(man.manual_confirmat, 0) as efect_manual,
       coalesce(ramb.rambursari_confirmate, 0) as rambursari,
       coalesce(tx.efect_confirmat, 0) + coalesce(man.manual_confirmat, 0) - coalesce(ramb.rambursari_confirmate, 0) as sold_luna,
       coalesce(tx.efect_propus, 0) + coalesce(man.manual_neconfirmat, 0) - coalesce(ramb.rambursari_neconfirmate, 0) as in_lucru,
       coalesce(intr.intrebari_deschise, 0) as intrebari_deschise,
       coalesce(man.manual_fara_ron, 0) as manual_fara_ron,
       conf.confirmata_de
from public.luni l
left join tx on tx.luna = l.luna
left join man on man.luna = l.luna
left join ramb on ramb.luna = l.luna
left join intr on intr.luna = l.luna
left join conf on conf.luna = l.luna;

-- Verificări de sanitate: fiecare rând este o problemă de rezolvat.
create view public.v_verificari with (security_invoker = true) as
-- 1. Extrasul importat trebuie să se potrivească la total cu liniile din baza de date
select 'extras_nereconciliat'::text as verificare, null::date as luna, null::bigint as tranzactie_id,
       format('Importul %s (%s): intrări %s / ieșiri %s în baza de date, față de %s / %s în extras',
              i.id, i.fisier, s.intrari, s.iesiri, i.total_intrari, i.total_iesiri) as detaliu
from public.importuri i
join lateral (select coalesce(sum(suma) filter (where suma > 0), 0) as intrari,
                     coalesce(-sum(suma) filter (where suma < 0), 0) as iesiri
              from public.tranzactii t where t.import_id = i.id) s on true
where i.total_intrari is not null and (s.intrari <> i.total_intrari or s.iesiri <> i.total_iesiri)
union all
-- 2. Linie confirmată în altă monedă fără echivalent în lei
select 'lipsa_curs', v.luna, v.id, format('%s %s din %s nu are suma în RON', v.suma, v.moneda, v.data_extras)
from public.v_tranzactii v
where v.stare in ('propus','confirmat') and v.impartire is distinct from 'exclus' and v.suma_ron is null
union all
-- 3. Echivalentul în lei are alt semn decât suma
select 'semn_gresit', v.luna, v.id, format('suma %s %s, dar în RON %s', v.suma, v.moneda, v.suma_ron)
from public.v_tranzactii v
where v.suma_ron is not null and sign(v.suma_ron) <> sign(v.suma)
union all
-- 4. Transfer intern fără pereche, sau pereche care nu se anulează
select 'transfer_fara_pereche', v.luna, v.id, format('%s %s, transfer intern fără linia corespondentă', v.suma, v.moneda)
from public.v_tranzactii v
where v.categorie = 'transfer_intern' and v.pereche_id is null
union all
select 'transfer_nu_se_anuleaza', v.luna, v.id, format('%s RON față de %s RON în linia pereche %s', v.suma_ron, p.suma_ron, p.tranzactie_id)
from public.v_tranzactii v join public.clasificari p on p.tranzactie_id = v.pereche_id
where v.categorie = 'transfer_intern' and v.suma_ron is not null and p.suma_ron is not null and v.suma_ron + p.suma_ron <> 0
union all
-- 5. Costuri recurente: exact o plată pe lună
select 'cost_recurent', l.luna, null,
       format('%s, %s plăți legate în luna aceasta (așteptat 1)', r.nume, count(t.id))
from public.costuri_recurente r
join public.luni l on l.luna >= coalesce(r.prima_luna, '2025-11-01') and l.luna <= coalesce(r.ultima_luna, '2026-10-01')
left join public.clasificari c on c.cost_recurent_id = r.id
left join public.tranzactii t on t.id = c.tranzactie_id and date_trunc('month', t.data_extras) = l.luna
group by r.id, r.nume, l.luna
having count(t.id) <> 1
union all
-- 6. Alocarea unui colaborator într-o lună trebuie să însumeze 100%
select 'alocare_incompleta', a.luna, null,
       format('%s, alocat %s%%', co.nume, sum(a.procent))
from public.alocari a join public.colaboratori co on co.id = a.colaborator_id
group by a.luna, co.nume
having sum(a.procent) <> 100
union all
-- 7. Elemente manuale confirmate fără echivalent în lei
select 'manual_fara_ron', e.luna, null, format('Element manual %s, %s %s fără sumă în RON', e.id, e.suma, e.moneda)
from public.elemente_manuale e where e.suma_ron is null
union all
select 'rambursare_fara_ron', r.luna, null, format('Rambursare %s, %s %s fără sumă în RON', r.id, r.suma, r.moneda)
from public.rambursari r where r.suma_ron is null;

grant select on public.v_tranzactii, public.v_rezumat_luna, public.v_verificari to authenticated;
revoke all on public.v_tranzactii, public.v_rezumat_luna, public.v_verificari from anon;
