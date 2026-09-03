create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

create table public.trips (
  id uuid primary key default gen_random_uuid(),
  room_code text not null unique check (room_code ~ '^[0-9]{6}$'),
  created_by uuid not null references auth.users(id) on delete cascade,
  destination text,
  start_date date,
  end_date date,
  duration_days integer check (duration_days is null or duration_days > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint trips_date_order check (
    start_date is null or end_date is null or end_date >= start_date
  )
);

create table public.trip_members (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  display_name text not null check (
    char_length(btrim(display_name)) between 1 and 80
  ),
  joined_at timestamptz not null default now(),
  unique (trip_id, user_id)
);

create table public.preference_profiles (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  personal_budget numeric check (personal_budget is null or personal_budget >= 0),
  travel_pace integer check (travel_pace is null or travel_pace between 1 and 5),
  interests jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (trip_id, user_id),
  foreign key (trip_id, user_id)
    references public.trip_members(trip_id, user_id)
    on delete cascade
);

create table public.places (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips(id) on delete cascade,
  external_place_id text,
  name text not null check (char_length(btrim(name)) > 0),
  latitude double precision check (latitude is null or latitude between -90 and 90),
  longitude double precision check (longitude is null or longitude between -180 and 180),
  estimated_duration_minutes integer check (
    estimated_duration_minutes is null or estimated_duration_minutes > 0
  ),
  estimated_cost numeric check (estimated_cost is null or estimated_cost >= 0),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (id, trip_id)
);

create table public.itinerary_items (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips(id) on delete cascade,
  place_id uuid,
  day_number integer check (day_number is null or day_number > 0),
  sort_order integer not null check (sort_order >= 0),
  planned_start timestamptz,
  planned_end timestamptz,
  estimated_cost numeric check (estimated_cost is null or estimated_cost >= 0),
  status text not null default 'planned' check (char_length(btrim(status)) > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (place_id, trip_id)
    references public.places(id, trip_id)
    on delete restrict,
  constraint itinerary_items_time_order check (
    planned_start is null or planned_end is null or planned_end >= planned_start
  )
);

create index trip_members_user_id_idx on public.trip_members(user_id);
create index preference_profiles_user_id_idx on public.preference_profiles(user_id);
create index places_trip_id_idx on public.places(trip_id);
create index itinerary_items_trip_order_idx
  on public.itinerary_items(trip_id, day_number, sort_order);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger trips_set_updated_at
before update on public.trips
for each row execute function public.set_updated_at();

create trigger preference_profiles_set_updated_at
before update on public.preference_profiles
for each row execute function public.set_updated_at();

create trigger itinerary_items_set_updated_at
before update on public.itinerary_items
for each row execute function public.set_updated_at();

alter table public.trips enable row level security;
alter table public.trip_members enable row level security;
alter table public.preference_profiles enable row level security;
alter table public.places enable row level security;
alter table public.itinerary_items enable row level security;

create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated;

create or replace function private.is_trip_member(p_trip_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.trip_members as member
    where member.trip_id = p_trip_id
      and member.user_id = auth.uid()
  );
$$;

revoke all on function private.is_trip_member(uuid) from public, anon, authenticated;
grant execute on function private.is_trip_member(uuid) to authenticated;

create policy "members can read their trips"
on public.trips for select
to authenticated
using (private.is_trip_member(id));

create policy "members can update their trips"
on public.trips for update
to authenticated
using (private.is_trip_member(id))
with check (private.is_trip_member(id));

create policy "creators can delete their trips"
on public.trips for delete
to authenticated
using (created_by = auth.uid() and private.is_trip_member(id));

create policy "members can read fellow members"
on public.trip_members for select
to authenticated
using (private.is_trip_member(trip_id));

create policy "members can update their own display name"
on public.trip_members for update
to authenticated
using (user_id = auth.uid() and private.is_trip_member(trip_id))
with check (user_id = auth.uid() and private.is_trip_member(trip_id));

create policy "users can read their own preferences"
on public.preference_profiles for select
to authenticated
using (user_id = auth.uid() and private.is_trip_member(trip_id));

create policy "users can add their own preferences"
on public.preference_profiles for insert
to authenticated
with check (user_id = auth.uid() and private.is_trip_member(trip_id));

create policy "users can update their own preferences"
on public.preference_profiles for update
to authenticated
using (user_id = auth.uid() and private.is_trip_member(trip_id))
with check (user_id = auth.uid() and private.is_trip_member(trip_id));

create policy "users can delete their own preferences"
on public.preference_profiles for delete
to authenticated
using (user_id = auth.uid() and private.is_trip_member(trip_id));

create policy "members can read trip places"
on public.places for select
to authenticated
using (private.is_trip_member(trip_id));

create policy "members can add trip places"
on public.places for insert
to authenticated
with check (private.is_trip_member(trip_id));

create policy "members can update trip places"
on public.places for update
to authenticated
using (private.is_trip_member(trip_id))
with check (private.is_trip_member(trip_id));

create policy "members can delete trip places"
on public.places for delete
to authenticated
using (private.is_trip_member(trip_id));

create policy "members can read itinerary items"
on public.itinerary_items for select
to authenticated
using (private.is_trip_member(trip_id));

create policy "members can add itinerary items"
on public.itinerary_items for insert
to authenticated
with check (private.is_trip_member(trip_id));

create policy "members can update itinerary items"
on public.itinerary_items for update
to authenticated
using (private.is_trip_member(trip_id))
with check (private.is_trip_member(trip_id));

create policy "members can delete itinerary items"
on public.itinerary_items for delete
to authenticated
using (private.is_trip_member(trip_id));

create or replace function public.create_trip(
  p_display_name text,
  p_destination text default null,
  p_start_date date default null,
  p_end_date date default null,
  p_duration_days integer default null
)
returns table (trip_id uuid, room_code text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_display_name text := regexp_replace(btrim(p_display_name), '\s+', ' ', 'g');
  v_trip_id uuid;
  v_room_code text;
  v_random bytea;
  v_attempt integer;
begin
  if v_user_id is null then
    raise exception using errcode = 'P0001', message = 'AUTH_REQUIRED';
  end if;

  if v_display_name is null
    or char_length(v_display_name) not between 1 and 80 then
    raise exception using errcode = 'P0001', message = 'INVALID_DISPLAY_NAME';
  end if;

  if p_duration_days is not null and p_duration_days <= 0 then
    raise exception using errcode = 'P0001', message = 'INVALID_DURATION';
  end if;

  if p_start_date is not null and p_end_date is not null
    and p_end_date < p_start_date then
    raise exception using errcode = 'P0001', message = 'INVALID_DATE_RANGE';
  end if;

  for v_attempt in 1..12 loop
    v_random := extensions.gen_random_bytes(4);
    v_room_code := lpad((
      (
        get_byte(v_random, 0)::bigint * 16777216
        + get_byte(v_random, 1)::bigint * 65536
        + get_byte(v_random, 2)::bigint * 256
        + get_byte(v_random, 3)::bigint
      ) % 1000000
    )::text, 6, '0');

    begin
      insert into public.trips (
        room_code,
        created_by,
        destination,
        start_date,
        end_date,
        duration_days
      ) values (
        v_room_code,
        v_user_id,
        nullif(btrim(p_destination), ''),
        p_start_date,
        p_end_date,
        p_duration_days
      )
      returning id into v_trip_id;

      exit;
    exception when unique_violation then
      if v_attempt = 12 then
        raise exception using
          errcode = 'P0001',
          message = 'ROOM_CODE_GENERATION_FAILED';
      end if;
    end;
  end loop;

  insert into public.trip_members (trip_id, user_id, display_name)
  values (v_trip_id, v_user_id, v_display_name);

  return query select v_trip_id, v_room_code;
end;
$$;

create or replace function public.join_trip_by_code(
  p_room_code text,
  p_display_name text
)
returns table (trip_id uuid, room_code text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_display_name text := regexp_replace(btrim(p_display_name), '\s+', ' ', 'g');
  v_room_code text := btrim(p_room_code);
  v_trip_id uuid;
begin
  if v_user_id is null then
    raise exception using errcode = 'P0001', message = 'AUTH_REQUIRED';
  end if;

  if v_display_name is null
    or char_length(v_display_name) not between 1 and 80 then
    raise exception using errcode = 'P0001', message = 'INVALID_DISPLAY_NAME';
  end if;

  if v_room_code is null or v_room_code !~ '^[0-9]{6}$' then
    raise exception using errcode = 'P0001', message = 'INVALID_ROOM_CODE';
  end if;

  select trip.id
  into v_trip_id
  from public.trips as trip
  where trip.room_code = v_room_code;

  if v_trip_id is null then
    raise exception using errcode = 'P0001', message = 'ROOM_NOT_FOUND';
  end if;

  insert into public.trip_members (trip_id, user_id, display_name)
  values (v_trip_id, v_user_id, v_display_name)
  on conflict on constraint trip_members_trip_id_user_id_key
  do update set display_name = excluded.display_name;

  return query select v_trip_id, v_room_code;
end;
$$;

revoke all on function public.create_trip(text, text, date, date, integer)
  from public, anon, authenticated;
revoke all on function public.join_trip_by_code(text, text)
  from public, anon, authenticated;
grant execute on function public.create_trip(text, text, date, date, integer)
  to authenticated;
grant execute on function public.join_trip_by_code(text, text)
  to authenticated;

revoke all on table public.trips from anon, authenticated;
revoke all on table public.trip_members from anon, authenticated;
revoke all on table public.preference_profiles from anon, authenticated;
revoke all on table public.places from anon, authenticated;
revoke all on table public.itinerary_items from anon, authenticated;

grant select, delete on table public.trips to authenticated;
grant update (destination, start_date, end_date, duration_days)
  on table public.trips to authenticated;
grant select on table public.trip_members to authenticated;
grant update (display_name) on table public.trip_members to authenticated;
grant select, insert, delete on table public.preference_profiles to authenticated;
grant update (personal_budget, travel_pace, interests)
  on table public.preference_profiles to authenticated;
grant select, insert, delete on table public.places to authenticated;
grant update (
  external_place_id,
  name,
  latitude,
  longitude,
  estimated_duration_minutes,
  estimated_cost,
  metadata
) on table public.places to authenticated;
grant select, insert, delete on table public.itinerary_items to authenticated;
grant update (
  place_id,
  day_number,
  sort_order,
  planned_start,
  planned_end,
  estimated_cost,
  status
) on table public.itinerary_items to authenticated;
