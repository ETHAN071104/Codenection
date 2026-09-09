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
      'places',
      'ai_ready'
    )
  );
