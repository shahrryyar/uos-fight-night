/**
 * After lock (DESIGN 11.3 locked, 11.6): crowd picks as a true split (no fake minimum width) and the
 * points picks list. The viewer's row is tinted with "(you)". Top 4, then "Show all N picks".
 * Settled: the amount column adds "+79 back" / "Came back" / "Lost".
 */
import { useId, useState } from 'react'
import { fmtNum } from '../../lib/copy'
import type { Bet, VoteTotals } from '../../lib/types'
import { Button, cx } from '../ui'
import { SplitBar } from './PoolBar'
import { sideWord } from './format'
import MemberName from '../MemberName'

interface Props {
  totals: VoteTotals | null
  bets: Bet[]
  names: Map<string, string>
  myId: string | undefined
  settled: boolean
  /** hide the crowd split (e.g. the settled sheet shows it inside "Who picked what") */
  crowd?: boolean
}

const TOP = 4

export function CrowdPicks({ totals }: { totals: VoteTotals | null }) {
  const id = useId()
  const rv = totals?.red_votes ?? 0, bv = totals?.blue_votes ?? 0
  return (
    <section className="blk" aria-labelledby={id}>
      <div className="blk-head"><h3 id={id} className="t-sub">Crowd picks</h3><span className="data">{rv + bv} picked</span></div>
      {rv + bv === 0
        ? <p className="pool-empty t-help">Nobody picked a winner for this one.</p>
        : <>
            <SplitBar red={rv} blue={bv} label={`${rv} picked red, ${bv} picked blue`} />
            <div className="pool-legend data"><p><b>{rv}</b> picked red</p><p><b>{bv}</b> picked blue</p></div>
          </>}
    </section>
  )
}

export default function LockedDetails({ totals, bets, names, myId, settled, crowd = true }: Props) {
  const id = useId()
  const [all, setAll] = useState(false)
  // your own row first, then biggest first
  const sorted = [...bets].sort((a, b) => Number(b.user_id === myId) - Number(a.user_id === myId) || b.amount - a.amount)
  const total = bets.reduce((s, b) => s + b.amount, 0)
  const shown = all ? sorted : sorted.slice(0, TOP)
  const result = (b: Bet) => b.status === 'won' ? `+${fmtNum(b.payout ?? 0)} back` : b.status === 'refunded' ? 'Came back' : b.status === 'lost' ? 'Lost' : ''

  return (
    <>
      {crowd && <CrowdPicks totals={totals} />}
      <section className="blk" aria-labelledby={id}>
        <div className="blk-head">
          <h3 id={id} className="t-sub">Points picks</h3>
          <span className="data"><b>{fmtNum(total)}&nbsp;pts</b> · {bets.length}</span>
        </div>
        {sorted.length === 0 ? (
          <p className="pool-empty t-help">Nobody put points on this one.</p>
        ) : (
          <>
            <ul className={cx('picks-list', settled && 'picks-list--settled')}>
              {shown.map(b => {
                const me = b.user_id === myId
                return (
                  <li key={b.id} className={me ? 'me' : undefined}>
                    <span className="who"><MemberName userId={b.user_id} name={names.get(b.user_id) ?? 'Member'} />{me && ' (you)'}</span>
                    <span className={`side-tag side-tag--${b.side}`}>{sideWord(b.side)}</span>
                    <span className="data"><b>{fmtNum(b.amount)}</b></span>
                    {settled && <span className="data res">{result(b)}</span>}
                  </li>
                )
              })}
            </ul>
            {sorted.length > TOP && (
              <Button variant="ghost" size="sm" className="w-full mt-2" aria-expanded={all} onClick={() => setAll(v => !v)}>
                {all ? 'Show fewer' : `Show all ${sorted.length} picks`}
              </Button>
            )}
          </>
        )}
      </section>
    </>
  )
}
