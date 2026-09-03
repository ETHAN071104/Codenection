alter table public.places
  add column if not exists formatted_address text,
  add column if not exists rating numeric,
  add column if not exists rating_count integer,
  add column if not exists price_level text,
  add column if not exists types text[] not null default '{}';

alter table public.places
  drop constraint if exists places_phase_2_rating_check,
  add constraint places_phase_2_rating_check check (
    rating is null or rating between 0 and 5
  ),
  drop constraint if exists places_phase_2_rating_count_check,
  add constraint places_phase_2_rating_count_check check (
    rating_count is null or rating_count >= 0
  );

alter table public.itinerary_items
  add column if not exists reason text,
  add column if not exists estimated_duration_minutes integer,
  add column if not exists day_theme text,
  add column if not exists planned_time time without time zone,
  add column if not exists generation_source text not null default 'manual';

alter table public.itinerary_items
  drop constraint if exists itinerary_items_phase_2_duration_check,
  add constraint itinerary_items_phase_2_duration_check check (
    estimated_duration_minutes is null
    or estimated_duration_minutes between 15 and 720
  );

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'places_trip_external_place_id_key'
      and conrelid = 'public.places'::regclass
  ) then
    alter table public.places
      add constraint places_trip_external_place_id_key
      unique (trip_id, external_place_id);
  end if;
end;
$$;

create or replace function public.replace_generated_itinerary(
  p_trip_id uuid,
  p_destination text,
  p_places jsonb,
  p_items jsonb
)
returns table (saved_items integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_saved_items integer;
begin
  if v_user_id is null then
    raise exception using errcode = 'P0001', message = 'AUTH_REQUIRED';
  end if;

  if not exists (
    select 1
    from public.trip_members as member
    where member.trip_id = p_trip_id
      and member.user_id = v_user_id
  ) then
    raise exception using errcode = 'P0001', message = 'NOT_TRIP_MEMBER';
  end if;

  if nullif(btrim(p_destination), '') is null then
    raise exception using errcode = 'P0001', message = 'DESTINATION_REQUIRED';
  end if;

  if jsonb_typeof(p_places) <> 'array'
    or jsonb_array_length(p_places) = 0
    or jsonb_typeof(p_items) <> 'array'
    or jsonb_array_length(p_items) = 0 then
    raise exception using errcode = 'P0001', message = 'INVALID_ITINERARY';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_places) as place
    where nullif(btrim(place ->> 'externalPlaceId'), '') is null
      or nullif(btrim(place ->> 'name'), '') is null
      or place ->> 'latitude' is null
      or place ->> 'longitude' is null
      or jsonb_typeof(coalesce(place -> 'types', '[]'::jsonb)) <> 'array'
  ) then
    raise exception using errcode = 'P0001', message = 'INVALID_PLACE_DATA';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_items) as item
    where nullif(btrim(item ->> 'externalPlaceId'), '') is null
      or not exists (
        select 1
        from jsonb_array_elements(p_places) as place
        where place ->> 'externalPlaceId' = item ->> 'externalPlaceId'
      )
  ) then
    raise exception using errcode = 'P0001', message = 'UNKNOWN_PLACE_ID';
  end if;

  update public.trips
  set destination = btrim(p_destination)
  where id = p_trip_id;

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
    coalesce(
      array(
        select jsonb_array_elements_text(
          coalesce(place -> 'types', '[]'::jsonb)
        )
      ),
      '{}'::text[]
    ),
    jsonb_build_object('generationSource', 'phase2')
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
    types = excluded.types,
    metadata = excluded.metadata;

  delete from public.itinerary_items
  where trip_id = p_trip_id
    and generation_source = 'phase2';

  insert into public.itinerary_items (
    trip_id,
    place_id,
    day_number,
    sort_order,
    planned_time,
    estimated_cost,
    estimated_duration_minutes,
    reason,
    day_theme,
    status,
    generation_source
  )
  select
    p_trip_id,
    place.id,
    (item ->> 'day')::integer,
    (item ->> 'sortOrder')::integer,
    (item ->> 'plannedTime')::time,
    nullif(item ->> 'estimatedCost', '')::numeric,
    (item ->> 'estimatedDurationMinutes')::integer,
    nullif(btrim(item ->> 'reason'), ''),
    nullif(btrim(item ->> 'dayTheme'), ''),
    'planned',
    'phase2'
  from jsonb_array_elements(p_items) as item
  join public.places as place
    on place.trip_id = p_trip_id
   and place.external_place_id = item ->> 'externalPlaceId';

  get diagnostics v_saved_items = row_count;

  if v_saved_items <> jsonb_array_length(p_items) then
    raise exception using errcode = 'P0001', message = 'ITINERARY_SAVE_FAILED';
  end if;

  delete from public.places as place
  where place.trip_id = p_trip_id
    and place.metadata ->> 'generationSource' = 'phase2'
    and not exists (
      select 1
      from public.itinerary_items as item
      where item.place_id = place.id
        and item.trip_id = place.trip_id
    );

  return query select v_saved_items;
end;
$$;

revoke all on function public.replace_generated_itinerary(uuid, text, jsonb, jsonb)
  from public, anon, authenticated;
grant execute on function public.replace_generated_itinerary(uuid, text, jsonb, jsonb)
  to authenticated;
