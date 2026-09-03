import type { Metadata } from 'next';
import { TripRoom } from './trip-room';

export const metadata: Metadata = {
  title: 'Trip room',
  description: 'View your private trip room and its members.',
  robots: { index: false, follow: false },
};

export default async function TripPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <TripRoom tripId={id} />;
}
