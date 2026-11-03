/** Shop + title request copy (C6). Fun points only; "Unlock" / "Spend points", never "Buy" with a currency. */
import { friendlyError } from '../../lib/supabase'
import type { ShopKind } from '../../lib/types'

/* Codes new in Wave C (lib/supabase.ts CODES does not know them yet, and its INVALID_KIND text is about
   cancelling fights). Checked first, then friendlyError. */
const CODES: Record<string, string> = {
  SITE_LOCKED: "We're down for maintenance. Check back later.",
  ITEM_NOT_FOUND: "That item isn't in the shop.",
  USE_TITLE_REQUEST: 'Request a custom title instead.',
  ALREADY_OWNED: 'You already have this.',
  NOT_OWNED: 'Unlock it first.',
  INVALID_KIND: 'Unknown item type.',
  INVALID_TITLE: 'Titles are 1 to 24 letters, numbers or simple punctuation.',
  TITLE_PENDING: 'Your title is waiting for an admin.',
  REQUEST_NOT_FOUND: 'That request is gone.',
  REQUEST_DECIDED: 'That request was already handled.',
  OWN_REQUEST: 'Another admin has to review your own request.',
  INVALID_REASON: 'Keep the reason under 200 characters.',
  INSUFFICIENT_POINTS: "You don't have enough points for that yet.",
}

export function shopError(e: unknown): string {
  const raw = String((e as { message?: string })?.message ?? e ?? '')
  for (const tok of raw.match(/[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+/g) ?? []) if (CODES[tok]) return CODES[tok]
  return friendlyError(e)
}

export const KIND_HEAD: Record<ShopKind, { title: string; help: string }> = {
  name_color: { title: 'Name colour', help: 'Your name in this ink on the ranks, the pick lists and your page.' },
  frame: { title: 'Frame', help: 'A nameplate drawn around your name.' },
  title: { title: 'Title', help: 'A short line that rides next to your name.' },
}
