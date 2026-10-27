-- „Ce lipsește”: tot ce mai trebuie ca suma finală să fie completă, într-o singură listă.
-- ordine = în ce ordine se rezolvă; pagina + filtru = unde se rezolvă în aplicație.
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

grant select on public.v_lipsuri to authenticated;
