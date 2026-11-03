import { friendlyError } from '../../lib/supabase'
import type { CardRecapFight } from '../../lib/types'

const FOTN_ERR: Record<string, string> = {
  FOTN_NOT_ELIGIBLE: 'That bout can’t be picked for Fight of the Night.',
  FOTN_NOT_OPEN: 'Fight of the Night voting opens when every bout is done.',
  FOTN_CLOSED: 'Fight of the Night voting has closed.',
  PARTICIPANT: 'You fought in that one. Vote for another bout.',
  FIGHT_NOT_FOUND: 'That bout is gone. Pull to refresh.',
  SITE_LOCKED: 'We’re down for maintenance. Check back later.',
}

export function fotnError(e: unknown): string {
  const msg = String((e as { message?: string })?.message ?? e ?? '')
  for (const [code, text] of Object.entries(FOTN_ERR)) if (msg.includes(code)) return text
  return friendlyError(e)
}

export const boutName = (f: Pick<CardRecapFight, 'is_main_event' | 'bout_order'>) =>
  f.is_main_event ? 'Main event' : `Bout ${f.bout_order}`

/** "21h 14m" / "42m" / "8m 12s" in the last ten minutes. */
export function closesIn(closesAt: string | null, now: Date): { label: string; done: boolean } {
  if (!closesAt) return { label: '', done: false }
  const ms = new Date(closesAt).getTime() - now.getTime()
  if (!(ms > 0)) return { label: 'now', done: true }
  const s = Math.floor(ms / 1000)
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60
  if (h > 0) return { label: `${h}h ${String(m).padStart(2, '0')}m`, done: false }
  if (s > 600) return { label: `${m}m`, done: false }
  return { label: `${m}m ${String(sec).padStart(2, '0')}s`, done: false }
}
