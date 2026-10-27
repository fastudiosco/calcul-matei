-- Regula Alex (27.10.2026): „Split the cod special VAT per purchase: each foreign purchase's 21% VAT follows that purchase's own split.”
-- Înainte de 20.08.2026 firma nu era plătitoare de TVA, dar avea cod special (art. 317): pentru serviciile cumpărate din străinătate
-- datora TVA prin taxare inversă (art. 307 alin. 2), declarat lunar în D301 și plătit separat, nedeductibil — un cost în plus de 21%
-- pe fiecare achiziție. Plata D301 a unei luni primește deci procentul lui Matei din achizițiile din străinătate ale acelei luni,
-- ponderat cu suma lor (diferențele de curs/rotunjire dintre 21% × bază și plata reală se împart la fel).
-- Se rulează după fiecare lot de clasificări: select * from public.sincronizeaza_cod_special();
create or replace function public.sincronizeaza_cod_special()
 returns table(actualizate integer, in_asteptare integer, confirmate_diferite integer)
 language plpgsql security definer set search_path to 'public'
as $function$
declare v_act int; v_ast int; v_dif int;
begin
  if not public.este_editor() and coalesce(public.email_curent(), '') <> '' then raise exception 'Acces interzis.'; end if;
  with plati as (
    -- plățile D301 în contul de TVA (…A100101XTVA); luna din descriere („cod special Martie 20…”), anul din data plății
    select t.id, k.stare, k.impartire, k.procent_precis, m.nr,
           make_date(extract(year from t.data_extras)::int - case when m.nr > extract(month from t.data_extras) then 1 else 0 end, m.nr, 1) as luna
    from tranzactii t join clasificari k on k.tranzactie_id = t.id
    cross join lateral (select x.nr from (values ('IANUARIE', 1), ('FEBRUARIE', 2), ('MARTIE', 3), ('APRILIE', 4), ('MAI', 5), ('IUNIE', 6),
                          ('IULIE', 7), ('AUGUST', 8), ('SEPTEMBRIE', 9), ('OCTOMBRIE', 10), ('NOIEMBRIE', 11), ('DECEMBRIE', 12)) x(nume, nr)
                        where upper(t.descriere) ~ ('COD SPECIAL ' || x.nume) limit 1) m
    where t.descriere ~* 'cod special' and t.descriere ~ 'A100101XTVA' and t.suma < 0
  ), achizitii as (
    -- serviciile cumpărate cu cardul de la furnizori din afara țării, până la 19.08.2026
    select date_trunc('month', coalesce(v.data_reala, v.data_extras))::date as luna, v.suma_ron, v.impartire,
           case when v.impartire = 'exclus' then 0 else coalesce(v.procent_precis, v.procent_matei, 0) end as procent
    from v_tranzactii v
    where v.titular = 'firma' and v.suma_ron is not null
      and coalesce(v.data_reala, v.data_extras) >= '2025-11-01' and coalesce(v.data_reala, v.data_extras) < public.data_inregistrare_tva()
      and coalesce(v.categorie, '') not in ('transfer_alex', 'venit_client', 'transfer_intern', 'colaborator', 'plata_matei',
                                             'rambursare_matei', 'schimb_valutar', 'taxe')
      and coalesce(v.contrapartida, '') || ' ' || v.descriere ~* ('(facebk|facebook|tiktok|google[ |]*\*ads|google[ |]*\*cloud|webflow|adobe|openai|chatgpt'
          || '|anthropic|leonardo|envato|capcut|lovable|submagic|notion|asana|typeform|sendinblue|brevo|kling|freepik)')
  ), pe_luna as (
    select luna, count(*) as linii, -sum(suma_ron) as baza, count(*) filter (where impartire is null) as fara_impartire,
           -sum(suma_ron * procent / 100) filter (where impartire is not null) as baza_matei
    from achizitii group by luna
  ), calcul as (
    select p.id, p.stare, p.impartire, p.procent_precis, p.luna, l.linii, l.baza, l.fara_impartire, l.baza_matei,
           case when l.fara_impartire = 0 and l.baza > 0 then round(100 * l.baza_matei / l.baza, 6) end as procent
    from plati p join pe_luna l on l.luna = p.luna
  ), u as (
    update clasificari k set
      categorie = 'taxe',
      impartire = case when c.procent is null then null else 'procent' end,
      procent_precis = c.procent,
      stare = case when c.procent is null then 'neclasificat' else 'propus' end,
      nota = 'TVA cod special ' || to_char(c.luna, 'MM.YYYY') || ' (D301), pe achiziție — Alex, 27.10.2026: „each foreign purchase''s 21% VAT follows that purchase''s own split”. '
             || 'Achiziții din străinătate în luna respectivă: ' || c.linii || ' linii, bază ' || to_char(c.baza, 'FM999G990D00') || ' lei'
             || case when c.procent is null
                     then ', din care ' || c.fara_impartire || ' fără împărțire (ex. reclame, întrebarea 213): așteaptă.'
                     else ', partea lui Matei ' || to_char(c.baza_matei, 'FM999G990D00') || ' → ' || c.procent || '%.' end
             || ' Recalculat de sincronizeaza_cod_special().'
    from calcul c
    where k.tranzactie_id = c.id and k.stare <> 'confirmat'
      and (k.impartire, k.procent_precis, k.stare) is distinct from
          (case when c.procent is null then null else 'procent' end, c.procent, case when c.procent is null then 'neclasificat' else 'propus' end)
    returning (c.procent is not null) as ok
  )
  select count(*) filter (where ok), count(*) filter (where not ok) into v_act, v_ast from u;
  -- plăți deja confirmate al căror procent nu mai corespunde achizițiilor: nu se ating, doar se numără
  select count(*) into v_dif
  from plati p join pe_luna l on l.luna = p.luna
  where p.stare = 'confirmat' and l.fara_impartire = 0 and l.baza > 0
    and coalesce(p.procent_precis, -1) <> round(100 * l.baza_matei / l.baza, 6);
  return query select v_act, v_ast, v_dif;
end $function$;
revoke execute on function public.sincronizeaza_cod_special() from anon, public;
grant execute on function public.sincronizeaza_cod_special() to authenticated;
