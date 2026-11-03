import { useState } from 'react'

export type RankScope = 'season' | 'all'

/** Fights needed for a rank in each view. */
export const RANK_NEED: Record<RankScope, number> = { season: 1, all: 3 }

const KEY = 'ranks-scope'
const read = (): RankScope => {
  try { return localStorage.getItem(KEY) === 'all' ? 'all' : 'season' } catch { return 'season' }
}

/** Remembered per viewer (a convenience, so localStorage is fine; it falls back to Season). */
export function useRankScope(): [RankScope, (s: RankScope) => void] {
  const [scope, set] = useState<RankScope>(read)
  return [scope, (s: RankScope) => { set(s); try { localStorage.setItem(KEY, s) } catch { /* private mode */ } }]
}

export interface ScopedRow {
  wins: number; losses: number; fights: number; ranked: boolean; rank: number | null
  season_wins: number; season_losses: number; season_fights: number; season_ranked: boolean; season_rank: number | null
}

/** Rewrites the record and rank fields to the chosen view, so the board's row markup stays as it is. */
export function scopeRows<T extends ScopedRow>(rows: T[], scope: RankScope): T[] {
  if (scope === 'all') return rows
  return rows.map(r => ({
    ...r,
    wins: r.season_wins ?? 0, losses: r.season_losses ?? 0, fights: r.season_fights ?? 0,
    ranked: !!r.season_ranked, rank: r.season_rank ?? null,
  }))
}

export const INTRO: Record<RankScope, string> = {
  season: 'This season, ranked by Elo. Everyone starts the season at 1,000. One fight gets you a rank.',
  all: "Records from every season. Rank still goes by this season's Elo. You need 3 fights to get a rank.",
}
