-- Facturi e-Factura (UBL), încărcate din arhivele SPV în pagina „Facturi”.
-- Din august 2026 calculul se face fără TVA: TVA-ul unei încasări / plăți se ia din factura ei,
-- proporțional cu suma plătită (o plată parțială poartă partea ei de TVA).

create table public.facturi (
  id          bigserial primary key,
  directie    text not null check (directie in ('emisa','primita')),
  numar       text not null,
  data        date not null,
  scadenta    date,
  emitent     text,
  emitent_cui text not null default '',
  client      text,
  client_cui  text,
  moneda      char(3) not null default 'RON',
  net         numeric(14,2) not null,
  tva         numeric(14,2) not null default 0,
  total       numeric(14,2) not null,
  linii       jsonb not null default '[]',
  fisier      text,
  creat_la    timestamptz not null default now(),
  creat_de    text default nullif(public.email_curent(), ''),
  unique (directie, emitent_cui, numar)
);

-- Ce factură a dat TVA-ul unei linii (o linie = o factură; o factură poate avea mai multe plăți).
create table public.factura_plati (
  tranzactie_id bigint primary key references public.tranzactii(id),
  factura_id    bigint not null references public.facturi(id),
  tva_ron       numeric(14,2) not null,
  metoda        text not null,
  aplicat_la    timestamptz not null default now(),
  aplicat_de    text default nullif(public.email_curent(), '')
);

alter table public.facturi enable row level security;
alter table public.factura_plati enable row level security;
revoke all on public.facturi, public.factura_plati from anon;
grant select on public.facturi, public.factura_plati to authenticated;
create policy membri_citesc on public.facturi for select to authenticated using (public.este_membru());
create policy membri_citesc on public.factura_plati for select to authenticated using (public.este_membru());
-- Scrierile trec doar prin funcțiile de mai jos.

create trigger jurnal_factura_plati after insert or update or delete on public.factura_plati
  for each row execute function public.scrie_jurnal('tranzactie_id');

-- Text fără diacritice, spații și semne: „VIS 0007”, „AS-14-26/SOLO”, „ŞFARŢ” → VIS0007, AS1426SOLO, SFART.
create or replace function public.norm_doc(x text) returns text
language sql immutable as $$
  select upper(regexp_replace(translate(coalesce(x, ''), 'ĂÂÎȘŞȚŢăâîșşțţ', 'AAISSTTaaisstt'), '[^A-Za-z0-9]', '', 'g'))
$$;

-- p = [{directie, numar, data, scadenta, emitent, emitent_cui, client, client_cui, moneda, net, tva, total, linii, fisier}]
create or replace function public.importa_facturi(p jsonb)
 returns table(noi integer, actualizate integer)
 language plpgsql security definer set search_path to 'public'
as $function$
declare v_noi int; v_act int;
begin
  if not public.este_editor() then raise exception 'Acces interzis.'; end if;
  with x as (
    insert into public.facturi as f (directie, numar, data, scadenta, emitent, emitent_cui, client, client_cui, moneda, net, tva, total, linii, fisier)
    select e->>'directie', e->>'numar', (e->>'data')::date, nullif(e->>'scadenta', '')::date, e->>'emitent', coalesce(e->>'emitent_cui', ''),
           e->>'client', e->>'client_cui', coalesce(nullif(e->>'moneda', ''), 'RON'), (e->>'net')::numeric, coalesce((e->>'tva')::numeric, 0),
           (e->>'total')::numeric, coalesce(e->'linii', '[]'::jsonb), e->>'fisier'
    from jsonb_array_elements(p) e
    on conflict (directie, emitent_cui, numar) do update set
      data = excluded.data, scadenta = excluded.scadenta, emitent = excluded.emitent, client = excluded.client,
      client_cui = excluded.client_cui, moneda = excluded.moneda, net = excluded.net, tva = excluded.tva,
      total = excluded.total, linii = excluded.linii, fisier = excluded.fisier
    returning (xmax = 0) as nou
  )
  select count(*) filter (where nou), count(*) filter (where not nou) into v_noi, v_act from x;
  return query select v_noi, v_act;
end $function$;

