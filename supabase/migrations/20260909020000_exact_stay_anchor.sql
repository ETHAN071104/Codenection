alter table public.trips
  add column if not exists stay_anchor jsonb;

alter table public.trips
  drop constraint if exists trips_stay_anchor_shape_check,
  add constraint trips_stay_anchor_shape_check check (
    stay_anchor is null or (
      jsonb_typeof(stay_anchor) = 'object'
      and nullif(btrim(stay_anchor ->> 'googlePlaceId'), '') is not null
      and nullif(btrim(stay_anchor ->> 'name'), '') is not null
      and jsonb_typeof(stay_anchor -> 'latitude') = 'number'
      and jsonb_typeof(stay_anchor -> 'longitude') = 'number'
      and (stay_anchor ->> 'latitude')::double precision between -90 and 90
      and (stay_anchor ->> 'longitude')::double precision between -180 and 180
    )
  );

create or replace function public.apply_stay_anchor_replan(
  p_trip_id uuid,
  p_stay_anchor jsonb,
  p_schedule jsonb
)
returns table (saved_items integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_expected_items integer;
  v_saved_items integer;
begin
  if not private.is_trip_member(p_trip_id) then
    raise exception using errcode = 'P0001', message = 'TRIP_UNAVAILABLE';
  end if;

  if p_stay_anchor is null
    or jsonb_typeof(p_stay_anchor) <> 'object'
    or nullif(btrim(p_stay_anchor ->> 'googlePlaceId'), '') is null
    or nullif(btrim(p_stay_anchor ->> 'name'), '') is null
    or jsonb_typeof(p_stay_anchor -> 'latitude') is distinct from 'number'
    or jsonb_typeof(p_stay_anchor -> 'longitude') is distinct from 'number'
    or (p_stay_anchor ->> 'latitude')::double precision not between -90 and 90
    or (p_stay_anchor ->> 'longitude')::double precision not between -180 and 180
  then
    raise exception using errcode = 'P0001', message = 'INVALID_STAY_PLACE';
  end if;

  if jsonb_typeof(p_schedule) <> 'array'
    or jsonb_array_length(p_schedule) = 0
    or exists (
      select 1
      from jsonb_array_elements(p_schedule) as item
      where nullif(item ->> 'itemId', '') is null
        or nullif(item ->> 'day', '') is null
        or (item ->> 'day')::integer not between 1 and 30
        or nullif(item ->> 'sortOrder', '') is null
        or (item ->> 'sortOrder')::integer < 0
        or nullif(item ->> 'plannedTime', '') is null
        or nullif(item ->> 'estimatedDurationMinutes', '') is null
        or (item ->> 'estimatedDurationMinutes')::integer not between 15 and 720
    )
  then
    raise exception using errcode = 'P0001', message = 'INVALID_ITINERARY';
  end if;

  select count(*) into v_expected_items
  from public.itinerary_items
  where trip_id = p_trip_id and generation_source = 'phase2';

  if v_expected_items <> jsonb_array_length(p_schedule)
    or (
      select count(distinct item ->> 'itemId')
      from jsonb_array_elements(p_schedule) as item
    ) <> v_expected_items
    or exists (
      select 1
      from jsonb_array_elements(p_schedule) as item
      where not exists (
        select 1
        from public.itinerary_items as itinerary_item
        where itinerary_item.id = (item ->> 'itemId')::uuid
          and itinerary_item.trip_id = p_trip_id
          and itinerary_item.generation_source = 'phase2'
      )
    )
  then
    raise exception using errcode = 'P0001', message = 'ITINERARY_SAVE_FAILED';
  end if;

  perform set_config('app.finalized_trip_mutation', 'ai_edit', true);

  update public.trips
  set stay_anchor = p_stay_anchor
  where id = p_trip_id;

  update public.itinerary_items as itinerary_item
  set
    day_number = (item.value ->> 'day')::integer,
    sort_order = (item.value ->> 'sortOrder')::integer,
    planned_time = (item.value ->> 'plannedTime')::time,
    estimated_duration_minutes =
      (item.value ->> 'estimatedDurationMinutes')::integer,
    day_theme = coalesce(
      nullif(btrim(item.value ->> 'dayTheme'), ''),
      itinerary_item.day_theme
    )
  from jsonb_array_elements(p_schedule) as item(value)
  where itinerary_item.id = (item.value ->> 'itemId')::uuid
    and itinerary_item.trip_id = p_trip_id
    and itinerary_item.generation_source = 'phase2';

  get diagnostics v_saved_items = row_count;
  if v_saved_items <> v_expected_items then
    raise exception using errcode = 'P0001', message = 'ITINERARY_SAVE_FAILED';
  end if;

  return query select v_saved_items;
end;
$$;

revoke all on function public.apply_stay_anchor_replan(uuid, jsonb, jsonb)
  from public, anon, authenticated;
grant execute on function public.apply_stay_anchor_replan(uuid, jsonb, jsonb)
  to authenticated;
grant select (stay_anchor) on public.trips to authenticated;
