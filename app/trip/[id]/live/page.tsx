import { LiveTrip } from '@/components/live/live-trip';

export default async function LiveTripPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <LiveTrip tripId={id} />;
}
