-- TVA și pe costuri (facturi de la furnizori din SPV / FGO), nu doar pe încasări și colaboratori.
-- FA Studios e plătitor de TVA, cu TVA la încasare, din 20.08.2026 (registrul ANAF). TVA-ul unei facturi de la furnizor
-- se deduce doar dacă factura e din 20.08.2026 încolo; înainte, TVA-ul face parte din cost, deci în calcul TVA = 0
-- (data facturii e o aproximare: serviciile consumate înainte de înregistrare nu dau drept de deducere, art. 297 + pct. 83(11) din norme).
-- Mașina (leasing, combustibil): art. 298 limitează deducerea la 50% dacă mașina nu e folosită exclusiv pentru firmă.

create or replace function public.data_inregistrare_tva() returns date
language sql immutable as $$ select date '2026-08-20' $$;

-- Cât din TVA-ul pe mașină (leasing RCI, combustibil) se deduce. Se schimbă doar dacă contabila confirmă altceva în D300.
create or replace function public.cota_deducere_tva_auto() returns numeric
language sql immutable as $$ select 0.5 $$;

-- Coloanele noi (tip, impartire, tva_nedeductibil, tva_auto_50, inchisa) sunt la final, ca să rămână compatibil cu vederea veche.
-- Costurile apar doar când au o factură găsită: plățile fără factură (software din afara țării, comisioane) nu au TVA de dedus.
create or replace view public.v_tva_propuneri with (security_invoker = on) as
with linii as (
  select v.id, v.data_extras, v.luna, v.categorie, v.stare, v.impartire, v.suma_ron, v.tva_ron, v.descriere, v.contrapartida,
         public.norm_doc(coalesce(v.descriere, '') || ' ' || coalesce(v.contrapartida, '')) as nd,
         case when v.suma_ron > 0 then 'emisa' else 'primita' end as directie,
         case v.categorie when 'venit_client' then 'incasare' when 'colaborator' then 'colaborator' else 'cost' end as tip,
         public.luna_inchisa(v.data_extras) as inchisa
  from public.v_tranzactii v
  where v.data_extras >= '2026-08-01' and v.titular = 'firma' and v.suma_ron is not null
    and (v.categorie in ('venit_client', 'colaborator')
         or (v.suma_ron < 0 and coalesce(v.categorie, '') not in ('transfer_intern', 'transfer_alex', 'taxe', 'credit', 'plata_matei',
             'plata_antonia', 'rambursare_matei', 'schimb_valutar', 'personal_alex', 'cheltuieli_personale')))
), dupa_numar as (
  select distinct on (l.id) l.id, f.id as factura_id, 'numărul facturii în descriere'::text as metoda
  from linii l join public.facturi f on f.directie = l.directie
  -- numărul întreg sau, la numerele cu „/”, partea dinainte („Plata Partiala Factura AS-14-26” = AS-14-26/SOLO)
  cross join lateral (select public.norm_doc(f.numar) as nr,
                             case when f.numar like '%/%' then public.norm_doc(split_part(f.numar, '/', 1)) end as baza) k
  where ((length(k.nr) >= 4 and position(k.nr in l.nd) > 0)
         or (length(k.baza) >= 6 and k.baza ~ '[A-Z]' and k.baza ~ '[0-9]' and position(k.baza in l.nd) > 0))
    -- la costuri numerele scurte apar și în codurile tranzacțiilor: plata nu trece de factură și vine după ea
    and (l.tip <> 'cost' or (abs(l.suma_ron) <= abs(f.total) + 0.01 and f.data between l.data_extras - 120 and l.data_extras + 3))
  order by l.id, (length(k.nr) >= 4 and position(k.nr in l.nd) > 0) desc, length(k.nr) desc, abs(f.total - abs(l.suma_ron))
-- Ce facturi sunt numite în descrierea cărei linii din extrase (inclusiv plăți dinainte de august), calculat o singură dată:
-- verificarea pe fiecare pereche candidată ar normaliza toate descrierile de fiecare dată.
), td as materialized (
  select id, public.norm_doc(descriere) as d from public.tranzactii
), fn as materialized (
  select id, public.norm_doc(numar) as nr from public.facturi where length(public.norm_doc(numar)) >= 4
), numite as materialized (
  select fn.id as factura_id, td.id as tranzactie_id from fn join td on position(fn.nr in td.d) > 0
), candidati as (
  select l.id, f.id as factura_id, p.partener
  from linii l join public.facturi f on f.directie = l.directie
   and abs(f.total - abs(l.suma_ron)) <= 0.01 and f.data between l.data_extras - 90 and l.data_extras + 3
  -- un cuvânt din numele partenerului (fără cele generice) apare în descrierea plății
  cross join lateral (select exists (
          select 1 from regexp_split_to_table(case when f.directie = 'emisa' then f.client else f.emitent end, '[^[:alnum:]ĂÂÎȘŞȚŢăâîșşțţ]+') w
          where length(public.norm_doc(w)) >= 4
            and public.norm_doc(w) not in ('PERSOANA','FIZICA','AUTORIZATA','INTREPRINDERE','INDIVIDUALA','FAMILIALA','SOCIETATE',
              'COMPANY','ROMANIA','IMPEX','GROUP','GRUP','STUDIO','STUDIOS','SERVICE','SERVICES','SOLUTIONS','CONSULTING','MEDIA',
              'EVENTS','ENTERTAINMENT','INTERNATIONAL','DISTRIBUTION','BUCURESTI','LIMITED','MARKETING','PRODUCTION','DIGITAL')
            and position(public.norm_doc(w) in l.nd) > 0) as partener) p
  where not exists (select 1 from dupa_numar n where n.id = l.id)
    and not exists (select 1 from dupa_numar n where n.factura_id = f.id)
    and not exists (select 1 from public.factura_plati fp where fp.factura_id = f.id and fp.tranzactie_id <> l.id)
    -- factura e numită în descrierea altei linii din extrase
    and not exists (select 1 from numite x where x.factura_id = f.id and x.tranzactie_id <> l.id)
    -- plățile cu cardul poartă alt nume decât firma de pe bon (OMV Petrom, FGO = I-TOM, Uber = Welead):
    -- la costuri ajunge aceeași sumă la cel mult 5 zile după bon
    and (p.partener or (l.tip = 'cost' and f.data between l.data_extras - 5 and l.data_extras + 1))
), dupa_suma as (
  select c.id, c.factura_id,
         case when c.partener then 'aceeași sumă și partener, singura factură potrivită'
              else 'aceeași sumă, bon din aceeași zi (±5 zile), singura factură potrivită' end::text as metoda
  from candidati c
  where (select count(*) from candidati c2 where c2.id = c.id) = 1
    and (select count(*) from candidati c3 where c3.factura_id = c.factura_id) = 1
), alese as (
  select * from dupa_numar union all select * from dupa_suma
)
select l.id as tranzactie_id, l.data_extras, l.luna, l.categorie, l.stare, l.contrapartida, l.descriere, l.suma_ron,
       l.tva_ron as tva_actual,
       f.id as factura_id, f.numar, f.data as data_factura, case when f.directie = 'emisa' then f.client else f.emitent end as partener,
       f.total, f.tva as tva_factura,
       t.tva_calculat,
       coalesce(fp.metoda, a.metoda, case when t.drepturi then 'drepturi de autor: fără TVA' end) as metoda,
       fp.factura_id is not null as aplicat,
       case when t.tva_calculat is null then 'fara_factura'
            -- la costuri gol = 0 în calcul, deci nu e nimic de aplicat
            when l.tip = 'cost' and coalesce(l.tva_ron, 0) = t.tva_calculat then 'la_fel'
            when l.tva_ron is null then 'nou'
            when l.tva_ron = t.tva_calculat then 'la_fel'
            else 'diferit' end as situatie,
       l.tip, l.impartire,
       coalesce(f.directie = 'primita' and f.data < public.data_inregistrare_tva() and f.tva <> 0, false) as tva_nedeductibil,
       coalesce(t.auto and f.tva <> 0 and f.data >= public.data_inregistrare_tva(), false) as tva_auto_50,
       l.inchisa
