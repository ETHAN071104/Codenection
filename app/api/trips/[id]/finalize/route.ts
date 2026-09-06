import { getAuthenticatedSupabase } from '@/lib/supabase/server-auth';
import {
  hostOnlyResponse,
  phase2ErrorResponse,
  unauthorizedResponse,
} from '@/lib/phase2/api-error';

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const authenticated = await getAuthenticatedSupabase(request);
  if (!authenticated) return unauthorizedResponse();

  try {
    const { id } = await context.params;
    const { data, error } = await authenticated.supabase.rpc('finalize_trip', {
      p_trip_id: id,
    });
    if (error) {
      if (error.message.includes('TRIP_HOST_REQUIRED')) {
        return hostOnlyResponse();
      }
      throw error;
    }
    const result = data?.[0];
    if (!result) throw new Error('FINALIZATION_FAILED');
    return Response.json({
      finalizedAt: result.finalized_at,
      alreadyFinalized: result.already_finalized,
    });
  } catch (error) {
    return phase2ErrorResponse(error);
  }
}
