alter table public.trips
  add column if not exists planning_mode text,
  add column if not exists setup_stage text not null default 'destination';

alter table public.trips
  drop constraint if exists trips_planning_mode_check,
  add constraint trips_planning_mode_check check (
    planning_mode is null or planning_mode in ('collaborative', 'ai')
  ),
  drop constraint if exists trips_setup_stage_check,
  add constraint trips_setup_stage_check check (
    setup_stage in (
      'destination',
      'scope',
      'mode',
      'preparing',
      'collaborative_ready',
      'ai_ready'
    )
  );

update public.trips
set setup_stage = case
  when destination is null then 'destination'
  else 'scope'
end
where setup_stage = 'destination';

create or replace function private.is_trip_host(p_trip_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.trips as trip
    where trip.id = p_trip_id
      and trip.created_by = auth.uid()
  );
$$;

revoke all on function private.is_trip_host(uuid)
  from public, anon, authenticated;
grant execute on function private.is_trip_host(uuid) to authenticated;

drop policy if exists "members can update their trips" on public.trips;
drop policy if exists "trip hosts can update their trips" on public.trips;
create policy "trip hosts can update their trips"
on public.trips for update
to authenticated
using (private.is_trip_host(id) and private.is_trip_member(id))
with check (private.is_trip_host(id) and private.is_trip_member(id));

grant update (planning_mode, setup_stage) on public.trips to authenticated;

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'trips'
  ) then
    alter publication supabase_realtime add table public.trips;
  end if;
end;
$$;
