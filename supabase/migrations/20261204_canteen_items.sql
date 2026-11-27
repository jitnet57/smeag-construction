-- Canteen: keep each purchase amount of a worker's day, not just the total.
--   canteen_items  individual purchase amounts (₱), in entry order
--   canteen        stays the day's total (sum of canteen_items) — payroll reads it
-- Requires 20261203_payroll_extras.sql.
alter table public.pay_daily_entries
  add column if not exists canteen_items numeric[];

-- existing rows: their single total becomes one purchase
update public.pay_daily_entries
  set canteen_items = array[canteen]
  where canteen is not null and canteen_items is null;
