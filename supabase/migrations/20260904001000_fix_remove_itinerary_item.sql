create or replace function public.remove_itinerary_item(
  p_trip_id uuid,
  p_item_id uuid
)
returns table (day_number integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_day_number integer;
  v_place_id uuid;
begin
  if not private.is_trip_member(p_trip_id) then
    raise exception using errcode = 'P0001', message = 'TRIP_UNAVAILABLE';
  end if;

  delete from public.itinerary_items as target
  where target.id = p_item_id
    and target.trip_id = p_trip_id
    and target.generation_source = 'phase2'
  returning target.day_number, target.place_id
  into v_day_number, v_place_id;

  if v_day_number is null then
    raise exception using errcode = 'P0001', message = 'ITEM_UNAVAILABLE';
  end if;

  with ordered as (
    select
      remaining.id,
      row_number() over (
        order by remaining.sort_order, remaining.created_at
      ) - 1 as next_order
    from public.itinerary_items as remaining
    where remaining.trip_id = p_trip_id
      and remaining.day_number = v_day_number
      and remaining.generation_source = 'phase2'
  )
  update public.itinerary_items as item
  set sort_order = ordered.next_order
  from ordered
  where item.id = ordered.id;

  delete from public.places as place
  where place.id = v_place_id
    and place.trip_id = p_trip_id
    and not exists (
      select 1
      from public.itinerary_items as item
      where item.place_id = place.id
    );

  return query select v_day_number;
end;
$$;

