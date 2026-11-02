import type { Fight } from '../../lib/types'

export type CancelKind = 'cancelled' | 'no_contest' | 'declined'

/** fights row incl. Wave A columns (Addendum A, B2, B3). */
export type AdminFight = Fight & {
  red_weight_kg: number | null
  blue_weight_kg: number | null
  rounds: number | null
  red_score: number | null
  blue_score: number | null
  finish_move: string | null
  red_accepted_at: string | null
  blue_accepted_at: string | null
  cancel_kind: CancelKind | null
  bout_order: number
  is_main_event: boolean
  card_date: string
}

export const FINISH_MOVES = [
  'half nelson', 'headlock', 'cradle', 'arm bar', 'rear naked choke', 'body lock', 'cross face', 'double leg',
]

/** "84 kg" (no-break space, WIG units); "kg not set" when unknown. */
export const kgLabel = (n: number | null | undefined) => (n == null ? 'kg not set' : `${kgNum(n)} kg`)
export const kgNum = (n: number) => Number(n).toFixed(1).replace(/\.0$/, '')
