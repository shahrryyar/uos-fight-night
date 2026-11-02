import { poolOdds } from '../../lib/math'
import type { FightPool } from '../../lib/types'

const odds = (o: number | null) => (o == null ? '—' : `${o.toFixed(2)}x`)

/** Red vs blue points pool with live pari-mutuel odds and bettor counts. */
export default function PoolBar({ pool }: { pool: FightPool | null }) {
  const red = pool?.red_total ?? 0, blue = pool?.blue_total ?? 0
  const total = red + blue
  const redPct = total ? (red / total) * 100 : 50
  const o = poolOdds(red, blue)
  return (
    <div>
      <div className="flex items-baseline justify-between text-[11px] uppercase tracking-widest text-muted">
        <span>Points pool</span>
        <span className="font-display text-lg tracking-wider text-gold">{total.toLocaleString()} pts</span>
      </div>
      <div className="mt-1 flex h-3 overflow-hidden rounded-full bg-surface-2" aria-hidden>
        <div className="bg-red transition-[width] duration-500" style={{ width: `${redPct}%` }} />
        <div className="bg-blue flex-1" />
      </div>
      <div className="mt-1.5 grid grid-cols-2 text-xs">
        <div>
          <p className="font-semibold text-red tabular-nums">{red.toLocaleString()} pts · {odds(o.red)}</p>
          <p className="text-muted">{pool?.red_count ?? 0} backing</p>
        </div>
        <div className="text-right">
          <p className="font-semibold text-blue tabular-nums">{odds(o.blue)} · {blue.toLocaleString()} pts</p>
          <p className="text-muted">{pool?.blue_count ?? 0} backing</p>
        </div>
      </div>
    </div>
  )
}
