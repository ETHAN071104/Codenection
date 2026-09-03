import 'server-only';

import { Phase2ProviderError } from './openrouter';

const messages: Record<string, string> = {
  OPENROUTER_UNAVAILABLE:
    'The trip planner is temporarily unavailable. Please try again.',
  OPENROUTER_INVALID_RESPONSE:
    'The trip planner returned an incomplete plan. Please try again.',
  GOOGLE_PLACES_UNAVAILABLE:
    'Real place search is temporarily unavailable. Please try again.',
  NO_PLACE_CANDIDATES:
    'No suitable real places were found for this plan. Try again shortly.',
  QUESTIONNAIRE_NOT_READY:
    'Everyone must complete their Travel DNA before generating the trip.',
  DESTINATION_REQUIRED: 'Choose a destination before generating the trip.',
  INVALID_TRIP_DURATION: 'This trip needs a duration from 1 to 30 days.',
};

export function phase2ErrorResponse(error: unknown) {
  const code =
    error instanceof Phase2ProviderError
      ? error.code
      : error instanceof Error
        ? Object.keys(messages).find((token) => error.message.includes(token))
        : undefined;
  const status =
    code === 'QUESTIONNAIRE_NOT_READY' ||
    code === 'DESTINATION_REQUIRED' ||
    code === 'INVALID_TRIP_DURATION'
      ? 409
      : code === 'NO_PLACE_CANDIDATES'
        ? 422
        : code
          ? 502
          : 500;

  return Response.json(
    {
      error: {
        code: code ?? 'PHASE2_GENERATION_FAILED',
        message:
          (code ? messages[code] : null) ??
          'We could not prepare this trip. Please try again.',
      },
    },
    { status },
  );
}

export function unauthorizedResponse() {
  return Response.json(
    {
      error: { code: 'AUTH_REQUIRED', message: 'Please reconnect and retry.' },
    },
    { status: 401 },
  );
}

export function unavailableTripResponse() {
  return Response.json(
    {
      error: {
        code: 'TRIP_UNAVAILABLE',
        message: 'This trip is unavailable or you are not a member.',
      },
    },
    { status: 404 },
  );
}
