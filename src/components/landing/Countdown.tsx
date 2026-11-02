import { useEffect, useState } from 'react'
import { countdown } from '../../lib/math'

export function useNow(intervalMs = 1000) {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), intervalMs)
    return () => clearInterval(id)
  }, [intervalMs])
  return now
}

const pad = (n: number) => String(n).padStart(2, '0')

export default function Countdown({ target }: { target: string }) {
  const now = useNow(1000)
  const c = countdown(target, now)

  if (c.done) {
    return (
      <div className="flex items-center justify-center gap-3 rounded-xl border border-red/60 bg-red/10 py-4" role="status">
        <span className="ufn-pulse h-3 w-3 rounded-full bg-red" aria-hidden />
        <span className="font-display text-4xl tracking-wider text-bone">FIGHT TIME</span>
      </div>
    )
  }

  const units = [
    { k: 'd', v: c.days, label: 'Days' },
    { k: 'h', v: c.hours, label: 'Hrs' },
    { k: 'm', v: c.minutes, label: 'Min' },
    { k: 's', v: c.seconds, label: 'Sec' },
  ]
  return (
    <div className="grid grid-cols-4 gap-2" role="timer" aria-label={`Starts in ${c.label}`}>
      {units.map(u => (
        <div key={u.k} className="rounded-xl border border-line bg-surface/80 py-2.5 text-center">
          <div aria-hidden key={u.k === 's' ? u.v : undefined}
            className={`font-display text-[2.6rem] leading-none tabular-nums ${u.k === 's' ? 'ufn-tick text-gold' : 'text-bone'}`}>
            {pad(u.v)}
          </div>
          <div className="mt-1 text-[10px] font-semibold uppercase tracking-[0.2em] text-muted" aria-hidden>{u.label}</div>
        </div>
      ))}
    </div>
  )
}
