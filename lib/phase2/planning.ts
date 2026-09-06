import 'server-only';

import {
  Phase2ProviderError,
  getOpenRouterModel,
  requestStructuredJson,
} from './openrouter';
import { findPlaceCandidates } from './google-places';
import type {
  DestinationSuggestion,
  GeographicScope,
  PersistedItineraryItem,
  PlanningContext,
} from './types';
import {
  parseDestinationSuggestion,
  parseGeographicScope,
  parseSelectedItinerary,
} from './validation';
import { applyTimeBoundariesToGeneratedItinerary } from './time-boundaries-core';

const destinationSchema = {
  type: 'object',
  properties: {
    destination: {
      type: 'string',
      minLength: 3,
      maxLength: 120,
      description: 'One city or compact region, including country.',
    },
    reason: {
      type: 'string',
      minLength: 12,
      maxLength: 320,
      description: 'A concise reason this destination fits the group.',
    },
    inputWasSpecific: {
      type: 'boolean',
      description:
        'True only when the geographic input already names a city or compact destination.',
    },
  },
  required: ['destination', 'reason', 'inputWasSpecific'],
  additionalProperties: false,
};

const geographicScopeSchema = {
  type: 'object',
  properties: {
    baseDestination: { type: 'string', minLength: 3, maxLength: 120 },
    days: {
      type: 'array',
      minItems: 1,
      maxItems: 30,
      items: {
        type: 'object',
        properties: {
          day: { type: 'integer', minimum: 1, maximum: 30 },
          area: { type: 'string', minLength: 3, maxLength: 120 },
          mode: { type: 'string', enum: ['base', 'day_trip'] },
        },
        required: ['day', 'area', 'mode'],
        additionalProperties: false,
      },
    },
  },
  required: ['baseDestination', 'days'],
  additionalProperties: false,
};

function itinerarySchema(durationDays: number, maxStopsPerDay: number) {
  return {
    type: 'object',
    properties: {
      days: {
        type: 'array',
        minItems: durationDays,
        maxItems: durationDays,
        items: {
          type: 'object',
          properties: {
            day: { type: 'integer', minimum: 1, maximum: durationDays },
            theme: { type: 'string', minLength: 3, maxLength: 100 },
            items: {
              type: 'array',
              minItems: 1,
              maxItems: maxStopsPerDay,
              items: {
                type: 'object',
                properties: {
                  externalPlaceId: { type: 'string', minLength: 1 },
                  estimatedDurationMinutes: {
                    type: 'integer',
                    minimum: 15,
                    maximum: 720,
                  },
                  estimatedCost: {
                    anyOf: [{ type: 'number', minimum: 0 }, { type: 'null' }],
                  },
                  reason: { type: 'string', minLength: 8, maxLength: 320 },
                },
                required: [
                  'externalPlaceId',
                  'estimatedDurationMinutes',
                  'estimatedCost',
                  'reason',
                ],
                additionalProperties: false,
              },
            },
          },
          required: ['day', 'theme', 'items'],
          additionalProperties: false,
        },
      },
    },
    required: ['days'],
    additionalProperties: false,
  };
}

function stopsForPace(averagePace: number) {
  if (averagePace <= 1.5) return 6;
  if (averagePace <= 2.5) return 5;
  if (averagePace <= 3.5) return 4;
  if (averagePace <= 4.5) return 4;
  return 3;
}

