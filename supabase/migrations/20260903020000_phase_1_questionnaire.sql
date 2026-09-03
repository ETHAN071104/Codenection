alter table public.preference_profiles
  add column if not exists budget_unlimited boolean not null default false,
  add column if not exists completed_at timestamptz;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'preference_profiles_phase_1_budget_check'
      and conrelid = 'public.preference_profiles'::regclass
  ) then
    alter table public.preference_profiles
      add constraint preference_profiles_phase_1_budget_check check (
        (not budget_unlimited or personal_budget is null)
        and (
          personal_budget is null
          or personal_budget between 1 and 1000000
        )
      );
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'preference_profiles_phase_1_completion_check'
      and conrelid = 'public.preference_profiles'::regclass
  ) then
    alter table public.preference_profiles
      add constraint preference_profiles_phase_1_completion_check check (
        completed_at is null
        or (
          (budget_unlimited or personal_budget is not null)
          and travel_pace between 1 and 5
          and jsonb_typeof(interests) = 'object'
          and interests ?& array[
            'food_dining',
            'history_heritage',
            'nature_viewpoints',
            'instagrammable_cafes'
          ]
          and interests ->> 'food_dining' ~ '^[1-5]$'
          and interests ->> 'history_heritage' ~ '^[1-5]$'
          and interests ->> 'nature_viewpoints' ~ '^[1-5]$'
          and interests ->> 'instagrammable_cafes' ~ '^[1-5]$'
        )
      );
  end if;
end;
$$;

