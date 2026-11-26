-- Site material stock (inventory): cement, tile adhesive, metal furring, ...
-- material_stock holds the current quantity on hand; material_stock_moves logs
-- every stock-in (delta > 0) and stock-out (delta < 0).

create table if not exists public.material_stock (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  unit text not null default '',
  qty numeric not null default 0,
  min_qty numeric not null default 0,
  note text,
  sort integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.material_stock_moves (
  id uuid primary key default gen_random_uuid(),
  stock_id uuid not null references public.material_stock(id) on delete cascade,
  date date not null default current_date,
  delta numeric not null,
  note text,
  created_at timestamptz not null default now()
);
create index if not exists material_stock_moves_stock_idx
  on public.material_stock_moves (stock_id, date desc);

-- Same open access as the other material tables (app login is enforced in-app).
alter table public.material_stock enable row level security;
alter table public.material_stock_moves enable row level security;
drop policy if exists anon_all on public.material_stock;
create policy anon_all on public.material_stock
  for all to anon, authenticated using (true) with check (true);
drop policy if exists anon_all on public.material_stock_moves;
create policy anon_all on public.material_stock_moves
  for all to anon, authenticated using (true) with check (true);
