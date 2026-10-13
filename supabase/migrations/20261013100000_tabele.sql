-- Calcul Matei: schema de bază
-- Principii: sumele din extrase nu se modifică; nimic nu intră în calcul fără confirmare;
-- fiecare modificare ajunge în jurnal (trigger, nu din aplicație).

-- ---------- Membri și acces ----------
create table public.membri (
  email text primary key,
  nume  text not null,
  rol   text not null default 'editor' check (rol in ('admin','editor'))
);

create or replace function public.email_curent() returns text
language sql stable as $$ select lower(coalesce(auth.jwt()->>'email', '')) $$;

create or replace function public.este_membru() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.membri m where lower(m.email) = public.email_curent())
$$;

-- ---------- Nomenclatoare ----------
create table public.conturi (
  id       serial primary key,
  cod      text not null unique,
  nume     text not null,
  banca    text not null,
  moneda   char(3) not null,
  iban     text,
  titular  text not null check (titular in ('firma','alex','matei')),
  activ    boolean not null default true
);

create table public.categorii (
  cod      text primary key,
  eticheta text not null,
  ordine   int not null default 100
);

create table public.clienti (
  id         serial primary key,
  nume       text not null unique,
  cui        text,
  tip        text not null default 'necunoscut' check (tip in ('retainer','one_time','mixt','necunoscut')),
  activitate text not null default 'necunoscut' check (activitate in ('alex','matei','comun','necunoscut')),
  nota       text
);

create table public.colaboratori (
  id   serial primary key,
  nume text not null unique,
  nota text
);

-- ---------- Luni ----------
create table public.luni (
  luna   date primary key check (extract(day from luna) = 1),
  status text not null default 'deschisa' check (status in ('deschisa','inchisa')),
  nota   text
);

create table public.confirmari_luna (
  luna          date not null references public.luni(luna),
  email         text not null references public.membri(email),
  confirmat_la  timestamptz not null default now(),
  primary key (luna, email)
);

-- ---------- Extrase și tranzacții ----------
create table public.importuri (
  id             serial primary key,
  cont_id        int not null references public.conturi(id),
  fisier         text not null,
  sha256         text,
  perioada_de    date not null,
  perioada_pana  date not null,
  sold_initial   numeric(14,2),
  sold_final     numeric(14,2),
  total_intrari  numeric(14,2),
  total_iesiri   numeric(14,2),
  nr_linii       int,
  importat_la    timestamptz not null default now(),
  importat_de    text,
  nota           text
);

create table public.tranzactii (
  id              bigint generated always as identity primary key,
  import_id       int references public.importuri(id),
  cont_id         int not null references public.conturi(id),
  nr_linie        int,
  data_extras     date not null,
  data_reala      date,
  tip             text,
  descriere       text not null,
  suma            numeric(14,2) not null,       -- negativ = ieșire, pozitiv = intrare, în moneda contului
  moneda          char(3) not null,
  suma_originala  text,                          -- ex. "29.00 EUR" la plăți cu cardul în altă monedă
  sold_dupa       numeric(14,2),
  manual          boolean not null default false,
  creat_la        timestamptz not null default now(),
  creat_de        text default public.email_curent(),
  unique (import_id, nr_linie),
  check (manual or import_id is not null)
);
create index on public.tranzactii (data_extras);
create index on public.tranzactii (cont_id, data_extras);

create table public.costuri_recurente (
  id             serial primary key,
  nume           text not null,
  suma           numeric(14,2) not null,
  moneda         char(3) not null default 'RON',
  zi_luna        int check (zi_luna between 1 and 31),
  impartire      text not null check (impartire in ('50_50','matei_100','alex_100','procent','exclus','necunoscut')),
  procent_matei  numeric(5,2) check (procent_matei between 0 and 100),
  cont_id        int references public.conturi(id),
  prima_luna     date,
  ultima_luna    date,
  confirmat      boolean not null default false,
  nota           text
);

create table public.clasificari (
  tranzactie_id     bigint primary key references public.tranzactii(id) on delete cascade,
  stare             text not null default 'neclasificat' check (stare in ('neclasificat','propus','intrebare','confirmat')),
  categorie         text references public.categorii(cod),
  impartire         text check (impartire in ('50_50','matei_100','alex_100','procent','exclus')),
  procent_matei     numeric(5,2) check (procent_matei between 0 and 100),
  contrapartida     text,
  client_id         int references public.clienti(id),
  colaborator_id    int references public.colaboratori(id),
  cost_recurent_id  int references public.costuri_recurente(id),
  pereche_id        bigint references public.tranzactii(id),   -- transfer intern: linia corespondentă din celălalt cont
  suma_ron          numeric(14,2),
  curs              numeric(12,6),
  sursa_curs        text,
  nota              text,
  actualizat_de     text,
  actualizat_la     timestamptz,
  confirmat_de      text,
  confirmat_la      timestamptz,
  check (stare <> 'confirmat' or impartire is not null),
  check (impartire is distinct from 'procent' or procent_matei is not null)
);

create table public.elemente_manuale (
  id             serial primary key,
  luna           date not null references public.luni(luna),
  data           date,
  descriere      text not null,
  suma           numeric(14,2) not null check (suma > 0),
  moneda         char(3) not null default 'RON',
  curs           numeric(12,6),
  suma_ron       numeric(14,2),
  sens           text not null check (sens in ('matei_datoreaza_alex','alex_datoreaza_matei')),
  dovada         text,
  stare          text not null default 'propus' check (stare in ('propus','intrebare','confirmat')),
  nota           text,
  creat_de       text default public.email_curent(),
  creat_la       timestamptz not null default now()
);

create table public.rambursari (
  id             serial primary key,
  luna           date not null references public.luni(luna),
  data           date not null,
  suma           numeric(14,2) not null check (suma > 0),
  moneda         char(3) not null default 'RON',
  curs           numeric(12,6),
  suma_ron       numeric(14,2),
  metoda         text,
  tranzactie_id  bigint references public.tranzactii(id),
  dovada         text,
  stare          text not null default 'propus' check (stare in ('propus','intrebare','confirmat')),
  nota           text,
  creat_de       text default public.email_curent(),
  creat_la       timestamptz not null default now()
);

create table public.alocari (
  id              serial primary key,
  luna            date not null references public.luni(luna),
  colaborator_id  int not null references public.colaboratori(id),
  sursa_tip       text not null check (sursa_tip in ('alex','matei','comun','client')),
  client_id       int references public.clienti(id),
  procent         numeric(5,2) not null check (procent > 0 and procent <= 100),
  stare           text not null default 'propus' check (stare in ('propus','confirmat')),
  nota            text,
  check ((sursa_tip = 'client') = (client_id is not null))
);

create table public.intrebari (
  id             serial primary key,
  tranzactie_id  bigint references public.tranzactii(id),
  element_id     int references public.elemente_manuale(id),
  titlu          text not null,
  detalii        text,
  stare          text not null default 'deschisa' check (stare in ('deschisa','raspunsa','rezolvata')),
  raspuns        text,
  sursa_raspuns  text check (sursa_raspuns in ('data','whatsapp','matei','alex','document','altul')),
  creat_de       text default public.email_curent(),
  creat_la       timestamptz not null default now(),
  rezolvat_de    text,
  rezolvat_la    timestamptz
);

-- ---------- Jurnal (audit) ----------
create table public.jurnal (
  id      bigint generated always as identity primary key,
  tabel   text not null,
  rand_id text,
  actiune text not null,
  vechi   jsonb,
  nou     jsonb,
  email   text,
  la      timestamptz not null default now()
);
create index on public.jurnal (tabel, rand_id);

