/**
 * Leaderboard "Season / All-time" toggle (CONTRACT B7, API.md fighter_rankings).
 * Season = season_wins/season_losses, season_ranked (1+ fight this season), season_rank by the season Elo.
 * All-time = wins/losses, ranked (3+ fights), rank. `fighters.elo` is the season Elo in both views.
 *
 * Usage in a board: `const [scope, setScope] = useRankScope()`, render `<RankScopeToggle …/>` in place of
 * the intro line, then feed `scopeRows(rows, scope)` to the existing row code and use `RANK_NEED[scope]`.
 */
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { CaretRight, cx } from '../ui'
import { useCurrentSeasonName } from './useSeasons'
import './season.css'

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

interface ScopedRow {
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

const INTRO: Record<RankScope, string> = {
  season: 'This season, ranked by Elo. Everyone starts the season at 1,000. One fight gets you a rank.',
  all: "Records from every season. Rank still goes by this season's Elo. You need 3 fights to get a rank.",
}

/** Two pressed buttons on ink (not tabs: it re-sorts the same list), then the matching intro line. */
export function RankScopeToggle({ value, onChange }: { value: RankScope; onChange: (s: RankScope) => void }) {
  const seasonName = useCurrentSeasonName()
  const opts: { id: RankScope; label: string }[] = [{ id: 'season', label: 'Season' }, { id: 'all', label: 'All-time' }]
  return (
    <>
      <div className="scope" role="group" aria-label="Which record to rank by">
        {opts.map(o => (
          <button key={o.id} type="button" className="scope-btn" aria-pressed={value === o.id} onClick={() => onChange(o.id)}>
            {o.label}
          </button>
        ))}
      </div>
      <p className="intro t-help" aria-live="polite">
        {value === 'season' && seasonName ? <><bdi>{seasonName}</bdi>, ranked by Elo. Everyone starts the season at 1,000. One fight gets you a rank.</> : INTRO[value]}
      </p>
    </>
  )
}

/** Header link from Ranks to the season history. */
export function SeasonsLink({ className }: { className?: string }) {
  return <Link to="/app/seasons" className={cx('seasons-link', className)}>Past seasons<CaretRight /></Link>
}
