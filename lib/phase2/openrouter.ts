import 'server-only';
import { Phase2ProviderError } from './provider-error';
export { Phase2ProviderError } from './provider-error';

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
export const DEFAULT_OPENROUTER_MODEL = 'openai/gpt-4o-mini';

type JsonSchema = Record<string, unknown>;

type OpenRouterOptions = {
  schemaName: string;
  schema: JsonSchema;
  system: string;
  prompt: string;
  maxTokens?: number;
};

export function getOpenRouterModel() {
  return process.env.OPENROUTER_MODEL?.trim() || DEFAULT_OPENROUTER_MODEL;
}

export async function requestStructuredJson({
  schemaName,
  schema,
  system,
  prompt,
  maxTokens = 2400,
}: OpenRouterOptions): Promise<unknown> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Phase2ProviderError('OPENROUTER_UNAVAILABLE');

  let response: Response;
  try {
    response = await fetch(OPENROUTER_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'http://localhost:3000',
        'X-Title': 'Collaborative Travel Planner',
      },
      body: JSON.stringify({
        model: getOpenRouterModel(),
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: prompt },
        ],
        temperature: 0.2,
        max_tokens: maxTokens,
        provider: { require_parameters: true },
        response_format: {
          type: 'json_schema',
          json_schema: {
            name: schemaName,
            strict: true,
            schema,
          },
        },
      }),
      cache: 'no-store',
    });
  } catch {
    throw new Phase2ProviderError('OPENROUTER_UNAVAILABLE');
  }

  if (!response.ok) {
    throw new Phase2ProviderError('OPENROUTER_UNAVAILABLE');
  }

  const payload = (await response.json()) as {
    choices?: { message?: { content?: unknown } }[];
  };
  const content = payload.choices?.[0]?.message?.content;
  if (typeof content !== 'string') {
    throw new Phase2ProviderError('OPENROUTER_INVALID_RESPONSE');
  }

  try {
    return JSON.parse(content) as unknown;
  } catch {
    throw new Phase2ProviderError('OPENROUTER_INVALID_RESPONSE');
  }
}
