export type PaceLevel = 1 | 2 | 3 | 4 | 5;

export type PaceMealWindow = {
  startMinutes: number;
  endMinutes: number;
  durationMinutes: number;
};

export type PaceProfile = {
  level: PaceLevel;
  label: 'Very Relaxed' | 'Relaxed' | 'Balanced' | 'Active' | 'Packed';
  earliestActivityMinutes: number;
  targetReturnMinutes: number;
  transitionBufferMultiplier: number;
  lunch: PaceMealWindow;
  dinner: PaceMealWindow;
};

const PACE_PROFILES: Record<PaceLevel, PaceProfile> = {
  1: {
    level: 1,
    label: 'Very Relaxed',
    earliestActivityMinutes: 11 * 60,
    targetReturnMinutes: 22 * 60,
    transitionBufferMultiplier: 1.3,
    lunch: {
      startMinutes: 13 * 60,
      endMinutes: 14 * 60 + 30,
      durationMinutes: 60,
    },
    dinner: {
      startMinutes: 19 * 60,
      endMinutes: 20 * 60 + 30,
      durationMinutes: 60,
    },
  },
  2: {
    level: 2,
    label: 'Relaxed',
    earliestActivityMinutes: 10 * 60 + 30,
    targetReturnMinutes: 21 * 60 + 30,
    transitionBufferMultiplier: 1.15,
    lunch: {
      startMinutes: 12 * 60 + 45,
      endMinutes: 14 * 60,
      durationMinutes: 60,
    },
    dinner: {
      startMinutes: 19 * 60,
      endMinutes: 20 * 60 + 15,
      durationMinutes: 60,
    },
  },
  3: {
    level: 3,
    label: 'Balanced',
    earliestActivityMinutes: 10 * 60,
    targetReturnMinutes: 21 * 60,
    transitionBufferMultiplier: 1,
    lunch: {
      startMinutes: 12 * 60 + 30,
      endMinutes: 13 * 60 + 30,
      durationMinutes: 60,
    },
    dinner: {
      startMinutes: 18 * 60 + 30,
      endMinutes: 19 * 60 + 30,
      durationMinutes: 60,
    },
  },
  4: {
    level: 4,
    label: 'Active',
    earliestActivityMinutes: 9 * 60 + 30,
    targetReturnMinutes: 21 * 60,
    transitionBufferMultiplier: 0.9,
    lunch: {
      startMinutes: 12 * 60 + 15,
      endMinutes: 13 * 60 + 15,
      durationMinutes: 60,
    },
    dinner: {
      startMinutes: 18 * 60 + 30,
      endMinutes: 19 * 60 + 30,
      durationMinutes: 60,
    },
  },
  5: {
    level: 5,
    label: 'Packed',
    earliestActivityMinutes: 9 * 60,
    targetReturnMinutes: 21 * 60,
    transitionBufferMultiplier: 0.8,
    lunch: {
      startMinutes: 12 * 60,
      endMinutes: 13 * 60,
      durationMinutes: 60,
    },
    dinner: {
      startMinutes: 18 * 60 + 30,
      endMinutes: 19 * 60 + 30,
      durationMinutes: 60,
    },
  },
};

export function derivePaceProfile(averagePace: number | null | undefined) {
  const level = (
    Number.isFinite(averagePace)
      ? Math.min(5, Math.max(1, Math.round(averagePace!)))
      : 3
  ) as PaceLevel;
  return PACE_PROFILES[level];
}
