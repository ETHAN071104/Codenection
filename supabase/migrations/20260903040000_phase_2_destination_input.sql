alter table public.trips
  add column if not exists destination_input text;

grant update (destination_input)
  on public.trips
  to authenticated;
