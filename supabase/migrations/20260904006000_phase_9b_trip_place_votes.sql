create table public.trip_place_votes (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips(id) on delete cascade,
  place_id uuid not null references public.malaysia_places(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  selected boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (trip_id, place_id, user_id)
);
create index trip_place_votes_trip_place_idx on public.trip_place_votes(trip_id, place_id);
create trigger trip_place_votes_set_updated_at before update on public.trip_place_votes for each row execute function public.set_updated_at();
alter table public.trip_place_votes enable row level security;
create policy "trip members read votes" on public.trip_place_votes for select to authenticated using (private.is_trip_member(trip_id));
create policy "members insert own votes" on public.trip_place_votes for insert to authenticated with check (user_id = auth.uid() and private.is_trip_member(trip_id));
create policy "members update own votes" on public.trip_place_votes for update to authenticated using (user_id = auth.uid() and private.is_trip_member(trip_id)) with check (user_id = auth.uid() and private.is_trip_member(trip_id));
create policy "members delete own votes" on public.trip_place_votes for delete to authenticated using (user_id = auth.uid() and private.is_trip_member(trip_id));
grant select, insert, update, delete on public.trip_place_votes to authenticated;
alter publication supabase_realtime add table public.trip_place_votes;
