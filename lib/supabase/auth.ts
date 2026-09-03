import type { User } from '@supabase/supabase-js';
import { getSupabaseBrowserClient } from './client';

export async function ensureAnonymousUser(): Promise<User> {
  const supabase = getSupabaseBrowserClient();
  const { data: sessionData, error: sessionError } =
    await supabase.auth.getSession();

  if (sessionError) throw sessionError;
  if (sessionData.session?.user) return sessionData.session.user;

  const { data, error } = await supabase.auth.signInAnonymously();

  if (error || !data.user) {
    throw error ?? new Error('ANONYMOUS_AUTH_FAILED');
  }

  return data.user;
}