-- Propuneri: fiecare încasare de la client / plată la colaborator din aug 2026, cu factura ei.
-- 1) după numărul facturii scris în descrierea plății;
-- 2) altfel după sumă, doar când: factura nu e deja a altei plăți (după număr sau aplicată), numele partenerului
--    apare în descrierea plății, e singura factură potrivită pentru plată și plata e singura pentru factură.
create or replace view public.v_tva_propuneri with (security_invoker = on) as
with linii as (
  select v.id, v.data_extras, v.luna, v.categorie, v.stare, v.suma_ron, v.tva_ron, v.descriere, v.contrapartida,
         public.norm_doc(coalesce(v.descriere, '') || ' ' || coalesce(v.contrapartida, '')) as nd,
         case when v.suma_ron > 0 then 'emisa' else 'primita' end as directie
  from public.v_tranzactii v
  where v.data_extras >= '2026-08-01' and v.titular = 'firma' and v.categorie in ('venit_client','colaborator')
    and v.suma_ron is not null
), dupa_numar as (
  select distinct on (l.id) l.id, f.id as factura_id, 'numărul facturii în descriere'::text as metoda
  from linii l join public.facturi f on f.directie = l.directie
   and length(public.norm_doc(f.numar)) >= 4 and position(public.norm_doc(f.numar) in l.nd) > 0
  order by l.id, length(public.norm_doc(f.numar)) desc, abs(f.total - abs(l.suma_ron))
), candidati as (
  select l.id, f.id as factura_id
  from linii l join public.facturi f on f.directie = l.directie
   and abs(f.total - abs(l.suma_ron)) <= 0.01 and f.data between l.data_extras - 90 and l.data_extras + 3
  where not exists (select 1 from dupa_numar n where n.id = l.id)
    and not exists (select 1 from dupa_numar n where n.factura_id = f.id)
    and not exists (select 1 from public.factura_plati p where p.factura_id = f.id and p.tranzactie_id <> l.id)
    -- factura e numită în descrierea altei linii din extrase (inclusiv plăți dinainte de august)
    and not (length(public.norm_doc(f.numar)) >= 4 and exists (
          select 1 from public.tranzactii t where t.id <> l.id and position(public.norm_doc(f.numar) in public.norm_doc(t.descriere)) > 0))
    -- un cuvânt din numele partenerului (fără cele generice) apare în descrierea plății
    and exists (
          select 1 from regexp_split_to_table(case when f.directie = 'emisa' then f.client else f.emitent end, '[^[:alnum:]ĂÂÎȘŞȚŢăâîșşțţ]+') w
          where length(public.norm_doc(w)) >= 4
            and public.norm_doc(w) not in ('PERSOANA','FIZICA','AUTORIZATA','INTREPRINDERE','INDIVIDUALA','FAMILIALA','SOCIETATE',
              'COMPANY','ROMANIA','IMPEX','GROUP','GRUP','STUDIO','STUDIOS','SERVICE','SERVICES','SOLUTIONS','CONSULTING','MEDIA',
              'EVENTS','ENTERTAINMENT','INTERNATIONAL','DISTRIBUTION','BUCURESTI','LIMITED','MARKETING','PRODUCTION','DIGITAL')
            and position(public.norm_doc(w) in l.nd) > 0)
), dupa_suma as (
  select c.id, c.factura_id, 'aceeași sumă și partener, singura factură potrivită'::text as metoda
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
       case when f.id is null then null when f.total = 0 then 0 else round(l.suma_ron * f.tva / f.total, 2) end as tva_calculat,
       coalesce(fp.metoda, a.metoda) as metoda,
       fp.factura_id is not null as aplicat,
       case when f.id is null then 'fara_factura'
            when l.tva_ron is null then 'nou'
            when l.tva_ron = case when f.total = 0 then 0 else round(l.suma_ron * f.tva / f.total, 2) end then 'la_fel'
            else 'diferit' end as situatie
from linii l
left join public.factura_plati fp on fp.tranzactie_id = l.id
left join alese a on a.id = l.id
left join public.facturi f on f.id = coalesce(fp.factura_id, a.factura_id);

-- Aplică TVA-ul din factură pe liniile alese. O linie confirmată al cărei TVA efectiv (gol = 0) se schimbă
-- redevine „propus”: suma din calcul se schimbă, deci se confirmă din nou. Gol → 0 rămâne confirmată.
create or replace function public.aplica_tva(p_ids bigint[])
 returns integer language plpgsql security definer set search_path to 'public'
as $function$
declare n int;
begin
  if not public.este_editor() then raise exception 'Acces interzis.'; end if;
  with x as (
    select tranzactie_id, factura_id, tva_calculat, metoda from public.v_tva_propuneri
     where tranzactie_id = any(p_ids) and factura_id is not null
  ), legate as (
    insert into public.factura_plati (tranzactie_id, factura_id, tva_ron, metoda)
    select tranzactie_id, factura_id, tva_calculat, metoda from x
    on conflict (tranzactie_id) do update set factura_id = excluded.factura_id, tva_ron = excluded.tva_ron,
      metoda = excluded.metoda, aplicat_la = now(), aplicat_de = nullif(public.email_curent(), '')
    returning 1
  ), schimbate as (
    update public.clasificari c set
      tva_ron = x.tva_calculat,
      stare = case when c.stare = 'confirmat' and coalesce(c.tva_ron, 0) <> x.tva_calculat then 'propus' else c.stare end
    from x where c.tranzactie_id = x.tranzactie_id and c.tva_ron is distinct from x.tva_calculat
    returning 1
  )
  select count(*) into n from schimbate;
  return n;
end $function$;

revoke execute on function public.importa_facturi(jsonb), public.aplica_tva(bigint[]) from anon, public;
grant execute on function public.importa_facturi(jsonb), public.aplica_tva(bigint[]) to authenticated;
grant select on public.v_tva_propuneri to authenticated;
