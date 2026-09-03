-- Restore the authenticated execution grant required by the verified Phase 0
-- join flow. The live project had drifted from the committed migration state.
grant execute on function public.join_trip_by_code(text, text)
  to authenticated;
