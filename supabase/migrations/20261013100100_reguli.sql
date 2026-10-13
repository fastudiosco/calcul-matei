create or replace function public.scrie_jurnal() returns trigger
language plpgsql security definer set search_path = public as $fn$
declare
  v_old jsonb := case when tg_op in ('UPDATE','DELETE') then to_jsonb(old) end;
  v_new jsonb := case when tg_op in ('INSERT','UPDATE') then to_jsonb(new) end;
  v_id  text  := coalesce(v_new, v_old) ->> coalesce(tg_argv[0], 'id');
begin
  if tg_op = 'UPDATE' and v_old = v_new then return new; end if;
  insert into public.jurnal (tabel, rand_id, actiune, vechi, nou, email)
  values (tg_table_name, v_id, tg_op, v_old, v_new, nullif(public.email_curent(), ''));
  return coalesce(new, old);
end $fn$;

create trigger jurnal_membri after insert or update or delete on public.membri for each row execute function public.scrie_jurnal('email');
create trigger jurnal_conturi after insert or update or delete on public.conturi for each row execute function public.scrie_jurnal('id');
create trigger jurnal_categorii after insert or update or delete on public.categorii for each row execute function public.scrie_jurnal('cod');
create trigger jurnal_clienti after insert or update or delete on public.clienti for each row execute function public.scrie_jurnal('id');
create trigger jurnal_colaboratori after insert or update or delete on public.colaboratori for each row execute function public.scrie_jurnal('id');
create trigger jurnal_luni after insert or update or delete on public.luni for each row execute function public.scrie_jurnal('luna');
create trigger jurnal_confirmari_luna after insert or update or delete on public.confirmari_luna for each row execute function public.scrie_jurnal('luna');
create trigger jurnal_importuri after insert or update or delete on public.importuri for each row execute function public.scrie_jurnal('id');
create trigger jurnal_tranzactii after insert or update or delete on public.tranzactii for each row execute function public.scrie_jurnal('id');
create trigger jurnal_costuri_recurente after insert or update or delete on public.costuri_recurente for each row execute function public.scrie_jurnal('id');
create trigger jurnal_elemente_manuale after insert or update or delete on public.elemente_manuale for each row execute function public.scrie_jurnal('id');
create trigger jurnal_rambursari after insert or update or delete on public.rambursari for each row execute function public.scrie_jurnal('id');
create trigger jurnal_alocari after insert or update or delete on public.alocari for each row execute function public.scrie_jurnal('id');
create trigger jurnal_intrebari after insert or update or delete on public.intrebari for each row execute function public.scrie_jurnal('id');
create trigger jurnal_clasificari after insert or update or delete on public.clasificari
  for each row execute function public.scrie_jurnal('tranzactie_id');

-- ---------- Reguli de integritate ----------
-- Liniile importate din extrase nu se modifică și nu se șterg.
create or replace function public.protejeaza_tranzactii() returns trigger
language plpgsql as $fn$
begin
  if tg_op = 'DELETE' then
    if not old.manual then raise exception 'Liniile importate din extrase nu se pot șterge (tranzacția %).', old.id; end if;
    return old;
  end if;
  if not old.manual and (new.suma, new.moneda, new.data_extras, new.descriere, new.cont_id, new.import_id)
                       is distinct from (old.suma, old.moneda, old.data_extras, old.descriere, old.cont_id, old.import_id) then
    raise exception 'Suma, data și descrierea unei linii din extras nu se pot modifica (tranzacția %).', old.id;
  end if;
  return new;
end $fn$;
create trigger protejeaza_tranzactii before update or delete on public.tranzactii
  for each row execute function public.protejeaza_tranzactii();

-- Fiecare tranzacție primește automat o clasificare goală; în RON suma_ron = suma.
create or replace function public.creeaza_clasificare() returns trigger
language plpgsql security definer set search_path = public as $fn$
begin
  insert into public.clasificari (tranzactie_id, suma_ron, curs, sursa_curs)
  values (new.id,
          case when new.moneda = 'RON' then new.suma end,
          case when new.moneda = 'RON' then 1 end,
          case when new.moneda = 'RON' then 'RON' end);
  insert into public.luni (luna) values (date_trunc('month', new.data_extras)::date) on conflict do nothing;
  return new;
end $fn$;
create trigger creeaza_clasificare after insert on public.tranzactii
  for each row execute function public.creeaza_clasificare();

create or replace function public.luna_inchisa(p date) returns boolean
language sql stable security definer set search_path = public as $fn$
  select coalesce((select status = 'inchisa' from public.luni where luna = date_trunc('month', p)::date), false)
$fn$;

