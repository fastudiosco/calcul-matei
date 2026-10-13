-- ---------- RLS: doar membrii ----------
do $do$
declare t text;
begin
  foreach t in array array['membri','conturi','categorii','clienti','colaboratori','luni','confirmari_luna','importuri',
                           'tranzactii','costuri_recurente','clasificari','elemente_manuale','rambursari','alocari',
                           'intrebari','jurnal'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('create policy membri_citesc on public.%I for select to authenticated using (public.este_membru())', t);
  end loop;
  foreach t in array array['clienti','colaboratori','tranzactii','costuri_recurente','clasificari','elemente_manuale',
                           'rambursari','alocari','intrebari','categorii'] loop
    execute format('create policy membri_adauga on public.%I for insert to authenticated with check (public.este_membru())', t);
    execute format('create policy membri_modifica on public.%I for update to authenticated using (public.este_membru()) with check (public.este_membru())', t);
    execute format('create policy membri_sterg on public.%I for delete to authenticated using (public.este_membru())', t);
  end loop;
end $do$;
-- membri, conturi, luni, confirmari_luna, importuri, jurnal: doar citire din aplicație;
-- se modifică prin funcțiile de mai sus sau de administrator.

revoke execute on function public.confirma_luna(date), public.redeschide_luna(date, text) from anon, public;
grant execute on function public.confirma_luna(date), public.redeschide_luna(date, text) to authenticated;
