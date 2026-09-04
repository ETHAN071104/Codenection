alter table public.trips
  add column if not exists exploration_preference text not null default 'nearby_day_trips',
  add column if not exists geographic_scope jsonb;

alter table public.trips
  drop constraint if exists trips_exploration_preference_check,
  add constraint trips_exploration_preference_check check (
    exploration_preference in ('stay_local', 'nearby_day_trips', 'explore_freely')
  );

grant update (exploration_preference, geographic_scope)
  on public.trips
  to authenticated;
