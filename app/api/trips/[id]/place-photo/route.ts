import { getAuthenticatedSupabase } from '@/lib/supabase/server-auth';
import {
  unavailableTripResponse,
  unauthorizedResponse,
} from '@/lib/phase2/api-error';

function photoUnavailableResponse() {
  return Response.json(
    {
      error: {
        code: 'PLACE_PHOTO_UNAVAILABLE',
        message: 'This place photo is unavailable.',
      },
    },
    { status: 404 },
  );
}

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const authenticated = await getAuthenticatedSupabase(request);
  if (!authenticated) return unauthorizedResponse();

  const { id } = await context.params;
  const photoName = new URL(request.url).searchParams.get('name')?.trim();
  if (!photoName?.startsWith('places/') || photoName.length > 500) {
    return photoUnavailableResponse();
  }

  const [{ data: membership, error: membershipError }, photoResult] =
    await Promise.all([
      authenticated.supabase
        .from('trip_members')
        .select('id')
        .eq('trip_id', id)
        .eq('user_id', authenticated.user.id)
        .maybeSingle(),
      authenticated.supabase
        .from('malaysia_places')
        .select('id')
        .eq('photo_name', photoName)
        .limit(1)
        .maybeSingle(),
    ]);
  if (membershipError) throw membershipError;
  if (!membership) return unavailableTripResponse();
  if (photoResult.error || !photoResult.data) return photoUnavailableResponse();

  const apiKey = process.env.GOOGLE_PLACES_API_KEY;
  if (!apiKey) return photoUnavailableResponse();
  const encodedName = photoName.split('/').map(encodeURIComponent).join('/');
  const response = await fetch(
    `https://places.googleapis.com/v1/${encodedName}/media?maxWidthPx=1200`,
    {
      headers: { 'X-Goog-Api-Key': apiKey },
      cache: 'no-store',
    },
  );
  const contentType = response.headers.get('content-type');
  if (!response.ok || !contentType?.startsWith('image/')) {
    return photoUnavailableResponse();
  }

  return new Response(response.body, {
    headers: {
      'Content-Type': contentType,
      'Cache-Control': 'private, max-age=86400',
    },
  });
}
