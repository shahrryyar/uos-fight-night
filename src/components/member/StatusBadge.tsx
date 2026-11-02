import type { FightStatus } from '../../lib/types'

const STYLE: Record<FightStatus, { label: string; cls: string }> = {
  scheduled: { label: 'Scheduled', cls: 'border-line text-muted' },
  open: { label: 'Picks open', cls: 'border-gold/60 text-gold' },
  locked: { label: 'Locked', cls: 'border-red/60 text-red' },
  settled: { label: 'Final', cls: 'border-bone/40 text-bone' },
  cancelled: { label: 'Cancelled', cls: 'border-line text-muted line-through' },
}

/** Status pill. `live` adds a pulsing dot (open fights). */
export default function StatusBadge({ status, lockedEarly }: { status: FightStatus; lockedEarly?: boolean }) {
  const s = lockedEarly && status === 'open' ? STYLE.locked : STYLE[status]
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-bold uppercase tracking-widest ${s.cls}`}>
      {status === 'open' && !lockedEarly && <span className="size-1.5 rounded-full bg-gold animate-pulse" aria-hidden />}
      {s.label}
    </span>
  )
}
