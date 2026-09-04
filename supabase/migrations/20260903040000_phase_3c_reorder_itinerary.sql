create or replace function public.reorder_itinerary_day(
  p_trip_id uuid,
  p_day_number integer,
  p_item_ids uuid[]
)
returns table (
  item_id uuid,
  sort_order integer
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_expected_count integer;
  v_matching_count integer;
  v_unique_count integer;
begin
  if p_day_number is null or p_day_number < 1 then
    raise exception using errcode = 'P0001', message = 'INVALID_DAY';
  end if;

  if coalesce(cardinality(p_item_ids), 0) = 0 then
    raise exception using errcode = 'P0001', message = 'INVALID_REORDER';
  end if;

  if not private.is_trip_member(p_trip_id) then
    raise exception using errcode = 'P0001', message = 'TRIP_UNAVAILABLE';
  end if;

  select count(*)
  into v_expected_count
  from public.itinerary_items as item
  where item.trip_id = p_trip_id
    and item.day_number = p_day_number
    and item.generation_source = 'phase2';

  select count(distinct ordered.item_id)
  into v_unique_count
  from unnest(p_item_ids) as ordered(item_id);

  select count(*)
  into v_matching_count
  from public.itinerary_items as item
  where item.trip_id = p_trip_id
    and item.day_number = p_day_number
    and item.generation_source = 'phase2'
    and item.id = any(p_item_ids);

  if v_unique_count <> cardinality(p_item_ids)
    or v_expected_count <> cardinality(p_item_ids)
    or v_matching_count <> v_expected_count then
    raise exception using errcode = 'P0001', message = 'INVALID_REORDER';
  end if;

  update public.itinerary_items as item
  set sort_order = ordered.ordinality - 1
  from unnest(p_item_ids) with ordinality as ordered(item_id, ordinality)
  where item.id = ordered.item_id
    and item.trip_id = p_trip_id
    and item.day_number = p_day_number
    and item.generation_source = 'phase2';

  return query
  select ordered.item_id, (ordered.ordinality - 1)::integer
  from unnest(p_item_ids) with ordinality as ordered(item_id, ordinality)
  order by ordered.ordinality;
end;
$$;

revoke all on function public.reorder_itinerary_day(uuid, integer, uuid[])
  from public, anon, authenticated;
grant execute on function public.reorder_itinerary_day(uuid, integer, uuid[])
  to authenticated;
