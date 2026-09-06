import type { GroupPreferenceSummary } from '@/lib/preferences/model';
import type { MalaysiaPlace } from './types';

const INTEREST_MATCHES = [
  ['food_dining', 'foodScore', 'Strong food match'],
  ['history_heritage', 'cultureScore', 'Strong culture match'],
  ['nature_viewpoints', 'natureScore', 'Strong nature match'],
  ['instagrammable_cafes', 'photographyScore', 'Strong photography match'],
] as const;

export function scoreMalaysiaPlace(place: MalaysiaPlace, dna: GroupPreferenceSummary) {
  let weightedInterest = 0;
  let weight = 0;
  const reasons: string[] = [];
  for (const [interest, field, reason] of INTEREST_MATCHES) {
    const preference = dna.average_interests[interest];
    const placeScore = place[field];
    if (placeScore === null) continue;
    weightedInterest += preference * placeScore;
    weight += 25;
    if (preference >= 4 && placeScore >= 4) reasons.push(reason);
  }
  const interestScore = weight ? (weightedInterest / (weight * 25)) * 70 : 35;
  const popularityScore = place.googleRating === null ? 5 : (place.googleRating / 5) * 15;
  const reliabilityScore = place.googleRatingCount === null ? 0 : Math.min(10, Math.log10(place.googleRatingCount + 1) * 3);
  if (place.googleRating !== null && place.googleRating >= 4.4) reasons.push('Strong visitor rating');
  if (dna.finite_budget_average !== null && place.budgetScore !== null && place.budgetScore >= 3) reasons.push('Fits group budget');
  if (reasons.length === 0) reasons.push('Grounded place for this destination');
  return { score: Math.round(Math.min(100, interestScore + popularityScore + reliabilityScore)), reasons: reasons.slice(0, 3) };
}
