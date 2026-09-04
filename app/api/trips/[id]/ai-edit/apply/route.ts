import type { Json } from '@/lib/supabase/database.types';
import { getAuthenticatedSupabase } from '@/lib/supabase/server-auth';
import {
  phase2ErrorResponse,
  unauthorizedResponse,
  unavailableTripResponse,
} from '@/lib/phase2/api-error';
import { loadItineraryPageData } from '@/lib/phase2/storage';
import { getPlaceCandidateById } from '@/lib/phase2/google-places';
import { finalizePlannerDay } from '@/lib/planner/server';
import type { AiEditOperation, AiEditProposal } from '@/lib/planner/types';

function isOperation(value: unknown): value is AiEditOperation {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const operation = value as Partial<AiEditOperation>;
  return (
    typeof operation.id === 'string' &&
    (operation.type === 'remove' ||
      operation.type === 'move' ||
      operation.type === 'add' ||
      operation.type === 'replace') &&
    typeof operation.day === 'number' &&
    (operation.itemId === null || typeof operation.itemId === 'string') &&
    (operation.targetIndex === null ||
      (typeof operation.targetIndex === 'number' &&
        Number.isInteger(operation.targetIndex))) &&
    typeof operation.summary === 'string' &&
    typeof operation.expectedEffect === 'string' &&
    (operation.place === null ||
      (typeof operation.place === 'object' &&
        typeof operation.place.externalPlaceId === 'string'))
  );
}

function isProposal(value: unknown): value is AiEditProposal {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const proposal = value as Partial<AiEditProposal>;
  return (
    typeof proposal.request === 'string' &&
    typeof proposal.overview === 'string' &&
    Array.isArray(proposal.operations) &&
    proposal.operations.length > 0 &&
    proposal.operations.length <= 5 &&
    proposal.operations.every(isOperation)
  );
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const authenticated = await getAuthenticatedSupabase(request);
  if (!authenticated) return unauthorizedResponse();

  try {
    const { id } = await context.params;
    const body = (await request.json().catch(() => null)) as {
      proposal?: unknown;
    } | null;
    if (!isProposal(body?.proposal)) {
      return Response.json(
        {
          error: {
            code: 'INVALID_EDIT_PROPOSAL',
            message: 'This preview is no longer valid. Create a new preview.',
          },
        },
        { status: 400 },
      );
    }

    const proposal = body.proposal;
    const dayNumber = proposal.operations[0]?.day;
    if (
      !dayNumber ||
      proposal.operations.some((operation) => operation.day !== dayNumber)
    ) {
      throw new Error('INVALID_EDIT_PROPOSAL');
    }

    const data = await loadItineraryPageData(authenticated.supabase, id);
    const day = data?.itinerary?.days.find(
      (entry) => entry.day === dayNumber,
    );
    if (!data?.itinerary || !day) return unavailableTripResponse();

    const nextItems = day.items.map((item) => ({
      id: item.id,
      externalPlaceId: item.place.externalPlaceId,
      plannedTime: item.plannedTime,
      estimatedDurationMinutes: item.estimatedDurationMinutes,
      estimatedCost: item.estimatedCost,
      reason: item.reason,
    }));
    const groundedPlaces = [];

    for (const operation of proposal.operations) {
      const index = operation.itemId
        ? nextItems.findIndex((item) => item.id === operation.itemId)
        : -1;

      if (operation.type === 'remove') {
        if (index < 0) throw new Error('INVALID_EDIT_PROPOSAL');
        nextItems.splice(index, 1);
        continue;
      }

      if (operation.type === 'move') {
        if (index < 0 || operation.targetIndex === null) {
          throw new Error('INVALID_EDIT_PROPOSAL');
        }
        const [moved] = nextItems.splice(index, 1);
        if (!moved) throw new Error('INVALID_EDIT_PROPOSAL');
        nextItems.splice(
          Math.min(Math.max(operation.targetIndex, 0), nextItems.length),
          0,
          moved,
        );
        continue;
      }

      const externalPlaceId = operation.place?.externalPlaceId;
      if (!externalPlaceId) throw new Error('INVALID_EDIT_PROPOSAL');
      const grounded = await getPlaceCandidateById(externalPlaceId);
      groundedPlaces.push(grounded);

      if (operation.type === 'add') {
        if (
          nextItems.some(
            (item) => item.externalPlaceId === grounded.externalPlaceId,
          )
        ) {
          throw new Error('INVALID_EDIT_PROPOSAL');
        }
        const target =
          operation.targetIndex === null
            ? nextItems.length
            : Math.min(Math.max(operation.targetIndex, 0), nextItems.length);
        nextItems.splice(target, 0, {
          id: operation.id,
          externalPlaceId: grounded.externalPlaceId,
          plannedTime: '09:00',
          estimatedDurationMinutes: 60,
          estimatedCost: null,
          reason: operation.summary,
        });
        continue;
      }

      if (index < 0) throw new Error('INVALID_EDIT_PROPOSAL');
      nextItems[index] = {
        ...nextItems[index],
        externalPlaceId: grounded.externalPlaceId,
        reason: operation.summary,
      };
    }

    if (nextItems.length === 0 || nextItems.length > 12) {
      throw new Error('INVALID_EDIT_PROPOSAL');
    }

    const { data: saveRows, error: saveError } =
      await authenticated.supabase.rpc('replace_itinerary_day', {
        p_trip_id: id,
        p_day_number: dayNumber,
        p_items: nextItems as unknown as Json,
        p_places: groundedPlaces as unknown as Json,
      });
    if (saveError || Number(saveRows?.[0]?.saved_items) !== nextItems.length) {
      throw saveError ?? new Error('ITINERARY_SAVE_FAILED');
    }

    return Response.json(
      await finalizePlannerDay(authenticated.supabase, id, dayNumber),
    );
  } catch (error) {
    return phase2ErrorResponse(error);
  }
}
