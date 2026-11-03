import { adminError } from '../admin/ui'

/* Admin copy for the B7 refusals (API.md "New error codes"), falling back to the admin map. */
const SEASON_CODES: Record<string, string> = {
  CONFIRM_REQUIRED: 'Type END SEASON to confirm.',
  END_SEASON_CONFIRM: 'Type END SEASON to confirm.',
  INVALID_NAME: 'Give the new season a name (up to 40 characters).',
  NO_SEASON: 'No season is running.',
  FIGHTS_IN_PROGRESS: 'Settle or cancel open and locked fights first.',
  NOT_ADMIN: 'Only admins can end a season.',
}

export function seasonError(e: unknown): string {
  const raw = String((e as { message?: string })?.message ?? e ?? '')
  for (const tok of raw.match(/[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+/g) ?? []) if (SEASON_CODES[tok]) return SEASON_CODES[tok]
  return adminError(e)
}
