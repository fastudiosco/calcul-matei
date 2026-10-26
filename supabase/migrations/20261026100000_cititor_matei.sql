-- Matei primește cont de „cititor”: vede tot și poate pune / răspunde la întrebări,
-- dar nu clasifică, nu confirmă, nu importă și nu închide luni.
-- O lună se închide tot când o confirmă Alex și Robert (membrii care pot edita).

alter table public.membri drop constraint if exists membri_rol_check;
alter table public.membri add constraint membri_rol_check check (rol in ('admin','editor','cititor'));

create or replace function public.este_editor() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.membri m where lower(m.email) = public.email_curent() and m.rol in ('admin','editor'))
$$;
revoke execute on function public.este_editor() from anon, public;
grant execute on function public.este_editor() to authenticated;

-- Scrierile directe în tabele: doar cine poate edita. Întrebările rămân deschise tuturor membrilor.
do $do$
declare t text;
begin
  foreach t in array array['clienti','colaboratori','tranzactii','costuri_recurente','clasificari','elemente_manuale',
                           'rambursari','alocari','categorii'] loop
    execute format('drop policy if exists membri_adauga on public.%I', t);
    execute format('drop policy if exists membri_modifica on public.%I', t);
    execute format('drop policy if exists membri_sterg on public.%I', t);
    execute format('create policy membri_adauga on public.%I for insert to authenticated with check (public.este_editor())', t);
    execute format('create policy membri_modifica on public.%I for update to authenticated using (public.este_editor()) with check (public.este_editor())', t);
    execute format('create policy membri_sterg on public.%I for delete to authenticated using (public.este_editor())', t);
  end loop;
end $do$;
drop policy if exists membri_sterg on public.intrebari;
create policy membri_sterg on public.intrebari for delete to authenticated using (public.este_editor());
drop policy if exists membri_adauga on public.whatsapp;
create policy membri_adauga on public.whatsapp for insert to authenticated with check (public.este_editor());

-- O întrebare pusă de Matei trebuie să poată muta linia în „Cu întrebări”, deși el nu poate edita clasificarea.
alter function public.stare_linie_dupa_intrebari() security definer;

-- Funcțiile care schimbă calculul: doar cine poate edita.
create or replace function public.clasifica_in_masa(p_ids bigint[], p jsonb)
 returns integer language plpgsql set search_path to 'public'
as $function$
declare n int;
begin
  if not public.este_editor() then raise exception 'Acces interzis.'; end if;
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
end $function$;

create or replace function public.confirma_luna(p_luna date)
 returns text language plpgsql security definer set search_path to 'public'
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
     'rambursare_fara_ron', 'rambursare_legata', 'tva_lipsa', 'ron_diferit_de_curs');
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

create or replace function public.redeschide_luna(p_luna date, p_motiv text)
 returns void language plpgsql security definer set search_path to 'public'
as $function$
begin
  if not public.este_editor() then raise exception 'Acces interzis.'; end if;
  if coalesce(trim(p_motiv), '') = '' then raise exception 'Motivul redeschiderii este obligatoriu.'; end if;
  update public.confirmari_luna set valida = false where luna = p_luna;
  update public.luni
     set status = 'deschisa',
         nota = concat_ws(chr(10), nota, date_trunc('minute', now())::text || ' redeschisa de ' || public.email_curent() || ' - ' || p_motiv)
   where luna = p_luna;
end $function$;

-- importa_extras: aceeași funcție, doar verificarea de acces e pentru editori.
do $do$
declare d text;
begin
  d := pg_get_functiondef('public.importa_extras(jsonb)'::regprocedure);
  d := replace(d, 'if not public.este_membru() then', 'if not public.este_editor() then');
  execute d;
end $do$;
