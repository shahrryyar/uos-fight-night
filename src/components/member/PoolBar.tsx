/**
 * Points pool (DESIGN 11.4). Every number is true, or it isn't shown:
 *   total 0      -> no bar, dashed empty note
 *   one side 0   -> bar is 100% the other colour, that side reads "No points yet"
 *   both > 0     -> true split, "10 in, 16 back" = floor(10 * total / side)
 * SplitBar is reused for the crowd-picks split after lock (LockedDetails).
 */
import { useId, type CSSProperties } from 'react'
import { fmtNum } from '../../lib/copy'
import type { FightPool } from '../../lib/types'
import { cx } from '../ui'

export function SplitBar({ red, blue, label }: { red: number; blue: number; label: string }) {
  const total = red + blue
  if (!total) return null
  const pct = Math.round((red / total) * 1000) / 10
  return (
    <div className="pool-bar" role="img" aria-label={label}>
      {red > 0 && <span className="r" style={{ '--w': blue > 0 ? `${pct}%` : '100%' } as CSSProperties} />}
      {blue > 0 && <span className={cx('b', red === 0 && 'b--solo')} />}
    </div>
  )
}

const back10 = (total: number, side: number) => Math.floor((10 * total) / side)

export default function PoolBar({ pool, onInk, className }: { pool: FightPool | null; onInk?: boolean; className?: string }) {
  const id = useId()
  const red = pool?.red_total ?? 0, blue = pool?.blue_total ?? 0
  const total = red + blue
  const members = (pool?.red_count ?? 0) + (pool?.blue_count ?? 0)
  const legend = (n: number, word: string) => n > 0
    ? <p><b>{fmtNum(n)}</b> on {word}<br /><span className="c-2">10 in, <span className="nowrap">{back10(total, n)} back</span></span></p>
    : <p className="c-2">No points yet<br />on {word}</p>
  return (
    <section className={cx('blk', onInk && 'blk--ink', className)} aria-labelledby={id}>
      <div className="blk-head">
        <h3 id={id} className="t-sub">Points pool</h3>
        <span className="data"><b>{fmtNum(total)}&nbsp;pts</b>{members > 0 && <> · <span className="nowrap">{members} {members === 1 ? 'member' : 'members'}</span></>}</span>
      </div>
      {total === 0 ? (
        <p className="pool-empty t-help">Nobody has put points in yet. Once both corners have points, the split and what each side pays back show here.</p>
      ) : (
        <>
          <SplitBar red={red} blue={blue} label={`Red corner ${fmtNum(red)} points, blue corner ${fmtNum(blue)} points`} />
          <div className="pool-legend data">{legend(red, 'red')}{legend(blue, 'blue')}</div>
        </>
      )}
    </section>
  )
}