from linii l
left join public.factura_plati fp on fp.tranzactie_id = l.id
left join alese a on a.id = l.id
left join public.facturi f on f.id = coalesce(fp.factura_id, a.factura_id)
cross join lateral (select l.categorie in ('masina_matei', 'combustibil') as auto,
                           -- drepturile de autor plătite persoanelor fizice nu au TVA (nu au nici factură)
                           f.id is null and l.tip = 'colaborator' and l.nd like '%DREPTURI%AUTOR%' as drepturi) z
cross join lateral (select z.drepturi,
                           z.auto,
                           case when f.id is null then case when z.drepturi then 0::numeric end
                                when f.total = 0 then 0
                                when f.directie = 'primita' and f.data < public.data_inregistrare_tva() then 0
                                when z.auto then round(l.suma_ron * f.tva / f.total * public.cota_deducere_tva_auto(), 2)
                                else round(l.suma_ron * f.tva / f.total, 2) end as tva_calculat) t
where l.tip <> 'cost' or f.id is not null;

-- O linie confirmată al cărei TVA efectiv (gol = 0) se schimbă redevine „propus”: suma din calcul se schimbă.
-- Excepție: liniile 100% Alex sau excluse, unde partea lui Matei rămâne 0 orice TVA ar avea.
-- Liniile care rămân confirmate își păstrează confirmarea (cine și când): triggerul ar trece-o pe cel care apasă „Aplică”.
-- Liniile din luni închise se sar (altfel triggerul ar opri tot lotul).
create or replace function public.aplica_tva(p_ids bigint[])
 returns integer language plpgsql security definer set search_path to 'public'
