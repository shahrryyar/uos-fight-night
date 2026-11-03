/**
 * Leaderboard "Season / All-time" toggle (CONTRACT B7, API.md fighter_rankings).
 * Season = season_wins/season_losses, season_ranked (1+ fight this season), season_rank by the season Elo.
 * All-time = wins/losses, ranked (3+ fights), rank. `fighters.elo` is the season Elo in both views.
 *
 * Usage in a board: `const [scope, setScope] = useRankScope()`, render `<RankScopeToggle …/>` in place of
 * the intro line, then feed `scopeRows(rows, scope)` to the existing row code and use `RANK_NEED[scope]`.
 */
import { Link } from 'react-router-dom'
import { CaretRight, cx } from '../ui'
import { useCurrentSeasonName } from './useSeasons'
import { INTRO, type RankScope } from './rankScopeUtils'
import './season.css'

export type { RankScope }


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
