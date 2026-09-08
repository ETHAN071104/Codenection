import 'server-only';

import { Phase2ProviderError, requestStructuredJson } from './openrouter';
import type { DestinationSuggestion, PlanningContext } from './types';
import { parseDestinationSuggestion } from './validation';

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

function destinationKey(value: string) {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
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
