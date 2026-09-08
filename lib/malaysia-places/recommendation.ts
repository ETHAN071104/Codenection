import type {
  GroupPreferenceSummary,
  InterestKey,
} from '@/lib/preferences/model';
import type { MalaysiaPlace } from './types';

const INTEREST_MATCHES: Array<{
  interest: InterestKey;
  field:
    | 'foodScore'
    | 'cultureScore'
    | 'natureScore'
    | 'photographyScore';
  reason: string;
  factualTypes: Set<string>;
}> = [
  {
    interest: 'food_dining',
    field: 'foodScore',
    reason: "Strong match for your group’s food interest.",
    factualTypes: new Set([
      'bakery',
      'cafe',
      'coffee_shop',
      'food_court',
      'meal_takeaway',
      'restaurant',
    ]),
  },
  {
    interest: 'history_heritage',
    field: 'cultureScore',
    reason: "Strong match for your group’s history and heritage interest.",
    factualTypes: new Set([
      'art_gallery',
      'church',
      'historical_landmark',
      'hindu_temple',
      'mosque',
      'museum',
      'place_of_worship',
    ]),
  },
  {
    interest: 'nature_viewpoints',
    field: 'natureScore',
    reason: "Strong match for your group’s nature interest.",
    factualTypes: new Set([
      'botanical_garden',
      'garden',
      'hiking_area',
      'national_park',
      'observation_deck',
      'park',
      'scenic_spot',
      'wildlife_park',
    ]),
  },
  {
    interest: 'instagrammable_cafes',
    field: 'photographyScore',
    reason: "Strong match for your group’s café and photography interest.",
    factualTypes: new Set([
      'bakery',
      'cafe',
      'coffee_shop',
      'observation_deck',
      'scenic_spot',
    ]),
  },
];

const PRICE_AFFORDABILITY: Record<string, number> = {
  PRICE_LEVEL_FREE: 5,
  PRICE_LEVEL_INEXPENSIVE: 4,
  PRICE_LEVEL_MODERATE: 3,
  PRICE_LEVEL_EXPENSIVE: 2,
  PRICE_LEVEL_VERY_EXPENSIVE: 1,
  FREE: 5,
  INEXPENSIVE: 4,
  MODERATE: 3,
  EXPENSIVE: 2,
  VERY_EXPENSIVE: 1,
};

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

function normalizedTypes(place: MalaysiaPlace) {
  return new Set(
    [place.category, ...place.subcategories]
      .filter((value): value is string => Boolean(value))
      .map((value) => value.trim().toLowerCase()),
  );
}

function interestFit(
  place: MalaysiaPlace,
  field: (typeof INTEREST_MATCHES)[number]['field'],
  factualTypes: Set<string>,
  types: Set<string>,
) {
  const explicit = place[field];
  if (explicit !== null) return clamp(explicit, 0, 5);
  return [...types].some((type) => factualTypes.has(type)) ? 5 : 2.5;
}

function affordabilityEvidence(place: MalaysiaPlace) {
  const evidence: number[] = [];
  if (place.budgetScore !== null) {
    evidence.push(clamp(place.budgetScore, 0, 5));
  }
  const priceLevel = place.priceLevel?.trim().toUpperCase();
  if (priceLevel && PRICE_AFFORDABILITY[priceLevel] !== undefined) {
    evidence.push(PRICE_AFFORDABILITY[priceLevel]);
  }
  return evidence.length
    ? evidence.reduce((sum, value) => sum + value, 0) / evidence.length
    : null;
}

function budgetFitScore(
  place: MalaysiaPlace,
  dna: GroupPreferenceSummary,
) {
  const affordability = affordabilityEvidence(place);
  if (affordability === null) return { score: 9, affordability: null };
  if (dna.finite_budget_average === null) {
    return { score: 9, affordability };
  }

  let pressure =
    dna.finite_budget_average <= 400
      ? 1
      : dna.finite_budget_average <= 800
        ? 0.6
        : 0;
  if (dna.unlimited_members > 0) pressure *= 0.75;
  return {
    score: clamp(9 + (affordability - 3) * 3 * pressure, 3, 15),
    affordability,
  };
}

/** Central deterministic Travel-DNA recommendation score. */
export function scoreMalaysiaPlace(
  place: MalaysiaPlace,
  dna: GroupPreferenceSummary,
) {
  const types = normalizedTypes(place);
  const matches = INTEREST_MATCHES.map((match) => ({
    ...match,
    preference: dna.average_interests[match.interest],
    fit: interestFit(place, match.field, match.factualTypes, types),
  }));
  const preferenceWeight = matches.reduce(
    (sum, match) => sum + match.preference,
    0,
  );
  const interestScore = preferenceWeight
    ? (matches.reduce(
        (sum, match) => sum + match.preference * match.fit,
        0,
      ) /
        (preferenceWeight * 5)) *
      55
    : 27.5;

  const ratingScore =
    place.googleRating === null
      ? 10
      : (clamp(place.googleRating, 0, 5) / 5) * 18;
  const reliabilityScore =
    place.googleRatingCount === null
      ? 2.5
      : Math.min(7, Math.log10(place.googleRatingCount + 1) * 1.75);
  const budget = budgetFitScore(place, dna);
  const geographicScore =
    (place.latitude !== null && place.longitude !== null ? 3 : 0) +
    (place.area ? 2 : 0);
  const score = Math.round(
    clamp(
      interestScore +
        ratingScore +
        reliabilityScore +
        budget.score +
        geographicScore,
      0,
      100,
    ),
  );

  const reasons = matches
    .filter((match) => match.preference >= 4 && match.fit >= 4)
    .sort(
      (a, b) =>
        b.preference * b.fit - a.preference * a.fit ||
        a.interest.localeCompare(b.interest),
    )
    .map((match) => match.reason);
  if (place.googleRating !== null && place.googleRating >= 4.4) {
    reasons.push('Highly rated with strong visitor feedback.');
  }
  if (
    dna.finite_budget_average !== null &&
    dna.finite_budget_average <= 500 &&
    budget.affordability !== null &&
    budget.affordability >= 4
  ) {
    reasons.push('Good fit for a lower-cost trip.');
  }
  if (reasons.length === 0) {
    reasons.push('Grounded place for this destination.');
  }
  return { score, reasons: Array.from(new Set(reasons)).slice(0, 3) };
}
