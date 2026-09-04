create or replace function public.adjust_itinerary_schedule(
  p_trip_id uuid,
  p_day_number integer,
  p_current_item_id uuid,
  p_change_type text,
  p_minutes integer
)
returns table (item_id uuid, planned_time time without time zone)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_day_number is null or p_day_number < 1
    or p_minutes not in (15, 30, 60)
    or p_change_type not in ('stay_longer', 'running_late') then
    raise exception using errcode = 'P0001', message = 'INVALID_SCHEDULE_ADJUSTMENT';
  end if;

  if not private.is_trip_member(p_trip_id) then
    raise exception using errcode = 'P0001', message = 'TRIP_UNAVAILABLE';
  end if;

  if not exists (
    select 1 from public.itinerary_items as item
    where item.id = p_current_item_id and item.trip_id = p_trip_id
      and item.day_number = p_day_number and item.generation_source = 'phase2'
  ) then
    raise exception using errcode = 'P0001', message = 'INVALID_SCHEDULE_ADJUSTMENT';
  end if;

  return query
  with affected as (
    select item.id
    from public.itinerary_items as item
    where item.trip_id = p_trip_id and item.day_number = p_day_number
      and item.generation_source = 'phase2'
      and (
        item.sort_order > (select sort_order from public.itinerary_items where id = p_current_item_id)
        or (p_change_type = 'running_late' and item.id = p_current_item_id)
      )
  ), updated as (
    update public.itinerary_items as item
    set planned_time = item.planned_time + make_interval(mins => p_minutes)
    from affected
    where item.id = affected.id
    returning item.id, item.planned_time
  )
  select updated.id, updated.planned_time from updated;
end;
$$;

revoke all on function public.adjust_itinerary_schedule(uuid, integer, uuid, text, integer)
  from public, anon, authenticated;
grant execute on function public.adjust_itinerary_schedule(uuid, integer, uuid, text, integer)
  to authenticated;
