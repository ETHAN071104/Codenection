export function getFriendlyTripError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);

  if (message.includes('SUPABASE_NOT_CONFIGURED')) {
    return 'This app has not been connected to Supabase yet.';
  }
  if (message.includes('ROOM_NOT_FOUND')) {
    return 'We could not find that room code. Check it and try again.';
  }
  if (message.includes('INVALID_ROOM_CODE')) {
    return 'Enter a valid six-digit room code.';
  }
  if (message.includes('DISPLAY_NAME')) {
    return 'Enter a name between 1 and 80 characters.';
  }
  if (message.includes('AUTH_REQUIRED') || message.includes('ANONYMOUS_AUTH')) {
    return 'We could not start your private guest session. Please try again.';
  }

  return 'Something went wrong. Please try again in a moment.';
}
