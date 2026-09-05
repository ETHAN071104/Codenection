export class Phase2ProviderError extends Error {
  constructor(public readonly code: 'OPENROUTER_UNAVAILABLE' | 'OPENROUTER_INVALID_RESPONSE' | 'GOOGLE_PLACES_UNAVAILABLE' | 'NO_PLACE_CANDIDATES') {
    super(code);
  }
}
