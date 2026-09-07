alter table public.malaysia_places
  add column if not exists photo_name text,
  add column if not exists photo_width_px integer
    check (photo_width_px is null or photo_width_px > 0),
  add column if not exists photo_height_px integer
    check (photo_height_px is null or photo_height_px > 0),
  add column if not exists photo_attributions jsonb not null default '[]'::jsonb;

create index if not exists malaysia_places_photo_name_idx
  on public.malaysia_places(photo_name)
  where photo_name is not null;
