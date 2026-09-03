import type { Metadata } from 'next';
import { GroupSummary } from '@/components/travel-dna/group-summary';

export const metadata: Metadata = {
  title: 'Group summary',
  description: 'View the private aggregate Travel DNA for your group.',
  robots: { index: false, follow: false },
};

export default async function SummaryPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <GroupSummary tripId={id} />;
}
