import type { Metadata } from 'next';
import { CandidatePlaces } from '@/components/candidate-places/candidate-places';

export const metadata: Metadata = {
  title: 'Suggested for your group',
  description: 'Review grounded places matched to your group’s Travel DNA.',
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
