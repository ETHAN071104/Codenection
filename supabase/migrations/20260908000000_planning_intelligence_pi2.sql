alter table public.malaysia_places
  add column if not exists opening_periods jsonb;

alter table public.malaysia_places
  add constraint malaysia_places_opening_periods_shape_check check (
    opening_periods is null or jsonb_typeof(opening_periods) = 'array'
  );