function destinationKey(value: string) {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function geographicSearches(context: PlanningContext, scope: GeographicScope) {
  const areas = Array.from(
    new Map(
      scope.days.map((day) => [day.area.toLocaleLowerCase(), day.area]),
    ).values(),
  ).slice(0, 4);

  return areas.map((area, index) => {
    const interest = context.topInterests[index % context.topInterests.length];
    return {
      query: interest ? `${interest.label} highlights` : 'essential sights',
      category: interest?.key ?? 'sights',
      desiredCount: 8,
      area,
    };
  });
}

export async function recommendDestination(context: {
  durationDays: number;
  finiteBudgetAverage: number | null;
  unlimitedMembers: number;
  averagePace: number;
  topInterests: PlanningContext['topInterests'];
  geographicScope: string | null;
  previousSuggestions: string[];
}): Promise<DestinationSuggestion> {
  const { geographicScope, previousSuggestions, ...groupContext } = context;
  const raw = await requestStructuredJson({
    schemaName: 'destination_suggestion',
    schema: destinationSchema,
    system:
      'You resolve one practical destination from an optional geographic preference. Return only the requested structured data. Never propose multiple destinations and never repeat an excluded destination.',
    prompt: `Resolve one destination for this request:\n${JSON.stringify({
      groupContext,
      geographicScope,
      previousSuggestions,
    })}\nIf geographicScope is null, recommend any suitable city or compact region. If it names a country, state, or broad region, choose a specific city or compact destination strictly inside it, include the geographicScope text in the destination label, and set inputWasSpecific to false. If it already names a city or compact destination, set inputWasSpecific to true; the server will preserve the user's exact input. Respect trip length, budget signal, pace, and strongest interests. Never return a destination in previousSuggestions.`,
    maxTokens: 500,
  });
  const parsed = parseDestinationSuggestion(raw);
  const excluded = new Set(previousSuggestions.map(destinationKey));
  const suggestion =
    parsed && geographicScope && parsed.inputWasSpecific
      ? { ...parsed, destination: geographicScope }
      : parsed;
  if (!suggestion) {
    throw new Phase2ProviderError('OPENROUTER_INVALID_RESPONSE');
  }
  if (excluded.has(destinationKey(suggestion.destination))) {
    throw new Phase2ProviderError('OPENROUTER_INVALID_RESPONSE');
  }
  if (
    geographicScope &&
    !suggestion.inputWasSpecific &&
    !suggestion.destination
      .toLocaleLowerCase()
      .includes(geographicScope.toLocaleLowerCase())
  ) {
    throw new Phase2ProviderError('OPENROUTER_INVALID_RESPONSE');
  }
  return suggestion;
}

export async function generateGroundedItinerary(context: PlanningContext) {
  const scopeRaw = await requestStructuredJson({
    schemaName: 'geographic_scope',
    schema: geographicScopeSchema,
    system:
      'Plan the geographic scope of one hotel-base itinerary. Return structured data only. Keep the supplied base destination unchanged. A day_trip is a same-day nearby excursion, never an overnight second base. Avoid impractical travel. Stay local means every day is base. Nearby day trips allows a sensible nearby excursion based on duration. Explore freely still uses one hotel base and only reasonable day trips. For 1 to 2 days keep all activities local. For 3 days use at most one nearby excursion. For 4 days one nearby day trip is normal. For 5 to 6 days allow one or two. For 7 or more days allow several only when practical. Pace 1 to 2 may cover broader nearby areas; pace 4 to 5 should remain calmer and more local. Use at most four distinct areas total.',
    prompt: `Plan the day-by-day geographic scope using only this trip context:\n${JSON.stringify({
      baseDestination: context.destination,
      durationDays: context.durationDays,
      pace: context.averagePace,
      budget: {
        finiteBudgetAverage: context.finiteBudgetAverage,
        unlimitedMembers: context.unlimitedMembers,
      },
      topInterests: context.topInterests,
      explorationPreference: context.explorationPreference,
    })}\nReturn exactly one entry for every numbered day.`,
    maxTokens: 900,
  });
  const parsedScope = parseGeographicScope(scopeRaw, context.durationDays);
  if (!parsedScope) {
    throw new Phase2ProviderError('OPENROUTER_INVALID_RESPONSE');
  }
  const geographicScope = {
    ...parsedScope,
    baseDestination: context.destination,
  };

  const { candidates, callCount: googlePlacesCalls } =
    await findPlaceCandidates(geographicSearches(context, geographicScope), context.destination);
  const maxStopsPerDay = stopsForPace(context.averagePace);
  const selectionRaw = await requestStructuredJson({
    schemaName: 'grounded_itinerary',
    schema: itinerarySchema(context.durationDays, maxStopsPerDay),
    system:
      'Arrange an itinerary using only the supplied Google Place candidate IDs. Never invent, alter, or autocomplete an externalPlaceId. Use each externalPlaceId at most once across the entire itinerary. Return structured data only.',
    prompt: `Arrange this aggregate group plan:\n${JSON.stringify({
      context,
      geographicScope,
      maxStopsPerDay,
      candidates,
    })}\nReturn exactly ${context.durationDays} numbered days. Use only externalPlaceId values from candidates, and never repeat one on another day. Keep each day realistic for the pace. Day 1 activities must start no earlier than arrivalTime when supplied. Final-day activities must finish no later than departureTime when supplied. Use fewer stops when those boundaries reduce capacity. Cost is an estimate: use null whenever confidence is low. Reasons should explain fit without claiming unverifiable facts.`,
    maxTokens: Math.min(7000, 1400 + context.durationDays * 550),
  });
  const itinerary = parseSelectedItinerary(
    selectionRaw,
    candidates,
    context.durationDays,
    maxStopsPerDay,
    geographicScope,
  );
  if (!itinerary) {
    throw new Phase2ProviderError('OPENROUTER_INVALID_RESPONSE');
  }

  const items: PersistedItineraryItem[] | null =
    applyTimeBoundariesToGeneratedItinerary(itinerary, context);
  if (!items) {
    throw new Phase2ProviderError('OPENROUTER_INVALID_RESPONSE');
  }
  const selectedIds = new Set(items.map((item) => item.externalPlaceId));
  const selectedPlaces = candidates.filter((candidate) =>
    selectedIds.has(candidate.externalPlaceId),
  );

  if (items.length === 0 || selectedPlaces.length === 0) {
    throw new Phase2ProviderError('OPENROUTER_INVALID_RESPONSE');
  }

  return {
    places: selectedPlaces,
    items,
    geographicScope,
    metrics: {
      model: getOpenRouterModel(),
      openRouterCalls: 2,
      googlePlacesCalls,
      candidateCount: candidates.length,
      persistedPlaceCount: selectedPlaces.length,
    },
  };
}
