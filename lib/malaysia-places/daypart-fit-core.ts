import type { DayClusterSelection } from './day-clustering-core';
import type { PaceProfile } from './pace-profile-core';

export type PlanningDaypart =
  | 'morning'
  | 'lunch'
  | 'afternoon'
  | 'dinner'
  | 'evening';

export type MealType = 'breakfast' | 'lunch' | 'dinner';

export type PlaceTimingProfile = {
  preferredDayparts: PlanningDaypart[];
  mealTypes: MealType[];
  requiresMealWindow: boolean;
};

function evidence(place: DayClusterSelection) {
  return [place.category, ...place.subcategories]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
    .replaceAll('_', ' ');
}

function explicitDaypart(value: string | null): PlanningDaypart | null {
  const normalized = value?.trim().toLowerCase();
  return normalized === 'morning' ||
    normalized === 'lunch' ||
    normalized === 'afternoon' ||
    normalized === 'dinner' ||
    normalized === 'evening'
    ? normalized
    : null;
}

function unique<T>(values: T[]) {
  return [...new Set(values)];
}

export function classifyPlaceTiming(
  place: DayClusterSelection,
): PlaceTimingProfile {
  const text = evidence(place);
  const explicit = explicitDaypart(place.bestTimeOfDay);
  let preferredDayparts: PlanningDaypart[] = [];
  let mealTypes: MealType[] = [];
  let requiresMealWindow = false;

  if (/night market|nightlife|night club|bar\b/.test(text)) {
    preferredDayparts = ['dinner', 'evening'];
    if (/market|food|restaurant/.test(text)) {
      mealTypes = ['dinner'];
      requiresMealWindow = true;
    }
  } else if (/food court|hawker/.test(text)) {
    preferredDayparts = ['lunch', 'dinner'];
    mealTypes = ['lunch', 'dinner'];
    requiresMealWindow = true;
  } else if (/restaurant|dining/.test(text)) {
    preferredDayparts = ['lunch', 'dinner'];
    mealTypes = ['lunch', 'dinner'];
    requiresMealWindow = true;
  } else if (/cafe|coffee|bakery|breakfast|brunch/.test(text)) {
    preferredDayparts = ['morning', 'afternoon'];
    mealTypes = ['breakfast'];
  } else if (/temple|mosque|church|place of worship|shrine/.test(text)) {
    preferredDayparts = ['morning'];
  } else if (/museum|gallery|culture|cultural|heritage|historic/.test(text)) {
    preferredDayparts = ['morning', 'afternoon'];
  } else if (/viewpoint|observation|scenic|lookout/.test(text)) {
    preferredDayparts = ['afternoon', 'evening'];
  } else if (/shopping mall|shopping center|shopping centre|mall\b/.test(text)) {
    preferredDayparts = ['afternoon', 'evening'];
  } else if (/park|garden|outdoor|nature|trail/.test(text)) {
    preferredDayparts = ['morning', 'afternoon', 'evening'];
  }

  if (explicit) preferredDayparts = [explicit, ...preferredDayparts];
  if (!preferredDayparts.length) {
    preferredDayparts = ['morning', 'afternoon', 'evening'];
  }
  return {
    preferredDayparts: unique(preferredDayparts),
    mealTypes: unique(mealTypes),
    requiresMealWindow,
  };
}

export function daypartWindow(
  daypart: PlanningDaypart,
  profile: PaceProfile,
) {
  switch (daypart) {
    case 'morning':
      return { startMinutes: profile.earliestActivityMinutes, endMinutes: 12 * 60 };
    case 'lunch':
      return profile.lunch;
    case 'afternoon':
      return { startMinutes: 13 * 60, endMinutes: 18 * 60 };
    case 'dinner':
      return profile.dinner;
    case 'evening':
      return { startMinutes: 17 * 60 + 30, endMinutes: profile.targetReturnMinutes };
  }
}

export function daypartForTime(minutes: number, profile: PaceProfile) {
  if (minutes >= profile.dinner.startMinutes && minutes < profile.dinner.endMinutes) {
    return 'dinner' as const;
  }
  if (minutes >= 17 * 60 + 30) return 'evening' as const;
  if (minutes >= profile.lunch.startMinutes && minutes < profile.lunch.endMinutes) {
    return 'lunch' as const;
  }
  if (minutes >= 13 * 60) return 'afternoon' as const;
  return 'morning' as const;
}
