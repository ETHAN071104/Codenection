'use client';

import { ensureAnonymousUser } from '@/lib/supabase/auth';
import { getSupabaseBrowserClient } from '@/lib/supabase/client';

export class TripApiError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'TripApiError';
  }
}

export async function phase2Fetch<T>(
  url: string,
  init?: RequestInit,
): Promise<T> {
  await ensureAnonymousUser();
  const supabase = getSupabaseBrowserClient();
  const { data, error } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (error || !token) throw new Error('Please reconnect and retry.');

  const headers = new Headers(init?.headers);
  headers.set('Authorization', `Bearer ${token}`);
  if (init?.body) headers.set('Content-Type', 'application/json');

  const response = await fetch(url, { ...init, headers, cache: 'no-store' });
  const payload = (await response.json().catch(() => null)) as
    | T
    | { error?: { code?: string; message?: string } }
    | null;
  if (!response.ok) {
    const message =
      payload &&
      typeof payload === 'object' &&
      !Array.isArray(payload) &&
      'error' in payload &&
      payload.error?.message
        ? payload.error.message
        : 'We could not prepare this trip. Please try again.';
    const code =
      payload &&
      typeof payload === 'object' &&
      !Array.isArray(payload) &&
      'error' in payload &&
      payload.error?.code
        ? payload.error.code
        : 'TRIP_REQUEST_FAILED';
    throw new TripApiError(message, code, response.status);
  }
  return payload as T;
}
