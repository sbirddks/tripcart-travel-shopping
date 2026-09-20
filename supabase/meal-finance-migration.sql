-- TripCart: shared meal and expense migration.
-- Run this once in the Supabase SQL Editor after the existing TripCart schema.

create table if not exists public.meal_people (
  id text primary key,
  trip_id text not null references public.trips(id) on delete cascade,
  name text not null default '',
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null,
  unique (trip_id, name)
);

create table if not exists public.meal_expenses (
  id text primary key,
  trip_id text not null references public.trips(id) on delete cascade,
  expense_date date,
  expense_type text not null default '用餐',
  place text not null default '',
  amount numeric(12, 2) not null default 0 check (amount >= 0),
  currency text not null default 'JPY',
  payer text not null default '',
  paid_amount numeric(12, 2) not null default 0 check (paid_amount >= 0),
  participants jsonb not null default '[]'::jsonb check (jsonb_typeof(participants) = 'array'),
  note text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null
);

create index if not exists meal_people_trip_id_idx on public.meal_people(trip_id);
create index if not exists meal_expenses_trip_id_idx on public.meal_expenses(trip_id);
create index if not exists meal_expenses_date_idx on public.meal_expenses(expense_date);

create or replace function public.set_tripcart_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  new.updated_at = now();
  new.updated_by = auth.uid();
  return new;
end;
$$;

drop trigger if exists meal_people_set_updated_at on public.meal_people;
create trigger meal_people_set_updated_at
before update on public.meal_people
for each row execute function public.set_tripcart_updated_at();

drop trigger if exists meal_expenses_set_updated_at on public.meal_expenses;
create trigger meal_expenses_set_updated_at
before update on public.meal_expenses
for each row execute function public.set_tripcart_updated_at();

alter table public.meal_people enable row level security;
alter table public.meal_expenses enable row level security;

revoke all on table public.meal_people, public.meal_expenses from anon, authenticated;
grant select on table public.meal_people, public.meal_expenses to anon, authenticated;
grant select, insert, update, delete on table public.meal_people, public.meal_expenses to authenticated;

drop policy if exists tripcart_meal_people_select on public.meal_people;
create policy tripcart_meal_people_select
on public.meal_people for select
to anon, authenticated
using (true);

drop policy if exists tripcart_meal_people_insert on public.meal_people;
create policy tripcart_meal_people_insert
on public.meal_people for insert
to authenticated
with check (true);

drop policy if exists tripcart_meal_people_update on public.meal_people;
create policy tripcart_meal_people_update
on public.meal_people for update
to authenticated
using (true)
with check (true);

drop policy if exists tripcart_meal_people_delete on public.meal_people;
create policy tripcart_meal_people_delete
on public.meal_people for delete
to authenticated
using (true);

drop policy if exists tripcart_meal_expenses_select on public.meal_expenses;
create policy tripcart_meal_expenses_select
on public.meal_expenses for select
to anon, authenticated
using (true);

drop policy if exists tripcart_meal_expenses_insert on public.meal_expenses;
create policy tripcart_meal_expenses_insert
on public.meal_expenses for insert
to authenticated
with check (true);

drop policy if exists tripcart_meal_expenses_update on public.meal_expenses;
create policy tripcart_meal_expenses_update
on public.meal_expenses for update
to authenticated
using (true)
with check (true);

drop policy if exists tripcart_meal_expenses_delete on public.meal_expenses;
create policy tripcart_meal_expenses_delete
on public.meal_expenses for delete
to authenticated
using (true);

do $$
begin
  alter publication supabase_realtime add table public.meal_people;
exception
  when duplicate_object then null;
end;
$$;

do $$
begin
  alter publication supabase_realtime add table public.meal_expenses;
exception
  when duplicate_object then null;
end;
$$;
