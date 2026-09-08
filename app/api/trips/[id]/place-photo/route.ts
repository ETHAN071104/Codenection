import { createServerClient } from '@supabase/ssr';
import { createClient } from '@supabase/supabase-js';
import { cookies } from 'next/headers';
import {
  refreshGooglePlacePhotoMetadata,
  resolveGooglePlacePhotoUrl,
} from '@/lib/malaysia-places/place-photo-server';
import {
  unavailableTripResponse,
  unauthorizedResponse,
} from '@/lib/phase2/api-error';
import type { Database } from '@/lib/supabase/database.types';
import {
  getAuthenticatedSupabase,
  type AuthenticatedSupabase,
} from '@/lib/supabase/server-auth';

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

async function getPhotoRequestAuth(
  request: Request,
): Promise<AuthenticatedSupabase | null> {
  const bearerAuth = await getAuthenticatedSupabase(request);
  if (bearerAuth) return bearerAuth;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !publishableKey) return null;

  const cookieStore = await cookies();
  const supabase = createServerClient<Database>(url, publishableKey, {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: () => undefined,
    },
  });
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) return null;
  return { supabase, user: data.user };
}

async function persistRefreshedPhoto(
  placeId: string,
  photo: Awaited<ReturnType<typeof refreshGooglePlacePhotoMetadata>>,
) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey || !photo) return;

  const serviceClient = createClient<Database>(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  await serviceClient
    .from('malaysia_places')
    .update({
      photo_name: photo.name,
      photo_width_px: photo.widthPx,
      photo_height_px: photo.heightPx,
      photo_attributions: photo.attributions,
    })
    .eq('id', placeId);
}

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const authenticated = await getPhotoRequestAuth(request);
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
        .select('id,google_place_id')
        .eq('photo_name', photoName)
        .limit(1)
        .maybeSingle(),
    ]);
  if (membershipError) throw membershipError;
  if (!membership) return unavailableTripResponse();
  if (photoResult.error || !photoResult.data) return photoUnavailableResponse();

  const apiKey = process.env.GOOGLE_PLACES_API_KEY;
  if (!apiKey) return photoUnavailableResponse();
  let photoUrl = await resolveGooglePlacePhotoUrl(photoName, apiKey);
  if (!photoUrl && photoResult.data.google_place_id) {
    const refreshedPhoto = await refreshGooglePlacePhotoMetadata(
      photoResult.data.google_place_id,
      apiKey,
    );
    if (refreshedPhoto) {
      photoUrl = await resolveGooglePlacePhotoUrl(refreshedPhoto.name, apiKey);
      if (photoUrl) {
        await persistRefreshedPhoto(photoResult.data.id, refreshedPhoto);
      }
    }
  }
  if (!photoUrl) return photoUnavailableResponse();

  return new Response(null, {
    status: 302,
    headers: {
      Location: photoUrl,
      'Cache-Control': 'private, max-age=3600',
      Vary: 'Cookie, Authorization',
    },
  });
}
