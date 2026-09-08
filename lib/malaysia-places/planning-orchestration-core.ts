import { clusterSelectedPlacesByDay } from './day-clustering-core';
import {
  createDeterministicDraftSchedule,
  type DeterministicDraftSchedule,
  type DeterministicScheduleConstraints,
} from './deterministic-scheduling-core';
import {
  persistIfFinalFeasible,
  validateFinalPlanningItinerary,
  type FinalFeasibilityResult,
} from './final-feasibility-core';
import type { RankedCandidate } from './group-ranking';
import type { RouteValidationStatus } from './route-validation-core';
import {
  normalizePhase9Itinerary,
  type Phase9ItineraryBridgePayload,
} from './itinerary-bridge-core';
import { recommendationSelectionPriority } from './selection-priority-core';
import { getStayAreaRecommendation } from './stay-area-core';
import { createSuggestedShortlist } from './suggested-shortlist-core';
import type { CandidatePlace } from './types';

export type PlanningIntelligenceSchedule = DeterministicDraftSchedule & {
  routeValidation?: RouteValidationStatus;
};

export type PlanningRouteValidator = (input: {
  grouping: ReturnType<typeof clusterSelectedPlacesByDay>;
  knownPlaces: RankedCandidate[];
  recommendedStayArea: string | null;
  constraints: DeterministicScheduleConstraints;
  schedule: DeterministicDraftSchedule;
}) => Promise<PlanningIntelligenceSchedule>;

export type PlanningIntelligencePlan = {
  stayArea: ReturnType<typeof getStayAreaRecommendation>;
  dayGroups: ReturnType<typeof clusterSelectedPlacesByDay>;
  draftSchedule: PlanningIntelligenceSchedule;
  finalValidation: FinalFeasibilityResult;
  desiredItinerary: Phase9ItineraryBridgePayload | null;
};

export function createAutomaticPlanningSelection(
  candidates: CandidatePlace[],
  options: {
    averagePace: number | null | undefined;
    durationDays: number | null | undefined;
    arrivalTime?: string | null;
    departureTime?: string | null;
  },
) {
  const shortlist = createSuggestedShortlist(candidates, options);
  const selectedById = new Map(
    shortlist.map((candidate, rank) => [
      candidate.id,
      {
        ...candidate,
        voteCount: 0,
        totalMembers: 0,
        currentUserSelected: false,
        groupScore: candidate.score,
        selectionPriority: recommendationSelectionPriority(rank),
      } satisfies RankedCandidate,
    ]),
  );
  const candidatePool: RankedCandidate[] = candidates.map(
    (candidate, rank) =>
      selectedById.get(candidate.id) ?? {
        ...candidate,
        voteCount: 0,
        totalMembers: 0,
        currentUserSelected: false,
        groupScore: candidate.score,
        selectionPriority: recommendationSelectionPriority(
          shortlist.length + rank,
        ),
      },
  );
  return {
    candidatePool,
    selected: shortlist.flatMap((candidate) => {
      const selected = selectedById.get(candidate.id);
      return selected ? [selected] : [];
    }),
  };
}

export async function createPlanningIntelligencePlan(input: {
  destination: string;
  durationDays: number;
  candidates: RankedCandidate[];
  selected: RankedCandidate[];
  constraints: DeterministicScheduleConstraints;
  routeValidator?: PlanningRouteValidator;
}): Promise<PlanningIntelligencePlan> {
  const stayArea = getStayAreaRecommendation(input.selected, input.candidates);
  const recommendedStayArea = stayArea.recommendedArea?.area ?? null;
  const dayGroups = clusterSelectedPlacesByDay(
    input.selected,
    input.durationDays,
    input.candidates,
    recommendedStayArea,
  );
  const localSchedule = createDeterministicDraftSchedule(
    dayGroups,
    input.candidates,
    recommendedStayArea,
    input.constraints,
  );
  const draftSchedule = input.routeValidator
    ? await input.routeValidator({
        grouping: dayGroups,
        knownPlaces: input.candidates,
        recommendedStayArea,
        constraints: input.constraints,
        schedule: localSchedule,
      })
    : localSchedule;
  const finalValidation = validateFinalPlanningItinerary({
    schedule: draftSchedule,
    selected: input.selected,
    candidates: input.candidates,
    recommendedStayArea,
    constraints: input.constraints,
  });
  const desiredItinerary =
    finalValidation.status !== 'FAIL' && draftSchedule.scheduledPlaceCount > 0
      ? normalizePhase9Itinerary({
          destination: input.destination,
          candidates: input.candidates,
          grouping: dayGroups,
          schedule: draftSchedule,
        })
      : null;

  return {
    stayArea,
    dayGroups,
    draftSchedule,
    finalValidation,
    desiredItinerary,
  };
}

export function geographicScopeForPlanningPlan(
  destination: string,
  plan: PlanningIntelligencePlan,
) {
  return {
    baseDestination: destination,
    days: plan.dayGroups.days.map((day) => ({
      day: day.day,
      area:
        day.places
          .map((place) => place.area?.trim())
          .find((area): area is string => Boolean(area)) ?? destination,
      mode: 'base' as const,
    })),
  };
}

export async function persistPlanningIntelligencePlan<Value>(
  plan: PlanningIntelligencePlan,
  persist: (desired: Phase9ItineraryBridgePayload) => PromiseLike<Value>,
) {
  const desiredItinerary = plan.desiredItinerary;
  if (!desiredItinerary) return { persisted: false as const };
  return persistIfFinalFeasible(plan.finalValidation, () =>
    persist(desiredItinerary),
  );
}
