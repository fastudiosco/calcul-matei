-- Lista proiectelor (clienților) cu încasările lor, ca Alex să stabilească partea lui Matei pe fiecare.
create or replace view public.v_proiecte with (security_invoker = true) as
select c.id, c.nume, c.nota, c.procent_matei, c.activitate, c.tip,
       count(v.id) as incasari,
       count(v.id) filter (where v.stare = 'confirmat') as confirmate,
       count(v.id) filter (where v.suma_ron is null) as fara_ron,
       coalesce(sum(v.suma_ron), 0) as total_ron,
       min(v.data_extras) as prima, max(v.data_extras) as ultima
from public.clienti c
left join public.v_tranzactii v on v.client_id = c.id and v.categorie = 'venit_client'
group by c.id;
grant select on public.v_proiecte to authenticated;
