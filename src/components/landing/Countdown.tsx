import { useEffect, useState } from 'react'

/**
 * Text-only countdown (DESIGN 9: no flip, no boxes). Seconds show only in the last 10 minutes,
 * so the clock ticks every second only then; otherwise it refreshes every 15s.
 */
const TEN_MIN = 10 * 60_000

export interface Remaining { done: boolean; ms: number; text: string }

const pad = (n: number) => String(n).padStart(2, '0')

/** 3d 04h 12m / 04h 12m / 9m 05s */
export function remaining(target: string | Date, now: Date = new Date()): Remaining {
  const ms = new Date(target).getTime() - now.getTime()
  if (!(ms > 0)) return { done: true, ms: 0, text: '' }
  const s = Math.floor(ms / 1000)
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60
  const text = d > 0 ? `${d}d ${pad(h)}h ${pad(m)}m` : ms >= TEN_MIN ? `${pad(h)}h ${pad(m)}m` : `${m}m ${pad(sec)}s`
  return { done: false, ms, text }
}

export function useRemaining(target: string): Remaining {
  const [now, setNow] = useState(() => new Date())
  const r = remaining(target, now)
  const fast = !r.done && r.ms < TEN_MIN + 15_000
  useEffect(() => {
    if (r.done) return
    const id = setInterval(() => setNow(new Date()), fast ? 1000 : 15_000)
    return () => clearInterval(id)
  }, [fast, r.done])
  return r
}
