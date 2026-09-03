import type { Json } from '@/lib/supabase/database.types';

export const BUDGET_MIN = 150;
export const BUDGET_MAX = 1200;
export const BUDGET_STEP = 50;
export const CUSTOM_BUDGET_MAX = 1_000_000;

export const PRESET_BUDGETS = Array.from(
  { length: (BUDGET_MAX - BUDGET_MIN) / BUDGET_STEP + 1 },
  (_, index) => BUDGET_MIN + index * BUDGET_STEP,
);

export const BUDGET_CUSTOM_POSITION = 0;
export const BUDGET_UNLIMITED_POSITION = PRESET_BUDGETS.length + 1;

export const PACE_LABELS = {
  1: 'Packed Explorer',
  2: 'Fast-Paced',
  3: 'Balanced',
  4: 'Chill Vacation',
  5: 'Ultra Relaxed',
} as const;

export const INTERESTS = [
  { key: 'food_dining', label: 'Street Food & Dining' },
  { key: 'history_heritage', label: 'Historical & Heritage' },
  { key: 'nature_viewpoints', label: 'Nature & Viewpoints' },
  { key: 'instagrammable_cafes', label: 'Instagrammable Cafes' },
] as const;

export type InterestKey = (typeof INTERESTS)[number]['key'];
export type InterestRatings = Record<InterestKey, number>;

export type QuestionnaireStatusRow = {
  member_id: string;
  display_name: string;
  completed: boolean;
  total_members: number;
  completed_members: number;
  all_completed: boolean;
};

export type GroupPreferenceSummary = {
  finite_budget_average: number | null;
  unlimited_members: number;
  average_pace: number;
  average_interests: InterestRatings;
};

export const EMPTY_INTEREST_RATINGS: InterestRatings = {
  food_dining: 0,
  history_heritage: 0,
  nature_viewpoints: 0,
  instagrammable_cafes: 0,
};

export function budgetForSliderPosition(position: number) {
  if (position <= BUDGET_CUSTOM_POSITION) return null;
  if (position >= BUDGET_UNLIMITED_POSITION) return null;
  return PRESET_BUDGETS[position - 1] ?? null;
}

export function sliderPositionForBudget(
  budget: number | null,
  unlimited: boolean,
) {
  if (unlimited) return BUDGET_UNLIMITED_POSITION;
  if (budget === null) return PRESET_BUDGETS.indexOf(500) + 1;

  const presetIndex = PRESET_BUDGETS.indexOf(budget);
  return presetIndex >= 0 ? presetIndex + 1 : BUDGET_CUSTOM_POSITION;
}

export function parseCustomBudget(value: string) {
  const normalized = value.trim();
  if (!/^\d+(?:\.\d{1,2})?$/.test(normalized)) return null;

  const budget = Number(normalized);
  if (!Number.isFinite(budget) || budget < 1 || budget > CUSTOM_BUDGET_MAX) {
    return null;
  }

  return Math.round(budget * 100) / 100;
}

export function isInterestRatings(value: Json): value is InterestRatings {
  if (!value || Array.isArray(value) || typeof value !== 'object') return false;

  return INTERESTS.every(({ key }) => {
    const rating = value[key];
    return (
      Number.isInteger(rating) && Number(rating) >= 1 && Number(rating) <= 5
    );
  });
}

export function parseAverageInterests(value: Json): InterestRatings | null {
  if (!value || Array.isArray(value) || typeof value !== 'object') return null;

  const entries = INTERESTS.map(
    ({ key }) => [key, Number(value[key])] as const,
  );
  if (
    entries.some(
      ([, rating]) => !Number.isFinite(rating) || rating < 1 || rating > 5,
    )
  ) {
    return null;
  }

  return Object.fromEntries(entries) as InterestRatings;
}

export function formatMyr(value: number) {
  return new Intl.NumberFormat('en-MY', {
    style: 'currency',
    currency: 'MYR',
    maximumFractionDigits: Number.isInteger(value) ? 0 : 2,
  }).format(value);
}

export function paceSummaryLabel(value: number) {
  if (value < 1.5) return 'Packed';
  if (value < 2.5) return 'Fast-paced';
  if (value < 3.5) return 'Balanced';
  if (value < 4.5) return 'Relaxed';
  return 'Ultra relaxed';
}

export function getPreferenceError(error: unknown) {
  const message =
    error &&
    typeof error === 'object' &&
    'message' in error &&
    typeof error.message === 'string'
      ? error.message
      : String(error);

  if (message.includes('QUESTIONNAIRE_NOT_READY')) {
    return 'The group summary will unlock when every traveller is ready.';
  }
  if (message.includes('NOT_TRIP_MEMBER')) {
    return 'This questionnaire is only available to members of this trip.';
  }
  if (message.includes('INVALID_BUDGET')) {
    return 'Choose a preset, enter a valid custom budget, or select no limit.';
  }
  if (message.includes('INVALID_TRAVEL_PACE')) {
    return 'Choose a travel pace from 1 to 5.';
  }
  if (message.includes('INVALID_INTERESTS')) {
    return 'Rate every interest from 1 to 5 stars.';
  }
  if (message.includes('AUTH_REQUIRED')) {
    return 'We could not verify your private guest session. Please try again.';
  }

  return 'We could not save your Travel DNA. Check your connection and try again.';
}
