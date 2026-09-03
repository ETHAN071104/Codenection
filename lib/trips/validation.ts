export const DISPLAY_NAME_MAX_LENGTH = 80;

export function normalizeDisplayName(value: string) {
  return value.trim().replace(/\s+/g, ' ');
}

export function validateDisplayName(value: string) {
  const normalized = normalizeDisplayName(value);

  if (!normalized) return 'Enter your name to continue.';
  if (normalized.length > DISPLAY_NAME_MAX_LENGTH) {
    return `Keep your name under ${DISPLAY_NAME_MAX_LENGTH + 1} characters.`;
  }

  return null;
}

export function normalizeRoomCode(value: string) {
  return value.replace(/\D/g, '').slice(0, 6);
}

export function validateRoomCode(value: string) {
  return /^\d{6}$/.test(value) ? null : 'Enter the six-digit room code.';
}