create or replace function public.save_preference_profile(
  p_trip_id uuid,
  p_personal_budget numeric,
  p_budget_unlimited boolean,
  p_travel_pace integer,
  p_interests jsonb
)
returns table (completed_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_completed_at timestamptz := now();
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

  if p_budget_unlimited is null
    or (p_budget_unlimited and p_personal_budget is not null)
    or (
      not p_budget_unlimited
      and (
        p_personal_budget is null
        or p_personal_budget < 1
        or p_personal_budget > 1000000
      )
    ) then
    raise exception using errcode = 'P0001', message = 'INVALID_BUDGET';
  end if;

  if p_travel_pace is null or p_travel_pace not between 1 and 5 then
    raise exception using errcode = 'P0001', message = 'INVALID_TRAVEL_PACE';
  end if;

  if p_interests is null
    or jsonb_typeof(p_interests) <> 'object'
    or not p_interests ?& array[
      'food_dining',
      'history_heritage',
      'nature_viewpoints',
      'instagrammable_cafes'
    ]
    or p_interests ->> 'food_dining' !~ '^[1-5]$'
    or p_interests ->> 'history_heritage' !~ '^[1-5]$'
    or p_interests ->> 'nature_viewpoints' !~ '^[1-5]$'
    or p_interests ->> 'instagrammable_cafes' !~ '^[1-5]$' then
    raise exception using errcode = 'P0001', message = 'INVALID_INTERESTS';
  end if;

  insert into public.preference_profiles (
    trip_id,
    user_id,
    personal_budget,
    budget_unlimited,
    travel_pace,
    interests,
    completed_at
  ) values (
    p_trip_id,
    v_user_id,
    case when p_budget_unlimited then null else round(p_personal_budget, 2) end,
    p_budget_unlimited,
    p_travel_pace,
    p_interests,
    v_completed_at
  )
  on conflict on constraint preference_profiles_trip_id_user_id_key
  do update set
    personal_budget = excluded.personal_budget,
    budget_unlimited = excluded.budget_unlimited,
    travel_pace = excluded.travel_pace,
    interests = excluded.interests,
    completed_at = excluded.completed_at;

  return query select v_completed_at;
end;
$$;

create or replace function public.get_questionnaire_status(p_trip_id uuid)
returns table (
  member_id uuid,
  display_name text,
  completed boolean,
  total_members bigint,
  completed_members bigint,
  all_completed boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_total bigint;
  v_completed bigint;
begin
  if v_user_id is null then
    raise exception using errcode = 'P0001', message = 'AUTH_REQUIRED';
  end if;

  if not exists (
    select 1
    from public.trip_members as caller
    where caller.trip_id = p_trip_id
      and caller.user_id = v_user_id
  ) then
    raise exception using errcode = 'P0001', message = 'NOT_TRIP_MEMBER';
  end if;

  select count(*)
  into v_total
  from public.trip_members as member
  where member.trip_id = p_trip_id;

  select count(*)
  into v_completed
  from public.trip_members as member
  join public.preference_profiles as profile
    on profile.trip_id = member.trip_id
   and profile.user_id = member.user_id
  where member.trip_id = p_trip_id
    and profile.completed_at is not null;

  return query
  select
    member.id,
    member.display_name,
    profile.completed_at is not null,
    v_total,
    v_completed,
    v_total > 0 and v_completed = v_total
  from public.trip_members as member
  left join public.preference_profiles as profile
    on profile.trip_id = member.trip_id
   and profile.user_id = member.user_id
  where member.trip_id = p_trip_id
  order by member.joined_at;
end;
$$;

create or replace function public.get_group_preference_summary(p_trip_id uuid)
returns table (
  finite_budget_average numeric,
  unlimited_members bigint,
  average_pace numeric,
  average_interests jsonb
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_total bigint;
  v_completed bigint;
begin
  if v_user_id is null then
    raise exception using errcode = 'P0001', message = 'AUTH_REQUIRED';
  end if;

  if not exists (
    select 1
    from public.trip_members as caller
    where caller.trip_id = p_trip_id
      and caller.user_id = v_user_id
  ) then
    raise exception using errcode = 'P0001', message = 'NOT_TRIP_MEMBER';
  end if;

  select count(*)
  into v_total
  from public.trip_members as member
  where member.trip_id = p_trip_id;

  select count(*)
  into v_completed
  from public.trip_members as member
  join public.preference_profiles as profile
    on profile.trip_id = member.trip_id
   and profile.user_id = member.user_id
  where member.trip_id = p_trip_id
    and profile.completed_at is not null;

  if v_total = 0 or v_completed <> v_total then
    raise exception using errcode = 'P0001', message = 'QUESTIONNAIRE_NOT_READY';
  end if;

  return query
  select
    round(avg(profile.personal_budget)
      filter (where not profile.budget_unlimited), 2),
    count(*) filter (where profile.budget_unlimited),
    round(avg(profile.travel_pace), 2),
    jsonb_build_object(
      'food_dining', round(avg((profile.interests ->> 'food_dining')::numeric), 2),
      'history_heritage', round(avg((profile.interests ->> 'history_heritage')::numeric), 2),
      'nature_viewpoints', round(avg((profile.interests ->> 'nature_viewpoints')::numeric), 2),
      'instagrammable_cafes', round(avg((profile.interests ->> 'instagrammable_cafes')::numeric), 2)
    )
  from public.trip_members as member
  join public.preference_profiles as profile
    on profile.trip_id = member.trip_id
   and profile.user_id = member.user_id
  where member.trip_id = p_trip_id;
end;
$$;

revoke all on function public.save_preference_profile(uuid, numeric, boolean, integer, jsonb)
  from public, anon, authenticated;
revoke all on function public.get_questionnaire_status(uuid)
  from public, anon, authenticated;
revoke all on function public.get_group_preference_summary(uuid)
  from public, anon, authenticated;

grant execute on function public.save_preference_profile(uuid, numeric, boolean, integer, jsonb)
  to authenticated;
grant execute on function public.get_questionnaire_status(uuid)
  to authenticated;
grant execute on function public.get_group_preference_summary(uuid)
  to authenticated;

revoke insert on table public.preference_profiles from authenticated;
revoke update (personal_budget, travel_pace, interests)
  on table public.preference_profiles from authenticated;
