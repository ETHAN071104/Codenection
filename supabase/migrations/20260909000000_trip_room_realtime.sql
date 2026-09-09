do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'trip_members'
  ) then
    alter publication supabase_realtime add table public.trip_members;
  end if;

  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'preference_profiles'
  ) then
    alter publication supabase_realtime add table public.preference_profiles;
  end if;
end;
$$;
