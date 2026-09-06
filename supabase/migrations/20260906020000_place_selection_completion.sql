create table public.trip_place_selection_members (
  trip_id uuid not null references public.trips(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  primary key (trip_id, user_id),
  foreign key (trip_id, user_id)
    references public.trip_members(trip_id, user_id)
    on delete cascade
);

create index trip_place_selection_members_trip_completion_idx
  on public.trip_place_selection_members(trip_id, completed_at);

alter table public.trip_place_selection_members enable row level security;

create policy "planning members read selection completion"
on public.trip_place_selection_members for select
to authenticated
using (private.is_trip_member(trip_id));

grant select on public.trip_place_selection_members to authenticated;

create or replace function public.start_place_selection_round(p_trip_id uuid)
returns table (planning_members integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_planning_members integer;
begin
  if v_user_id is null then
    raise exception using errcode = 'P0001', message = 'AUTH_REQUIRED';
  end if;

  if not exists (
    select 1
    from public.trips as trip
    where trip.id = p_trip_id
      and trip.created_by = v_user_id
      and trip.planning_mode = 'collaborative'
  ) then
    raise exception using errcode = 'P0001', message = 'TRIP_HOST_REQUIRED';
  end if;

  delete from public.trip_place_selection_members
  where trip_id = p_trip_id;

  insert into public.trip_place_selection_members (trip_id, user_id)
  select member.trip_id, member.user_id
  from public.trip_members as member
  where member.trip_id = p_trip_id;

  get diagnostics v_planning_members = row_count;
  return query select v_planning_members;
end;
$$;

create or replace function public.set_place_selection_completion(
  p_trip_id uuid,
  p_completed boolean
)
returns table (
  completed_members integer,
  planning_members integer,
  all_completed boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null then
    raise exception using errcode = 'P0001', message = 'AUTH_REQUIRED';
  end if;

  if not exists (
    select 1
    from public.trip_place_selection_members as participant
    where participant.trip_id = p_trip_id
      and participant.user_id = v_user_id
  ) then
    raise exception using errcode = 'P0001', message = 'NOT_PLANNING_MEMBER';
  end if;

  if not p_completed and not exists (
    select 1
    from public.trip_place_selection_members as participant
    where participant.trip_id = p_trip_id
      and participant.completed_at is null
  ) then
    raise exception using errcode = 'P0001', message = 'SELECTION_LOCKED';
  end if;

  update public.trip_place_selection_members
  set completed_at = case when p_completed then now() else null end
  where trip_id = p_trip_id
    and user_id = v_user_id;

  return query
  select
    count(*) filter (where participant.completed_at is not null)::integer,
    count(*)::integer,
    bool_and(participant.completed_at is not null)
  from public.trip_place_selection_members as participant
  where participant.trip_id = p_trip_id;
end;
$$;

create or replace function private.can_edit_trip_place_votes(p_trip_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.is_trip_member(p_trip_id)
    and (
      not exists (
        select 1
        from public.trip_place_selection_members as participant
        where participant.trip_id = p_trip_id
      )
      or (
        exists (
          select 1
          from public.trip_place_selection_members as own_status
          where own_status.trip_id = p_trip_id
            and own_status.user_id = auth.uid()
            and own_status.completed_at is null
        )
        and exists (
          select 1
          from public.trip_place_selection_members as participant
          where participant.trip_id = p_trip_id
            and participant.completed_at is null
        )
      )
    );
$$;

revoke all on function public.start_place_selection_round(uuid)
  from public, anon, authenticated;
revoke all on function public.set_place_selection_completion(uuid, boolean)
  from public, anon, authenticated;
revoke all on function private.can_edit_trip_place_votes(uuid)
  from public, anon, authenticated;
grant execute on function public.start_place_selection_round(uuid)
  to authenticated;
grant execute on function public.set_place_selection_completion(uuid, boolean)
  to authenticated;
grant execute on function private.can_edit_trip_place_votes(uuid)
  to authenticated;

drop policy if exists "members insert own votes" on public.trip_place_votes;
drop policy if exists "members update own votes" on public.trip_place_votes;
drop policy if exists "members delete own votes" on public.trip_place_votes;

create policy "planning members insert own votes"
on public.trip_place_votes for insert
to authenticated
with check (
  user_id = auth.uid()
  and private.can_edit_trip_place_votes(trip_id)
);

create policy "planning members update own votes"
on public.trip_place_votes for update
to authenticated
using (
  user_id = auth.uid()
  and private.can_edit_trip_place_votes(trip_id)
)
with check (
  user_id = auth.uid()
  and private.can_edit_trip_place_votes(trip_id)
);

create policy "planning members delete own votes"
on public.trip_place_votes for delete
to authenticated
using (
  user_id = auth.uid()
  and private.can_edit_trip_place_votes(trip_id)
);

alter publication supabase_realtime
  add table public.trip_place_selection_members;
