-- Conversația WhatsApp cu Matei, ca sursă de context pentru clasificare (doar citire în calcul).
create table public.whatsapp (
  id     bigint generated always as identity primary key,
  la     timestamp not null,          -- ora locală din export, fără fus orar
  autor  text not null,
  text   text not null,
  hash   text generated always as (md5(text)) stored,
  unique (la, autor, hash)
);
create index whatsapp_la on public.whatsapp (la);
alter table public.whatsapp enable row level security;
revoke all on public.whatsapp from anon;
create policy membri_citesc on public.whatsapp for select to authenticated using (public.este_membru());
create policy membri_adauga on public.whatsapp for insert to authenticated with check (public.este_membru());

-- Verificarea costurilor recurente doar pentru definițiile confirmate de Alex.
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
       format('%s, %s plăți legate în luna aceasta (așteptat 1)', r.nume, count(t.id))
from public.costuri_recurente r
join public.luni l on l.luna >= coalesce(r.prima_luna, '2025-11-01') and l.luna <= coalesce(r.ultima_luna, '2026-10-01')
left join public.clasificari c on c.cost_recurent_id = r.id
left join public.tranzactii t on t.id = c.tranzactie_id and date_trunc('month', t.data_extras) = l.luna
where r.confirmat
group by r.id, r.nume, l.luna
having count(t.id) <> 1
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
from public.rambursari r where r.suma_ron is null;
