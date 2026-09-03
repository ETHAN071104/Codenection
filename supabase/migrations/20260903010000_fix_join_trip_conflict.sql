-- Fix PL/pgSQL ambiguity between the table's trip_id column and the RPC's
-- returned trip_id column by targeting the existing unique constraint by name.
create or replace function public.join_trip_by_code(
  p_room_code text,
  p_display_name text
)
returns table (trip_id uuid, room_code text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_display_name text := regexp_replace(btrim(p_display_name), '\s+', ' ', 'g');
  v_room_code text := btrim(p_room_code);
  v_trip_id uuid;
begin
  if v_user_id is null then
    raise exception using errcode = 'P0001', message = 'AUTH_REQUIRED';
  end if;

  if v_display_name is null
    or char_length(v_display_name) not between 1 and 80 then
    raise exception using errcode = 'P0001', message = 'INVALID_DISPLAY_NAME';
  end if;

  if v_room_code is null or v_room_code !~ '^[0-9]{6}$' then
    raise exception using errcode = 'P0001', message = 'INVALID_ROOM_CODE';
  end if;

  select trip.id
  into v_trip_id
  from public.trips as trip
  where trip.room_code = v_room_code;

  if v_trip_id is null then
    raise exception using errcode = 'P0001', message = 'ROOM_NOT_FOUND';
  end if;

  insert into public.trip_members (trip_id, user_id, display_name)
  values (v_trip_id, v_user_id, v_display_name)
  on conflict on constraint trip_members_trip_id_user_id_key
  do update set display_name = excluded.display_name;

  return query select v_trip_id, v_room_code;
end;
$$;

revoke all on function public.join_trip_by_code(text, text)
  from public, anon, authenticated;
grant execute on function public.join_trip_by_code(text, text)
  to authenticated;
