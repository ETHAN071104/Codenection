import type { Metadata } from 'next';
import { MapPlanner } from '@/components/map/map-planner';

export const metadata: Metadata = {
  title: 'Trip map plan',
  description: 'View saved itinerary places on an interactive map.',
  robots: { index: false, follow: false },
};

export default async function PlanPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <MapPlanner tripId={id} />;
}
