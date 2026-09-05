-- Phase 9A: shared, curated candidate source. This deliberately does not alter
-- the trip-scoped public.places or itinerary_items tables.
create table public.malaysia_places (
  id uuid primary key default gen_random_uuid(),
  google_place_id text unique,
  name text not null check (char_length(btrim(name)) > 0),
  country text not null default 'Malaysia',
  state text,
  city text,
  area text,
  latitude double precision check (latitude is null or latitude between -90 and 90),
  longitude double precision check (longitude is null or longitude between -180 and 180),
  category text,
  subcategories text[] not null default '{}',
  estimated_duration_minutes integer check (estimated_duration_minutes is null or estimated_duration_minutes > 0),
  indoor_outdoor text check (indoor_outdoor is null or indoor_outdoor in ('indoor', 'outdoor', 'mixed')),
  best_time_of_day text,
  culture_score smallint check (culture_score is null or culture_score between 0 and 5),
  food_score smallint check (food_score is null or food_score between 0 and 5),
  nature_score smallint check (nature_score is null or nature_score between 0 and 5),
  shopping_score smallint check (shopping_score is null or shopping_score between 0 and 5),
  adventure_score smallint check (adventure_score is null or adventure_score between 0 and 5),
  nightlife_score smallint check (nightlife_score is null or nightlife_score between 0 and 5),
  photography_score smallint check (photography_score is null or photography_score between 0 and 5),
  budget_score smallint check (budget_score is null or budget_score between 0 and 5),
  google_rating numeric check (google_rating is null or google_rating between 0 and 5),
  google_rating_count integer check (google_rating_count is null or google_rating_count >= 0),
  price_level text,
  source text not null,
  last_verified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index malaysia_places_city_idx on public.malaysia_places (country, city);
create index malaysia_places_location_idx on public.malaysia_places (latitude, longitude);
create unique index malaysia_places_name_location_idx
  on public.malaysia_places (name, latitude, longitude)
  where google_place_id is null;

create trigger malaysia_places_set_updated_at
before update on public.malaysia_places
for each row execute function public.set_updated_at();

alter table public.malaysia_places enable row level security;
create policy "authenticated users can read malaysia places"
on public.malaysia_places for select to authenticated using (true);
revoke all on table public.malaysia_places from anon, authenticated;
grant select on table public.malaysia_places to authenticated;
