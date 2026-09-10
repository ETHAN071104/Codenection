import 'server-only';

import { randomUUID } from 'node:crypto';
import { requestStructuredJson } from '@/lib/phase2/openrouter';
import {
  resolveStayPlace,
  searchPlannerPlaces,
} from '@/lib/phase2/google-places';
import type { ItineraryPageData } from '@/lib/phase2/types';
import type { AiEditOperation, AiEditProposal } from './types';
import { extractStayQuery } from './stay-intent-core';

const proposalSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['overview', 'operations'],
  properties: {
    overview: { type: 'string', minLength: 1, maxLength: 260 },
    operations: {
      type: 'array',
      minItems: 1,
      maxItems: 5,
      items: {
        type: 'object',
        additionalProperties: false,
        required: [
          'type',
          'itemId',
          'targetIndex',
          'query',
          'summary',
          'expectedEffect',
        ],
        properties: {
          type: { enum: ['remove', 'move', 'add', 'replace'] },
          itemId: { type: ['string', 'null'] },
          targetIndex: { type: ['integer', 'null'], minimum: 0 },
          query: { type: ['string', 'null'], maxLength: 120 },
          summary: { type: 'string', minLength: 1, maxLength: 180 },
          expectedEffect: {
            type: 'string',
            minLength: 1,
            maxLength: 180,
          },
        },
      },
    },
  },
} satisfies Record<string, unknown>;

type RawOperation = {
  type?: unknown;
  itemId?: unknown;
  targetIndex?: unknown;
  query?: unknown;
  summary?: unknown;
  expectedEffect?: unknown;
};

function cleanText(value: unknown, maxLength: number) {
  if (typeof value !== 'string') return null;
  const cleaned = value.trim().replace(/\s+/g, ' ');
  return cleaned && cleaned.length <= maxLength ? cleaned : null;
}

export class StayResolutionError extends Error {
  constructor(
    readonly code: 'STAY_AMBIGUOUS' | 'STAY_NOT_FOUND',
    message: string,
  ) {
    super(message);
  }
}

export async function proposeItineraryEdit({
  request,
  day,
  data,
}: {
  request: string;
  day: number;
  data: ItineraryPageData;
}): Promise<AiEditProposal> {
  const itineraryDay = data.itinerary?.days.find((entry) => entry.day === day);
  if (!itineraryDay || !data.itinerary) throw new Error('INVALID_DAY');

  const stayQuery = extractStayQuery(request);
  if (stayQuery) {
    const resolution = await resolveStayPlace(
      stayQuery,
      data.itinerary.destination,
    );
    if (resolution.status === 'not_found') {
      throw new StayResolutionError(
        'STAY_NOT_FOUND',
        `I couldn't find an accommodation matching “${stayQuery}”. Please check the hotel name.`,
      );
    }
    if (resolution.status === 'ambiguous') {
      const options = resolution.candidates
        .map((place) => place.name)
        .join(', ');
      throw new StayResolutionError(
        'STAY_AMBIGUOUS',
        `I found several possible stays: ${options}. Which one did you mean?`,
      );
    }
    return {
      request,
      overview: `Set your exact stay to ${resolution.place.name} and replan the trip around it.`,
      operations: [
        {
          id: randomUUID(),
          type: 'set_stay',
          day,
          itemId: null,
          targetIndex: null,
          summary: `Stay at ${resolution.place.name}`,
          expectedEffect: 'Replans daily routes around this exact stay.',
          place: resolution.place,
        },
      ],
    };
  }

  const response = (await requestStructuredJson({
    schemaName: 'itinerary_edit_proposal',
    schema: proposalSchema,
    system:
      'You propose concise structural edits to one day of a travel itinerary. Never invent a place. For add or replace, provide only a Google Places search query. The application recalculates all times automatically, so never use replace operations only to change a planned time. Do not directly apply changes. Preserve a practical day and return only the minimum operations needed, at most five.',
    prompt: JSON.stringify({
      request,
      destination: data.itinerary.destination,
      day,
      items: itineraryDay.items.map((item, index) => ({
        index,
        itemId: item.id,
        name: item.place.name,
        types: item.place.types,
        plannedTime: item.plannedTime,
        durationMinutes: item.estimatedDurationMinutes,
        estimatedCost: item.estimatedCost,
      })),
    }),
    maxTokens: 1400,
  })) as { overview?: unknown; operations?: RawOperation[] };

  const overview = cleanText(response.overview, 260);
  if (!overview || !Array.isArray(response.operations)) {
    throw new Error('OPENROUTER_INVALID_RESPONSE');
  }

  const currentItemIds = new Set(itineraryDay.items.map((item) => item.id));
  const existingPlaceIds = new Set(
    data.itinerary.days.flatMap((entry) =>
      entry.items.map((item) => item.place.externalPlaceId),
    ),
  );
  const operations: AiEditOperation[] = [];

  for (const raw of response.operations.slice(0, 5)) {
    if (
      raw.type !== 'remove' &&
      raw.type !== 'move' &&
      raw.type !== 'add' &&
      raw.type !== 'replace'
    ) {
      continue;
    }
    const summary = cleanText(raw.summary, 180);
    const expectedEffect = cleanText(raw.expectedEffect, 180);
    const itemId =
      typeof raw.itemId === 'string' && currentItemIds.has(raw.itemId)
        ? raw.itemId
        : null;
    const targetIndex = Number.isInteger(raw.targetIndex)
      ? Math.min(
          Math.max(Number(raw.targetIndex), 0),
          itineraryDay.items.length,
        )
      : null;
    if (!summary || !expectedEffect) continue;
    if (
      (raw.type === 'remove' ||
        raw.type === 'move' ||
        raw.type === 'replace') &&
      !itemId
    ) {
      continue;
    }
    if (raw.type === 'move' && targetIndex === null) continue;

    let place = null;
    if (raw.type === 'add' || raw.type === 'replace') {
      const query = cleanText(raw.query, 120);
      if (!query) continue;
      const candidates = await searchPlannerPlaces(
        query,
        data.itinerary.destination,
        3,
      );
      place =
        candidates.find(
          (candidate) =>
            raw.type === 'replace' ||
            !existingPlaceIds.has(candidate.externalPlaceId),
        ) ?? null;
      if (!place) continue;
      if (raw.type === 'replace' && itemId) {
        const existingItem = itineraryDay.items.find(
          (item) => item.id === itemId,
        );
        if (existingItem?.place.externalPlaceId === place.externalPlaceId) {
          continue;
        }
      }
      existingPlaceIds.add(place.externalPlaceId);
    }

    operations.push({
      id: randomUUID(),
      type: raw.type,
      day,
      itemId,
      targetIndex,
      summary,
      expectedEffect,
      place,
    });
  }

  if (operations.length === 0) {
    throw new Error('OPENROUTER_INVALID_RESPONSE');
  }
  return { request, overview, operations };
}
