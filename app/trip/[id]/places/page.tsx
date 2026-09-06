import type { Metadata } from 'next';
import { CandidatePlaces } from '@/components/candidate-places/candidate-places';

export const metadata: Metadata = {
  title: 'Choose places',
  description: 'Choose grounded destination places together as a group.',
  robots: { index: false, follow: false },
};

export default async function CandidatePlacesPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <CandidatePlaces tripId={id} />;
}
