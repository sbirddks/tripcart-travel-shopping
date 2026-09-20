-- TripCart shared data schema.
-- Run this file in Supabase SQL Editor once per project.

create table if not exists public.locations (
  id text primary key,
  region text not null default '',
  city text not null default '',
  store text not null default '',
  location text not null default '',
  maps_url text not null default '',
  lat double precision,
  lng double precision,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null
);

-- Trip header and detail tables keep itinerary data separate from products.
create table if not exists public.trips (
  id text primary key,
  name text not null default '',
  start_date date,
  end_date date,
  primary_location text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null
);

create table if not exists public.trip_details (
  id text primary key,
  trip_id text not null references public.trips(id) on delete cascade,
  attraction text not null default '',
  start_date date,
  end_date date,
  transport_type text not null default '',
  transport_detail text not null default '',
  cost numeric(12, 2) not null default 0 check (cost >= 0),
  currency text not null default 'JPY',
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null
);

create table if not exists public.products (
  id text primary key,
  location_id text references public.locations(id) on delete set null,
  trip_id text references public.trips(id) on delete set null,
  trip text not null default '',
  name_ja text not null default '',
  name_zh text not null default '',
  description text not null default '',
  qty integer not null default 1 check (qty > 0),
  unit_price numeric(12, 2) not null default 0 check (unit_price >= 0),
  currency text not null default 'JPY',
  image_url text not null default '',
  status text not null default 'pending' check (status in ('pending', 'done')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null
);

create index if not exists products_location_id_idx on public.products(location_id);
alter table public.products add column if not exists trip_id text references public.trips(id) on delete set null;
create index if not exists products_trip_id_idx on public.products(trip_id);
create index if not exists products_trip_idx on public.products(trip);
create index if not exists trip_details_trip_id_idx on public.trip_details(trip_id);

-- Public application profile for each Supabase Auth account.
-- Passwords and authentication secrets remain in auth.users.
create table if not exists public.tripcart_users (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null default '',
  display_name text not null default '',
  avatar_url text not null default '',
  last_login_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.set_tripcart_user_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists tripcart_users_set_updated_at on public.tripcart_users;
create trigger tripcart_users_set_updated_at
before update on public.tripcart_users
for each row execute function public.set_tripcart_user_updated_at();

-- Keep one profile row in sync with every new Auth account.
create or replace function public.handle_tripcart_user_created()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.tripcart_users (id, email, display_name)
  values (
    new.id,
    coalesce(new.email, ''),
    coalesce(new.raw_user_meta_data ->> 'display_name', '')
  )
  on conflict (id) do update
    set email = excluded.email;
  return new;
end;
$$;

drop trigger if exists tripcart_user_created on auth.users;
create trigger tripcart_user_created
after insert on auth.users
for each row execute function public.handle_tripcart_user_created();

-- Keep the profile email current if an Auth email changes.
create or replace function public.handle_tripcart_user_updated()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.tripcart_users
  set email = coalesce(new.email, ''), updated_at = now()
  where id = new.id;
  return new;
end;
$$;

drop trigger if exists tripcart_user_updated on auth.users;
create trigger tripcart_user_updated
after update of email on auth.users
for each row execute function public.handle_tripcart_user_updated();

alter table public.tripcart_users enable row level security;
revoke all on table public.tripcart_users from anon, authenticated;
grant select, insert, update on table public.tripcart_users to authenticated;

drop policy if exists tripcart_users_select on public.tripcart_users;
create policy tripcart_users_select
on public.tripcart_users for select
to authenticated
using ((select auth.uid()) = id);

drop policy if exists tripcart_users_insert on public.tripcart_users;
create policy tripcart_users_insert
on public.tripcart_users for insert
to authenticated
with check ((select auth.uid()) = id);

drop policy if exists tripcart_users_update on public.tripcart_users;
create policy tripcart_users_update
on public.tripcart_users for update
to authenticated
using ((select auth.uid()) = id)
with check ((select auth.uid()) = id);

-- Backfill accounts that existed before this table was created.
insert into public.tripcart_users (id, email, display_name, created_at)
select
  id,
  coalesce(email, ''),
  coalesce(raw_user_meta_data ->> 'display_name', ''),
  created_at
from auth.users
on conflict (id) do nothing;

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

drop trigger if exists locations_set_updated_at on public.locations;
create trigger locations_set_updated_at
before update on public.locations
for each row execute function public.set_tripcart_updated_at();

drop trigger if exists products_set_updated_at on public.products;
create trigger products_set_updated_at
before update on public.products
for each row execute function public.set_tripcart_updated_at();

drop trigger if exists trips_set_updated_at on public.trips;
create trigger trips_set_updated_at
before update on public.trips
for each row execute function public.set_tripcart_updated_at();

drop trigger if exists trip_details_set_updated_at on public.trip_details;
create trigger trip_details_set_updated_at
before update on public.trip_details
for each row execute function public.set_tripcart_updated_at();

alter table public.locations enable row level security;
alter table public.products enable row level security;
alter table public.trips enable row level security;
alter table public.trip_details enable row level security;

revoke all on table public.trips, public.trip_details from anon, authenticated;
grant select on table public.trips, public.trip_details to anon, authenticated;
grant select, insert, update, delete on table public.trips, public.trip_details to authenticated;

drop policy if exists tripcart_locations_select on public.locations;
create policy tripcart_locations_select
on public.locations for select
to anon, authenticated
using (true);

drop policy if exists tripcart_locations_insert on public.locations;
create policy tripcart_locations_insert
on public.locations for insert
to authenticated
with check (true);

drop policy if exists tripcart_locations_update on public.locations;
create policy tripcart_locations_update
on public.locations for update
to authenticated
using (true)
with check (true);

drop policy if exists tripcart_locations_delete on public.locations;
create policy tripcart_locations_delete
on public.locations for delete
to authenticated
using (true);

drop policy if exists tripcart_products_select on public.products;
create policy tripcart_products_select
on public.products for select
to anon, authenticated
using (true);

drop policy if exists tripcart_products_insert on public.products;
create policy tripcart_products_insert
on public.products for insert
to authenticated
with check (true);

drop policy if exists tripcart_products_update on public.products;
create policy tripcart_products_update
on public.products for update
to authenticated
using (true)
with check (true);

drop policy if exists tripcart_products_delete on public.products;
create policy tripcart_products_delete
on public.products for delete
to authenticated
using (true);

drop policy if exists tripcart_trips_select on public.trips;
create policy tripcart_trips_select
on public.trips for select
to anon, authenticated
using (true);

drop policy if exists tripcart_trips_insert on public.trips;
create policy tripcart_trips_insert
on public.trips for insert
to authenticated
with check (true);

drop policy if exists tripcart_trips_update on public.trips;
create policy tripcart_trips_update
on public.trips for update
to authenticated
using (true)
with check (true);

drop policy if exists tripcart_trips_delete on public.trips;
create policy tripcart_trips_delete
on public.trips for delete
to authenticated
using (true);

drop policy if exists tripcart_trip_details_select on public.trip_details;
create policy tripcart_trip_details_select
on public.trip_details for select
to anon, authenticated
using (true);

drop policy if exists tripcart_trip_details_insert on public.trip_details;
create policy tripcart_trip_details_insert
on public.trip_details for insert
to authenticated
with check (true);

drop policy if exists tripcart_trip_details_update on public.trip_details;
create policy tripcart_trip_details_update
on public.trip_details for update
to authenticated
using (true)
with check (true);

drop policy if exists tripcart_trip_details_delete on public.trip_details;
create policy tripcart_trip_details_delete
on public.trip_details for delete
to authenticated
using (true);

-- Enable realtime updates for both shared tables.
do $$
begin
  alter publication supabase_realtime add table public.locations;
exception
  when duplicate_object then null;
end;
$$;

do $$
begin
  alter publication supabase_realtime add table public.products;
exception
  when duplicate_object then null;
end;
$$;

do $$
begin
  alter publication supabase_realtime add table public.trips;
exception
  when duplicate_object then null;
end;
$$;

do $$
begin
  alter publication supabase_realtime add table public.trip_details;
exception
  when duplicate_object then null;
end;
$$;

insert into public.trips (id, name, primary_location)
values
  ('hiroshima-3d2n', '廣島 3 天 2 夜', '廣島'),
  ('okayama-2d1n', '岡山 2 天 1 夜', '岡山')
on conflict (id) do update set
  name = excluded.name,
  primary_location = excluded.primary_location;

insert into public.trips (id, name, primary_location)
select
  'trip-' || substr(md5(trim(p.trip)), 1, 12),
  trim(p.trip),
  coalesce(max(l.region), '')
from public.products p
left join public.locations l on l.id = p.location_id
where trim(p.trip) <> ''
  and not exists (select 1 from public.trips t where t.name = trim(p.trip))
group by trim(p.trip)
on conflict (id) do update set
  name = excluded.name,
  primary_location = excluded.primary_location;

update public.products p
set trip_id = t.id
from public.trips t
where p.trip_id is null
  and p.trip = t.name;

insert into public.locations (id, region, city, store, location, maps_url, lat, lng)
values
  ('chawawa-miyajima', '廣島／宮島', '廣島', '茶和々', '宮島', 'https://www.google.com/maps/search/?api=1&query=%E8%8C%B6%E5%92%8C%E3%80%80%E5%AE%AE%E5%B3%B6', 34.2991, 132.3196),
  ('fujiiya-miyajima', '廣島／宮島', '廣島', '藤い屋', '宮島', 'https://www.google.com/maps/search/?api=1&query=%E8%97%A4%E3%81%84%E5%B1%8B%20%E5%AE%AE%E5%B3%B6', 34.2994, 132.3191),
  ('sogo-hiroshima', '廣島', '廣島', 'SOGO 廣島店', 'SOGO 廣島店', 'https://www.google.com/maps/search/?api=1&query=SOGO%20%E5%BB%A3%E5%B3%B6%E5%BA%97', 34.3948, 132.4595),
  ('ekie-hiroshima', '廣島', '廣島', '廣島車站 EKIE', '廣島車站 EKIE', 'https://www.google.com/maps/search/?api=1&query=EKIE%20Hiroshima', 34.3977, 132.4759),
  ('okayama-station', '岡山', '岡山', '岡山車站', '岡山車站', 'https://www.google.com/maps/search/?api=1&query=%E5%B2%A1%E5%B1%B1%E8%BB%8A%E7%AB%99', 34.6663, 133.918)
on conflict (id) do update set
  region = excluded.region,
  city = excluded.city,
  store = excluded.store,
  location = excluded.location,
  maps_url = excluded.maps_url,
  lat = excluded.lat,
  lng = excluded.lng;

insert into public.products (id, location_id, trip_id, trip, name_ja, name_zh, description, qty, unit_price, currency, image_url, status)
values
  ('hiroshima-matcha', 'chawawa-miyajima', 'hiroshima-3d2n', '廣島 3 天 2 夜', '茶和々抹茶', '茶和々抹茶', '宮島伴手禮，適合做成抹茶飲或甜點。', 2, 1200, 'JPY', 'https://res.cloudinary.com/lwq0ys1w/image/upload/v1789883227/tripcart/products/oiapkbabyahzhaitnfsq.jpg', 'pending'),
  ('hiroshima-fujiiya', 'fujiiya-miyajima', 'hiroshima-3d2n', '廣島 3 天 2 夜', '藤い屋 輕雪花', '藤い屋輕雪花', '原清單中的宮島甜點示例，保留日文店名。', 1, 800, 'JPY', 'https://res.cloudinary.com/lwq0ys1w/image/upload/v1789883227/tripcart/products/sgvdkrjvlpgvz9rblyrj.jpg', 'pending'),
  ('hiroshima-butter', 'sogo-hiroshima', 'hiroshima-3d2n', '廣島 3 天 2 夜', 'PRESS BUTTER SAND', '焦糖奶油夾心餅乾', 'SOGO 廣島店可購買，適合列為已購買回顧。', 2, 1600, 'JPY', 'https://res.cloudinary.com/lwq0ys1w/image/upload/v1789883228/tripcart/products/anl1ndboidloejodrwvd.jpg', 'done'),
  ('hiroshima-hattendo', 'ekie-hiroshima', 'hiroshima-3d2n', '廣島 3 天 2 夜', '八天堂 くりーむパン', '八天堂奶油麵包', '廣島車站 EKIE 的代表性甜點示例。', 3, 350, 'JPY', 'https://res.cloudinary.com/lwq0ys1w/image/upload/v1789883228/tripcart/products/uxcvvi3luezf44tqkw08.jpg', 'pending'),
  ('hiroshima-fukujuen', 'sogo-hiroshima', 'hiroshima-3d2n', '廣島 3 天 2 夜', '福寿園 抹茶粉', '福寿園抹茶粉', '原清單中的茶品示例，可用於測試多筆同地區資料。', 1, 980, 'JPY', 'https://res.cloudinary.com/lwq0ys1w/image/upload/v1789883229/tripcart/products/q90x48wgs8zhcmqmi5nx.jpg', 'pending'),
  ('okayama-butter', 'okayama-station', 'okayama-2d1n', '岡山 2 天 1 夜', 'PRESS BUTTER SAND 岡山限定', '岡山限定水蜜桃口味', '原清單中的岡山車站限定口味示例。', 1, 1700, 'JPY', 'https://res.cloudinary.com/lwq0ys1w/image/upload/v1789883230/tripcart/products/aeemnnznghe6562tetxo.jpg', 'pending')
on conflict (id) do update set
  location_id = excluded.location_id,
  trip_id = excluded.trip_id,
  trip = excluded.trip,
  name_ja = excluded.name_ja,
  name_zh = excluded.name_zh,
  description = excluded.description,
  qty = excluded.qty,
  unit_price = excluded.unit_price,
  currency = excluded.currency,
  image_url = excluded.image_url,
  status = excluded.status;

insert into public.trip_details (id, trip_id, attraction, transport_type, transport_detail, currency, sort_order)
values
  ('hiroshima-detail-1', 'hiroshima-3d2n', '宮島／廣島市區', 'JR', 'JR 山陽本線', 'JPY', 0),
  ('okayama-detail-1', 'okayama-2d1n', '岡山市區', 'JR', '岡山車站', 'JPY', 0)
on conflict (id) do update set
  trip_id = excluded.trip_id,
  attraction = excluded.attraction,
  transport_type = excluded.transport_type,
  transport_detail = excluded.transport_detail,
  currency = excluded.currency,
  sort_order = excluded.sort_order;
