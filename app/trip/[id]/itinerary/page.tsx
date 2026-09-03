import type { Metadata } from 'next';
import { ItineraryPlanner } from '@/components/itinerary/itinerary-planner';

export const metadata: Metadata = {
  title: 'Trip itinerary',
  description: 'View a grounded itinerary built from real Google places.',
  robots: { index: false, follow: false },
};

export default async function ItineraryPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <ItineraryPlanner tripId={id} />;
}
