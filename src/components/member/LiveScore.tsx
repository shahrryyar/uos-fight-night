/**
 * Live score strip on a locked bout (CONTRACT B4 "Members"). Shown only while the referee's board is
 * live: the clock is running, or it was touched in the last 10 minutes. Reads get_live_score once for
 * the server clock, then follows live_scores over realtime and ticks the round clock locally.
 *   [LIVE]  Round 2                 1:24
 *   Laundry Day       3–1       Ramen Ronin
 * Ink stock (toner block) on paper, outlined on the wall. The score sentence is announced politely;
 * the clock is not (it would talk every second).
 */
import { useLiveFeed, useTicker, isLiveAt, remainingAt, fmtClock } from '../referee/live'
import { Stamp, cx } from '../ui'
import '../referee/live.css'

interface Props {
  fightId: string
  redName: string
  blueName: string
  /** printed on the wall (undercard row) instead of on paper */
  onInk?: boolean
}

export default function LiveScore({ fightId, redName, blueName, onInk }: Props) {
  const feed = useLiveFeed(fightId)
  const row = feed.row
  // tick every second while the clock runs; every 30s otherwise so the 10-minute window can close
  const now = useTicker(row?.running ? 1000 : 30_000, !!row) + feed.offset
  if (!row || !isLiveAt(row, now)) return null

  const left = remainingAt(row, now)
  const up = left <= 0
  const clock = up ? 'Time' : fmtClock(left)
  const state = up ? 'Time is up' : row.running ? `${fmtClock(left)} left` : `Paused at ${fmtClock(left)}`

  return (
    <section className={cx('live-strip', onInk && 'live-strip--ink')} aria-label="Live score">
      <div className="live-top">
        <Stamp tone="live" size="sm" rot={-3}>Live</Stamp>
        <span className="data live-round">Round <b>{row.round}</b></span>
        <span className={cx('live-clock', up && 'is-up', !row.running && !up && 'is-paused')}>
          {!row.running && !up && <span className="label">Paused</span>}
          <span className="live-time" role="timer" aria-label={state}>{clock}</span>
        </span>
      </div>
      <div className="live-score" aria-hidden="true">
        <span className="live-nm live-nm--red"><bdi>{redName}</bdi></span>
        <span className="live-pts">{row.red_score}<span className="dash">–</span>{row.blue_score}</span>
        <span className="live-nm live-nm--blue"><bdi>{blueName}</bdi></span>
      </div>
      <p className="sr-only" aria-live="polite" aria-atomic="true">
        Round {row.round}. {redName} {row.red_score}, {blueName} {row.blue_score}.
      </p>
    </section>
  )
}
