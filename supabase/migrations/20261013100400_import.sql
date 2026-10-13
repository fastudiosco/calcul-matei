-- Importul unui extras: tot sau nimic, cu reconcilierea totalurilor făcută în baza de date.
create unique index importuri_unic on public.importuri (cont_id, sha256, perioada_de, perioada_pana);

create or replace function public.importa_extras(p jsonb) returns int
language plpgsql security definer set search_path = public as $fn$
declare
  v_cont public.conturi;
  v_import int;
  v_in numeric(14,2);
  v_out numeric(14,2);
  v_n int;
  v_bad int;
begin
  if not public.este_membru() then raise exception 'Acces interzis.'; end if;
  select * into v_cont from public.conturi where cod = p->>'cont_cod';
  if v_cont.id is null then raise exception 'Cont necunoscut %', p->>'cont_cod'; end if;

  if exists (select 1 from public.importuri where cont_id = v_cont.id and sha256 = p->>'sha256'
             and perioada_de = (p->>'perioada_de')::date and perioada_pana = (p->>'perioada_pana')::date) then
    return null;  -- deja importat
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
  -- dacă extrasul are sold după fiecare linie, lanțul trebuie să fie continuu
  select count(*) into v_bad from (
    select (l->>'sold_dupa')::numeric as sold, (l->>'suma')::numeric as suma,
           lag((l->>'sold_dupa')::numeric) over (order by (l->>'nr')::int) as anterior,
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

revoke execute on function public.importa_extras(jsonb) from anon, public;
grant execute on function public.importa_extras(jsonb) to authenticated;
