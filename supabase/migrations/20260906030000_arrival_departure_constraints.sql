alter table public.trips
  add column if not exists arrival_time time without time zone,
  add column if not exists departure_time time without time zone,
  add column if not exists arrival_point jsonb,
  add column if not exists departure_point jsonb;

alter table public.trips
  drop constraint if exists trips_setup_stage_check,
  add constraint trips_setup_stage_check check (
    setup_stage in (
      'destination',
      'timing',
      'scope',
      'mode',
      'preparing',
      'collaborative_ready',
      'ai_ready'
    )
  ),
  add constraint trips_arrival_point_shape_check check (
    arrival_point is null or (
      jsonb_typeof(arrival_point) = 'object'
      and nullif(btrim(arrival_point ->> 'googlePlaceId'), '') is not null
      and nullif(btrim(arrival_point ->> 'name'), '') is not null
      and jsonb_typeof(arrival_point -> 'latitude') = 'number'
      and jsonb_typeof(arrival_point -> 'longitude') = 'number'
      and (arrival_point ->> 'latitude')::double precision between -90 and 90
      and (arrival_point ->> 'longitude')::double precision between -180 and 180
    )
  ),
  add constraint trips_departure_point_shape_check check (
    departure_point is null or (
      jsonb_typeof(departure_point) = 'object'
      and nullif(btrim(departure_point ->> 'googlePlaceId'), '') is not null
      and nullif(btrim(departure_point ->> 'name'), '') is not null
      and jsonb_typeof(departure_point -> 'latitude') = 'number'
      and jsonb_typeof(departure_point -> 'longitude') = 'number'
      and (departure_point ->> 'latitude')::double precision between -90 and 90
      and (departure_point ->> 'longitude')::double precision between -180 and 180
    )
  );

grant update (
  arrival_time,
  departure_time,
  arrival_point,
  departure_point
) on public.trips to authenticated;
