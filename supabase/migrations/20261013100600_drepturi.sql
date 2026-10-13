-- Proiectul nu dă automat drepturi rolului authenticated pe tabelele noi.
-- Rândurile rămân filtrate de RLS (doar membrii).
grant usage on schema public to authenticated;
grant select on all tables in schema public to authenticated;
grant insert, update on public.clienti, public.colaboratori, public.tranzactii, public.costuri_recurente,
  public.clasificari, public.elemente_manuale, public.rambursari, public.alocari, public.intrebari,
  public.categorii to authenticated;
grant insert on public.whatsapp to authenticated;
grant usage on all sequences in schema public to authenticated;

-- Ștergerile din aplicație (rămân în jurnal); liniile importate sunt protejate de trigger.
grant delete on public.tranzactii, public.elemente_manuale, public.rambursari, public.alocari to authenticated;
