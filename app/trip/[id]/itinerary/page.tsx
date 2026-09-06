import type { Metadata } from 'next';
import { ItineraryPlanner } from '@/components/itinerary/itinerary-planner';

export const metadata: Metadata = {
  title: 'Trip itinerary',
  description: 'View a grounded itinerary built from real Google places.',
  robots: { index: false, follow: false },
};

export default async function ItineraryPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ step?: string }>;
}) {
  const { id } = await params;
  const { step } = await searchParams;
  const initialStep =
    step === 'destination' ||
    step === 'scope' ||
    step === 'mode' ||
    step === 'result'
      ? step
      : null;
  return <ItineraryPlanner tripId={id} initialStep={initialStep} />;
}
