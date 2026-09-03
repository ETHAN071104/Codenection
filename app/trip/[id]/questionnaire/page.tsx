import type { Metadata } from 'next';
import { QuestionnaireWizard } from '@/components/travel-dna/questionnaire-wizard';

export const metadata: Metadata = {
  title: 'Travel DNA',
  description: 'Set your private travel preferences for this trip.',
  robots: { index: false, follow: false },
};

export default async function QuestionnairePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <QuestionnaireWizard tripId={id} />;
}
