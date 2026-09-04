create or replace function public.reschedule_itinerary_day(
  p_trip_id uuid,
  p_day_number integer,
  p_schedule jsonb
)
returns table (item_id uuid, planned_time time without time zone)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_expected_count integer;
begin
  if not private.is_trip_member(p_trip_id) then
    raise exception using errcode = 'P0001', message = 'TRIP_UNAVAILABLE';
  end if;

  if p_day_number is null or p_day_number < 1
    or jsonb_typeof(p_schedule) <> 'array' then
    raise exception using errcode = 'P0001', message = 'INVALID_SCHEDULE';
  end if;

  select count(*) into v_expected_count
  from public.itinerary_items
  where trip_id = p_trip_id
    and day_number = p_day_number
    and generation_source = 'phase2';

  if v_expected_count <> jsonb_array_length(p_schedule)
    or exists (
      select 1
      from jsonb_array_elements(p_schedule) as entry
      where nullif(entry ->> 'itemId', '') is null
        or nullif(entry ->> 'plannedTime', '') is null
        or not exists (
          select 1 from public.itinerary_items as item
          where item.id = (entry ->> 'itemId')::uuid
            and item.trip_id = p_trip_id
            and item.day_number = p_day_number
            and item.generation_source = 'phase2'
        )
    )
    or (
      select count(distinct entry ->> 'itemId')
      from jsonb_array_elements(p_schedule) as entry
    ) <> v_expected_count then
    raise exception using errcode = 'P0001', message = 'INVALID_SCHEDULE';
  end if;

  update public.itinerary_items as item
  set planned_time = (entry.value ->> 'plannedTime')::time,
      planned_start = null,
      planned_end = null
  from jsonb_array_elements(p_schedule) as entry(value)
  where item.id = (entry.value ->> 'itemId')::uuid
    and item.trip_id = p_trip_id
    and item.day_number = p_day_number
    and item.generation_source = 'phase2';

  return query
  select item.id, item.planned_time
  from public.itinerary_items as item
  where item.trip_id = p_trip_id
    and item.day_number = p_day_number
    and item.generation_source = 'phase2'
  order by item.sort_order;
end;
$$;

create or replace function public.add_itinerary_place(
  p_trip_id uuid,
  p_day_number integer,
  p_place jsonb,
  p_estimated_duration_minutes integer default 60
)
returns table (item_id uuid)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_place_id uuid;
  v_item_id uuid;
  v_sort_order integer;
  v_day_theme text;
begin
  if not private.is_trip_member(p_trip_id) then
    raise exception using errcode = 'P0001', message = 'TRIP_UNAVAILABLE';
  end if;

  if p_day_number is null or p_day_number < 1
    or p_estimated_duration_minutes not between 15 and 720
    or nullif(btrim(p_place ->> 'externalPlaceId'), '') is null
    or nullif(btrim(p_place ->> 'name'), '') is null
    or p_place ->> 'latitude' is null
    or p_place ->> 'longitude' is null then
    raise exception using errcode = 'P0001', message = 'INVALID_PLACE_DATA';
  end if;

  insert into public.places (
    trip_id,
    external_place_id,
    name,
    formatted_address,
    latitude,
    longitude,
    rating,
    rating_count,
    price_level,
    types,
    metadata
  ) values (
    p_trip_id,
    p_place ->> 'externalPlaceId',
    p_place ->> 'name',
    nullif(p_place ->> 'address', ''),
    (p_place ->> 'latitude')::double precision,
    (p_place ->> 'longitude')::double precision,
    nullif(p_place ->> 'rating', '')::numeric,
    nullif(p_place ->> 'ratingCount', '')::integer,
    nullif(p_place ->> 'priceLevel', ''),
    coalesce(
      array(
        select jsonb_array_elements_text(
          coalesce(p_place -> 'types', '[]'::jsonb)
        )
      ),
      '{}'::text[]
    ),
    jsonb_build_object('generationSource', 'planner')
  )
  on conflict on constraint places_trip_external_place_id_key
  do update set
    name = excluded.name,
    formatted_address = excluded.formatted_address,
    latitude = excluded.latitude,
    longitude = excluded.longitude,
    rating = excluded.rating,
    rating_count = excluded.rating_count,
    price_level = excluded.price_level,
    types = excluded.types
  returning id into v_place_id;

  if exists (
    select 1 from public.itinerary_items
    where trip_id = p_trip_id
      and day_number = p_day_number
      and place_id = v_place_id
      and generation_source = 'phase2'
  ) then
    raise exception using errcode = 'P0001', message = 'PLACE_ALREADY_ADDED';
  end if;

  select coalesce(max(sort_order) + 1, 0), max(day_theme)
  into v_sort_order, v_day_theme
  from public.itinerary_items
  where trip_id = p_trip_id
    and day_number = p_day_number
    and generation_source = 'phase2';

  insert into public.itinerary_items (
    trip_id,
    place_id,
    day_number,
    sort_order,
    planned_time,
    estimated_duration_minutes,
    reason,
    day_theme,
    status,
    generation_source
  ) values (
    p_trip_id,
    v_place_id,
    p_day_number,
    v_sort_order,
    '09:00'::time,
    p_estimated_duration_minutes,
    'Added by a trip member.',
    coalesce(v_day_theme, 'Day ' || p_day_number),
    'planned',
    'phase2'
  ) returning id into v_item_id;

  return query select v_item_id;
end;
$$;