as $function$
declare n int; v_conf jsonb;
begin
  if not public.este_editor() then raise exception 'Acces interzis.'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('id', tranzactie_id, 'de', confirmat_de, 'la', confirmat_la)), '[]')
    into v_conf from public.clasificari where tranzactie_id = any(p_ids) and stare = 'confirmat';
  with x as (
    select tranzactie_id, factura_id, tva_calculat, metoda from public.v_tva_propuneri
     where tranzactie_id = any(p_ids) and tva_calculat is not null and not inchisa
  ), legate as (
    insert into public.factura_plati (tranzactie_id, factura_id, tva_ron, metoda)
    select tranzactie_id, factura_id, tva_calculat, metoda from x where factura_id is not null
    on conflict (tranzactie_id) do update set factura_id = excluded.factura_id, tva_ron = excluded.tva_ron,
      metoda = excluded.metoda, aplicat_la = now(), aplicat_de = nullif(public.email_curent(), '')
    returning 1
  ), schimbate as (
    update public.clasificari c set
      tva_ron = x.tva_calculat,
      stare = case when c.stare = 'confirmat' and coalesce(c.tva_ron, 0) <> x.tva_calculat
                    and coalesce(c.impartire, '') not in ('alex_100', 'exclus') then 'propus' else c.stare end
    from x where c.tranzactie_id = x.tranzactie_id and c.tva_ron is distinct from x.tva_calculat
    returning 1
  )
  select count(*) into n from schimbate;
  update public.clasificari c set confirmat_de = p.de, confirmat_la = p.la
    from jsonb_to_recordset(v_conf) as p(id bigint, de text, la timestamptz)
   where c.tranzactie_id = p.id and c.stare = 'confirmat'
     and (c.confirmat_de, c.confirmat_la) is distinct from (p.de, p.la);
  return n;
end $function$;

-- „Ce lipsește”: TVA din facturi încă neaplicat pe linii unde contează pentru Matei, pe luni
-- (încasările și colaboratorii fără TVA apar deja la verificarea tva_lipsa).
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
  'rambursare_fara_ron', 'rambursare_legata', 'tva_lipsa', 'ron_diferit_de_curs')
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
