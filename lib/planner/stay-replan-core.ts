export function isStayReplanPersistable({
  finalStatus,
  hasDesiredItinerary,
  overflowPlaceCount,
  desiredItemCount,
  existingItemCount,
}: {
  finalStatus: 'PASS' | 'REPAIRED' | 'FAIL';
  hasDesiredItinerary: boolean;
  overflowPlaceCount: number;
  desiredItemCount: number;
  existingItemCount: number;
}) {
  return (
    finalStatus !== 'FAIL' &&
    hasDesiredItinerary &&
    overflowPlaceCount === 0 &&
    desiredItemCount === existingItemCount
  );
}
