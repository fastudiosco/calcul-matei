-- Corectură sincronizeaza_comisioane(): o plată cu împărțire „procent” introdusă doar cu procentul cu 2 zecimale
-- (procent_precis gol) dădea comisionului un procent gol și toată actualizarea pica pe constrângerea clasificari_check1
-- (27.10.2026: comisionul 3123 al plății 3124). Acum se ia procentul precis, altfel cel cu 2 zecimale.
create or replace function public.sincronizeaza_comisioane()
 returns table(actualizate integer, in_asteptare integer, fara_plata integer)
 language plpgsql security definer set search_path to 'public'
as $function$
declare v_act int; v_ast int; v_fara int;
begin
  if not public.este_editor() and coalesce(public.email_curent(), '') <> '' then raise exception 'Acces interzis.'; end if;
  with c as (
    select t.id, substring(t.descriere from 'REF: ?(\S+)') as ref
    from tranzactii t join conturi co on co.id=t.cont_id join clasificari k on k.tranzactie_id=t.id
    where co.cod like 'BT%' and k.categorie='comision' and t.suma<0 and k.stare<>'confirmat'
  ), p as (
    select substring(t.descriere from 'REF: ?(\S+)') as ref, k.impartire, coalesce(k.procent_precis, k.procent_matei) as procent_precis, k.stare, k.categorie, t.id as plata_id
    from tranzactii t join conturi co on co.id=t.cont_id join clasificari k on k.tranzactie_id=t.id
    where co.cod like 'BT%' and k.categorie is distinct from 'comision' and t.suma<0
  ), legate as (
    select c.id, p.plata_id, p.impartire, p.procent_precis, p.categorie from c join p on p.ref=c.ref
  ), u as (
    update clasificari k set
      impartire = l.impartire, procent_precis = case when l.impartire='procent' then l.procent_precis else null end,
      stare = case when l.impartire is null then 'neclasificat' else 'propus' end,
      pereche_id = null,
      nota = 'Comision pentru plata #' || l.plata_id || ' (' || coalesce(l.categorie,'?') || '). Regulă Alex 14.10.2026: urmează împărțirea plății' || case when l.impartire is null then ' — plata nu are încă o cotă, așteaptă.' else ' (' || l.impartire || coalesce(' ' || round(l.procent_precis,2) || '%','') || ').' end
    from legate l where k.tranzactie_id = l.id returning (l.impartire is not null) as ok
  )
  select count(*) filter (where ok), count(*) filter (where not ok) into v_act, v_ast from u;
  select count(*) into v_fara from (
    select t.id from tranzactii t join conturi co on co.id=t.cont_id join clasificari k on k.tranzactie_id=t.id
    where co.cod like 'BT%' and k.categorie='comision' and t.suma<0 and k.stare<>'confirmat'
      and substring(t.descriere from 'REF: ?(\S+)') not in (
        select substring(t2.descriere from 'REF: ?(\S+)') from tranzactii t2 join conturi co2 on co2.id=t2.cont_id join clasificari k2 on k2.tranzactie_id=t2.id
        where co2.cod like 'BT%' and k2.categorie is distinct from 'comision' and t2.suma<0 and t2.descriere ~ 'REF: ?\S+')
  ) x;
  return query select v_act, v_ast, v_fara;
end $function$;
revoke execute on function public.sincronizeaza_comisioane() from anon, public;
grant execute on function public.sincronizeaza_comisioane() to authenticated;