-- Clasificare: procentul derivat din împărțire, cine și când, blocare în luni închise.
create or replace function public.pregateste_clasificare() returns trigger
language plpgsql security definer set search_path = public as $fn$
declare v_data date;
begin
  select data_extras into v_data from public.tranzactii where id = new.tranzactie_id;
  if tg_op = 'UPDATE' and public.luna_inchisa(v_data) then
    raise exception 'Luna % este închisă. Redeschide-o înainte de modificări.', to_char(v_data, 'YYYY-MM');
  end if;
  new.procent_matei := case new.impartire
    when '50_50' then 50 when 'matei_100' then 100 when 'alex_100' then 0 when 'exclus' then null
    else new.procent_matei end;
  if tg_op = 'UPDATE' then
    new.actualizat_de := nullif(public.email_curent(), '');
    new.actualizat_la := now();
    if new.stare = 'confirmat' and old.stare is distinct from 'confirmat' then
      new.confirmat_de := new.actualizat_de; new.confirmat_la := now();
    elsif new.stare <> 'confirmat' then
      new.confirmat_de := null; new.confirmat_la := null;
    end if;
  end if;
  return new;
end $fn$;
create trigger pregateste_clasificare before insert or update on public.clasificari
  for each row execute function public.pregateste_clasificare();

create or replace function public.blocheaza_luna_inchisa() returns trigger
language plpgsql security definer set search_path = public as $fn$
begin
  if tg_op in ('UPDATE','DELETE') and public.luna_inchisa(old.luna) then
    raise exception 'Luna % este închisă.', to_char(old.luna, 'YYYY-MM');
  end if;
  if tg_op in ('INSERT','UPDATE') and public.luna_inchisa(new.luna) then
    raise exception 'Luna % este închisă.', to_char(new.luna, 'YYYY-MM');
  end if;
  return coalesce(new, old);
end $fn$;
create trigger blocheaza_elemente before insert or update or delete on public.elemente_manuale
  for each row execute function public.blocheaza_luna_inchisa();
create trigger blocheaza_rambursari before insert or update or delete on public.rambursari
  for each row execute function public.blocheaza_luna_inchisa();
create trigger blocheaza_alocari before insert or update or delete on public.alocari
  for each row execute function public.blocheaza_luna_inchisa();

-- ---------- Închiderea lunii ----------
-- O lună se închide când toți membrii au confirmat-o. Redeschiderea invalidează confirmările (nu le șterge).
alter table public.confirmari_luna add column valida boolean not null default true;

create or replace function public.confirma_luna(p_luna date) returns text
language plpgsql security definer set search_path = public as $fn$
declare v_neconf int; v_intreb int; v_total int; v_conf int;
begin
  if not public.este_membru() then raise exception 'Acces interzis.'; end if;
  select count(*) into v_neconf from public.tranzactii t join public.clasificari c on c.tranzactie_id = t.id
   where date_trunc('month', t.data_extras) = p_luna and c.stare <> 'confirmat';
  select count(*) into v_intreb from public.intrebari i
   left join public.tranzactii t on t.id = i.tranzactie_id
   left join public.elemente_manuale e on e.id = i.element_id
   where i.stare <> 'rezolvata' and date_trunc('month', coalesce(t.data_extras, e.luna)) = p_luna;
  if v_neconf > 0 or v_intreb > 0 then
    raise exception 'Luna nu poate fi confirmată: % linii neconfirmate, % întrebări deschise.', v_neconf, v_intreb;
  end if;
  if exists (select 1 from public.elemente_manuale where luna = p_luna and stare <> 'confirmat')
     or exists (select 1 from public.rambursari where luna = p_luna and stare <> 'confirmat')
     or exists (select 1 from public.alocari where luna = p_luna and stare <> 'confirmat') then
    raise exception 'Luna are elemente manuale, rambursări sau alocări neconfirmate.';
  end if;
  insert into public.confirmari_luna (luna, email) values (p_luna, public.email_curent())
  on conflict (luna, email) do update set valida = true, confirmat_la = now();
  select count(*) into v_total from public.membri;
  select count(*) into v_conf from public.confirmari_luna where luna = p_luna and valida;
  if v_conf >= v_total then
    update public.luni set status = 'inchisa' where luna = p_luna;
    return 'inchisa';
  end if;
  return 'confirmata ' || v_conf || '/' || v_total;
end $fn$;

create or replace function public.redeschide_luna(p_luna date, p_motiv text) returns void
language plpgsql security definer set search_path = public as $fn$
begin
  if not public.este_membru() then raise exception 'Acces interzis.'; end if;
  if coalesce(trim(p_motiv), '') = '' then raise exception 'Motivul redeschiderii este obligatoriu.'; end if;
  update public.confirmari_luna set valida = false where luna = p_luna;
  update public.luni
     set status = 'deschisa',
         nota = concat_ws(chr(10), nota, date_trunc('minute', now())::text || ' redeschisa de ' || public.email_curent() || ' - ' || p_motiv)
   where luna = p_luna;
end $fn$;

revoke execute on function public.confirma_luna(date), public.redeschide_luna(date, text) from anon, public;
grant execute on function public.confirma_luna(date), public.redeschide_luna(date, text) to authenticated;
