create or replace function private.valid_travel_dna_interests(p_interests jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(
    jsonb_typeof(p_interests) = 'object'
    and jsonb_typeof(p_interests -> 'food_dining') = 'number'
    and jsonb_typeof(p_interests -> 'history_heritage') = 'number'
    and jsonb_typeof(p_interests -> 'nature_viewpoints') = 'number'
    and jsonb_typeof(p_interests -> 'instagrammable_cafes') = 'number'
    and p_interests ->> 'food_dining' ~ '^[1-5]$'
    and p_interests ->> 'history_heritage' ~ '^[1-5]$'
    and p_interests ->> 'nature_viewpoints' ~ '^[1-5]$'
    and p_interests ->> 'instagrammable_cafes' ~ '^[1-5]$',
    false
  );
$$;

revoke all on function private.valid_travel_dna_interests(jsonb)
  from public, anon, authenticated;

alter table public.preference_profiles
  drop constraint if exists preference_profiles_phase_1_completion_check;

alter table public.preference_profiles
  add constraint preference_profiles_phase_1_completion_check check (
    completed_at is null
    or (
      (budget_unlimited or personal_budget is not null)
      and travel_pace between 1 and 5
      and private.valid_travel_dna_interests(interests)
    )
  );