create or replace function public.remove_itinerary_item(
  p_trip_id uuid,
  p_item_id uuid
)
returns table (day_number integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_day_number integer;
  v_place_id uuid;
begin
  if not private.is_trip_member(p_trip_id) then
    raise exception using errcode = 'P0001', message = 'TRIP_UNAVAILABLE';
  end if;

  delete from public.itinerary_items
  where id = p_item_id
    and trip_id = p_trip_id
    and generation_source = 'phase2'
  returning itinerary_items.day_number, place_id
  into v_day_number, v_place_id;

  if v_day_number is null then
    raise exception using errcode = 'P0001', message = 'ITEM_UNAVAILABLE';
  end if;

  with ordered as (
    select id, row_number() over (order by sort_order, created_at) - 1 as next_order
    from public.itinerary_items
    where trip_id = p_trip_id
      and day_number = v_day_number
      and generation_source = 'phase2'
  )
  update public.itinerary_items as item
  set sort_order = ordered.next_order
  from ordered
  where item.id = ordered.id;

  delete from public.places as place
  where place.id = v_place_id
    and place.trip_id = p_trip_id
    and not exists (
      select 1 from public.itinerary_items as item
      where item.place_id = place.id
    );

  return query select v_day_number;
end;
$$;

create or replace function public.replace_itinerary_day(
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
declare
  v_saved_items integer;
  v_day_theme text;
begin
  if not private.is_trip_member(p_trip_id) then
    raise exception using errcode = 'P0001', message = 'TRIP_UNAVAILABLE';
  end if;

  if p_day_number is null or p_day_number < 1
    or jsonb_typeof(p_items) <> 'array'
    or jsonb_array_length(p_items) = 0
    or jsonb_typeof(p_places) <> 'array' then
    raise exception using errcode = 'P0001', message = 'INVALID_ITINERARY';
  end if;

  select max(day_theme) into v_day_theme
  from public.itinerary_items
  where trip_id = p_trip_id and day_number = p_day_number;

  insert into public.places (
    trip_id, external_place_id, name, formatted_address, latitude, longitude,
    rating, rating_count, price_level, types, metadata
  )
  select
    p_trip_id,
    place ->> 'externalPlaceId',
    place ->> 'name',
    nullif(place ->> 'address', ''),
    (place ->> 'latitude')::double precision,
    (place ->> 'longitude')::double precision,
    nullif(place ->> 'rating', '')::numeric,
    nullif(place ->> 'ratingCount', '')::integer,
    nullif(place ->> 'priceLevel', ''),
    coalesce(array(
      select jsonb_array_elements_text(coalesce(place -> 'types', '[]'::jsonb))
    ), '{}'::text[]),
    jsonb_build_object('generationSource', 'ai-edit')
  from jsonb_array_elements(p_places) as place
  on conflict on constraint places_trip_external_place_id_key
  do update set
    name = excluded.name,
    formatted_address = excluded.formatted_address,
    latitude = excluded.latitude,
    longitude = excluded.longitude,
    rating = excluded.rating,
    rating_count = excluded.rating_count,
    price_level = excluded.price_level,
    types = excluded.types;

  if exists (
    select 1
    from jsonb_array_elements(p_items) as item
    where nullif(item ->> 'externalPlaceId', '') is null
      or not exists (
        select 1 from public.places as place
        where place.trip_id = p_trip_id
          and place.external_place_id = item ->> 'externalPlaceId'
      )
  ) then
    raise exception using errcode = 'P0001', message = 'UNKNOWN_PLACE_ID';
  end if;

  delete from public.itinerary_items
  where trip_id = p_trip_id
    and day_number = p_day_number
    and generation_source = 'phase2';

  insert into public.itinerary_items (
    trip_id, place_id, day_number, sort_order, planned_time,
    estimated_cost, estimated_duration_minutes, reason, day_theme,
    status, generation_source
  )
  select
    p_trip_id,
    place.id,
    p_day_number,
    item.ordinality - 1,
    coalesce(nullif(item.value ->> 'plannedTime', '')::time, '09:00'::time),
    nullif(item.value ->> 'estimatedCost', '')::numeric,
    coalesce(nullif(item.value ->> 'estimatedDurationMinutes', '')::integer, 60),
    coalesce(nullif(btrim(item.value ->> 'reason'), ''), 'Updated by AI preview.'),
    coalesce(v_day_theme, 'Day ' || p_day_number),
    'planned',
    'phase2'
  from jsonb_array_elements(p_items) with ordinality as item(value, ordinality)
  join public.places as place
    on place.trip_id = p_trip_id
   and place.external_place_id = item.value ->> 'externalPlaceId';

  get diagnostics v_saved_items = row_count;
  if v_saved_items <> jsonb_array_length(p_items) then
    raise exception using errcode = 'P0001', message = 'ITINERARY_SAVE_FAILED';
  end if;

  return query select v_saved_items;
end;
$$;

revoke all on function public.reschedule_itinerary_day(uuid, integer, jsonb)
  from public, anon, authenticated;
revoke all on function public.add_itinerary_place(uuid, integer, jsonb, integer)
  from public, anon, authenticated;
revoke all on function public.remove_itinerary_item(uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.replace_itinerary_day(uuid, integer, jsonb, jsonb)
  from public, anon, authenticated;

grant execute on function public.reschedule_itinerary_day(uuid, integer, jsonb)
  to authenticated;
grant execute on function public.add_itinerary_place(uuid, integer, jsonb, integer)
  to authenticated;
grant execute on function public.remove_itinerary_item(uuid, uuid)
  to authenticated;
grant execute on function public.replace_itinerary_day(uuid, integer, jsonb, jsonb)
  to authenticated;

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'itinerary_items'
  ) then
    alter publication supabase_realtime add table public.itinerary_items;
  end if;

  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'places'
  ) then
    alter publication supabase_realtime add table public.places;
  end if;
end;
$$;
