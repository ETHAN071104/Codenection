alter table public.trips
  add column if not exists finalized_at timestamptz,
  add column if not exists finalized_by uuid references auth.users(id) on delete set null;

create index if not exists trips_finalized_at_idx
  on public.trips(finalized_at)
  where finalized_at is not null;

create or replace function private.is_trip_finalized(p_trip_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.trips as trip
    where trip.id = p_trip_id and trip.finalized_at is not null
  );
$$;

revoke all on function private.is_trip_finalized(uuid)
  from public, anon, authenticated;
grant execute on function private.is_trip_finalized(uuid) to authenticated;

drop policy if exists "trip hosts can update their trips" on public.trips;
create policy "trip hosts can update open trips"
on public.trips for update
to authenticated
using (
  private.is_trip_host(id)
  and private.is_trip_member(id)
  and not private.is_trip_finalized(id)
)
with check (
  private.is_trip_host(id)
  and private.is_trip_member(id)
  and not private.is_trip_finalized(id)
);

create or replace function private.enforce_finalized_planning_lock()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_trip_id uuid;
  v_allowed_mutation text := coalesce(
    current_setting('app.finalized_trip_mutation', true),
    ''
  );
begin
  v_trip_id := case when tg_op = 'DELETE' then old.trip_id else new.trip_id end;
  if private.is_trip_finalized(v_trip_id)
    and v_allowed_mutation not in ('ai_edit', 'live_change') then
    raise exception using errcode = 'P0001', message = 'TRIP_FINALIZED';
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

revoke all on function private.enforce_finalized_planning_lock()
  from public, anon, authenticated;

drop trigger if exists preference_profiles_finalized_lock on public.preference_profiles;
create trigger preference_profiles_finalized_lock
before insert or update or delete on public.preference_profiles
for each row execute function private.enforce_finalized_planning_lock();

drop trigger if exists trip_place_votes_finalized_lock on public.trip_place_votes;
create trigger trip_place_votes_finalized_lock
before insert or update or delete on public.trip_place_votes
for each row execute function private.enforce_finalized_planning_lock();

drop trigger if exists selection_members_finalized_lock on public.trip_place_selection_members;
create trigger selection_members_finalized_lock
before insert or update or delete on public.trip_place_selection_members
for each row execute function private.enforce_finalized_planning_lock();

drop trigger if exists itinerary_items_finalized_lock on public.itinerary_items;
create trigger itinerary_items_finalized_lock
before insert or update or delete on public.itinerary_items
for each row execute function private.enforce_finalized_planning_lock();

drop trigger if exists places_finalized_lock on public.places;
create trigger places_finalized_lock
before insert or update or delete on public.places
for each row execute function private.enforce_finalized_planning_lock();

create or replace function public.finalize_trip(p_trip_id uuid)
returns table (finalized_at timestamptz, already_finalized boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_created_by uuid;
  v_finalized_at timestamptz;
begin
  if v_user_id is null then
    raise exception using errcode = 'P0001', message = 'AUTH_REQUIRED';
  end if;

  select trip.created_by, trip.finalized_at
  into v_created_by, v_finalized_at
  from public.trips as trip
  where trip.id = p_trip_id
  for update;

  if v_created_by is null or v_created_by <> v_user_id then
    raise exception using errcode = 'P0001', message = 'TRIP_HOST_REQUIRED';
  end if;

  if v_finalized_at is not null then
    return query select v_finalized_at, true;
    return;
  end if;

  if not exists (
    select 1 from public.itinerary_items as item
    where item.trip_id = p_trip_id and item.generation_source = 'phase2'
  ) then
    raise exception using errcode = 'P0001', message = 'ITINERARY_REQUIRED';
  end if;

  v_finalized_at := now();
  update public.trips as trip
  set finalized_at = v_finalized_at, finalized_by = v_user_id
  where trip.id = p_trip_id;

  return query select v_finalized_at, false;
end;
$$;

create or replace function public.apply_ai_itinerary_day(
  p_trip_id uuid,
  p_day_number integer,
  p_items jsonb,
  p_places jsonb
)
returns table (saved_items integer)
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform set_config('app.finalized_trip_mutation', 'ai_edit', true);
  return query select * from public.replace_itinerary_day(
    p_trip_id, p_day_number, p_items, p_places
  );
end;
$$;

create or replace function public.reschedule_post_planning_itinerary_day(
  p_trip_id uuid,
  p_day_number integer,
  p_schedule jsonb
)
returns table (item_id uuid, planned_time time without time zone)
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform set_config('app.finalized_trip_mutation', 'live_change', true);
  return query select * from public.reschedule_itinerary_day(
    p_trip_id, p_day_number, p_schedule
  );
end;
$$;

create or replace function public.apply_live_schedule_adjustment(
  p_trip_id uuid,
  p_day_number integer,
  p_current_item_id uuid,
  p_change_type text,
  p_minutes integer
)
returns table (item_id uuid, planned_time time without time zone)
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform set_config('app.finalized_trip_mutation', 'live_change', true);
  return query select * from public.adjust_itinerary_schedule(
    p_trip_id, p_day_number, p_current_item_id, p_change_type, p_minutes
  );
end;
$$;

create or replace function public.remove_live_itinerary_item(
  p_trip_id uuid,
  p_item_id uuid
)
returns table (day_number integer)
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform set_config('app.finalized_trip_mutation', 'live_change', true);
  return query select * from public.remove_itinerary_item(p_trip_id, p_item_id);
end;
$$;

revoke all on function public.finalize_trip(uuid) from public, anon, authenticated;
revoke all on function public.apply_ai_itinerary_day(uuid, integer, jsonb, jsonb) from public, anon, authenticated;
revoke all on function public.reschedule_post_planning_itinerary_day(uuid, integer, jsonb) from public, anon, authenticated;
revoke all on function public.apply_live_schedule_adjustment(uuid, integer, uuid, text, integer) from public, anon, authenticated;
revoke all on function public.remove_live_itinerary_item(uuid, uuid) from public, anon, authenticated;

grant execute on function public.finalize_trip(uuid) to authenticated;
grant execute on function public.apply_ai_itinerary_day(uuid, integer, jsonb, jsonb) to authenticated;
grant execute on function public.reschedule_post_planning_itinerary_day(uuid, integer, jsonb) to authenticated;
grant execute on function public.apply_live_schedule_adjustment(uuid, integer, uuid, text, integer) to authenticated;
grant execute on function public.remove_live_itinerary_item(uuid, uuid) to authenticated;

grant select (finalized_at, finalized_by) on public.trips to authenticated;
