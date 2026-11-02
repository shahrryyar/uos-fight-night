import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import type { PublicNextFight } from '../../lib/types'
import Countdown from './Countdown'

type State = { kind: 'loading' } | { kind: 'none' } | { kind: 'fight'; fight: PublicNextFight }

const TZ = 'Asia/Baghdad'
export function fmtFightTime(iso: string) {
  const d = new Date(iso)
  const day = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, weekday: 'short', day: 'numeric', month: 'short' }).format(d).replace(',', '')
  const time = new Intl.DateTimeFormat('en-US', { timeZone: TZ, hour: 'numeric', minute: '2-digit', hour12: true }).format(d)
  return `${day} · ${time}`
}

export function useNextFight() {
  const [state, setState] = useState<State>({ kind: 'loading' })
  useEffect(() => {
    let alive = true
    const load = async () => {
      const { data, error } = await supabase.rpc('public_next_fight')
      if (!alive) return
      const row = (Array.isArray(data) ? data[0] : data) as PublicNextFight | null | undefined
      if (error || !row || !row.id) setState({ kind: 'none' })
      else setState({ kind: 'fight', fight: row })
    }
    void load()
    // refresh occasionally so a fight that locks/settles while the page is open updates
    const id = setInterval(load, 60_000)
    return () => { alive = false; clearInterval(id) }
  }, [])
  return state
}

function CornerName({ corner, name, align }: { corner: 'Red' | 'Blue'; name: string; align: 'left' | 'right' }) {
  return (
    <div className={`max-w-[72%] ${align === 'right' ? 'ml-auto text-right' : ''}`}>
      <div className="text-[10px] font-semibold uppercase tracking-[0.3em] text-bone/80">{corner} corner</div>
      <div className="font-display text-[clamp(2.4rem,12vw,4.25rem)] leading-[0.88] tracking-wide text-bone break-words [text-shadow:0_4px_18px_rgba(0,0,0,.45)]">
        {name}
      </div>
    </div>
  )
}

function Matchup({ red, blue, dim = false }: { red: string; blue: string; dim?: boolean }) {
  return (
    <div className={`relative h-[19rem] overflow-hidden ${dim ? 'opacity-60 grayscale-[.4]' : ''}`}>
      <div className="ufn-slab-red absolute inset-0" aria-hidden />
      <div className="ufn-slab-blue absolute inset-0" aria-hidden />
      <svg className="absolute inset-0 h-full w-full" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden>
        <line x1="0" y1="64" x2="100" y2="42" stroke="#e3b341" strokeWidth={2} vectorEffect="non-scaling-stroke" />
      </svg>
      <div className="relative flex h-full flex-col justify-between p-5">
        <div className="ufn-rise" style={{ ['--d' as string]: '120ms' }}><CornerName corner="Red" name={red} align="left" /></div>
        <div className="ufn-rise" style={{ ['--d' as string]: '260ms' }}><CornerName corner="Blue" name={blue} align="right" /></div>
      </div>
      <div className="absolute left-1/2 top-[53%] -translate-x-1/2 -translate-y-1/2">
        <div className="ufn-slam grid h-20 w-20 -rotate-12 place-items-center rounded-full border-2 border-gold bg-ink shadow-[0_0_40px_rgba(227,179,65,.35)]"
          style={{ ['--d' as string]: '420ms' }}>
          <span className="ufn-vs font-display text-5xl leading-none pt-1">VS</span>
        </div>
      </div>
    </div>
  )
}

export default function NextFight() {
  const state = useNextFight()

  return (
    <section aria-labelledby="next-up" className="overflow-hidden rounded-2xl border border-line bg-ink shadow-[0_30px_80px_-30px_rgba(215,25,42,.45)]">
      <div className="flex items-center justify-between border-b border-line bg-surface px-4 py-3">
        <h2 id="next-up" className="font-display text-2xl tracking-[0.12em] text-gold">Next up</h2>
        {state.kind === 'fight' && <StatusPill status={state.fight.status} />}
      </div>

      {state.kind === 'loading' && (
        <div className="h-[19rem] animate-pulse bg-gradient-to-br from-red-dark/40 via-surface to-blue-dark/40" aria-label="Loading next fight" />
      )}

      {state.kind === 'none' && (
        <>
          <Matchup red="???" blue="???" dim />
          <div className="space-y-1 px-5 py-5 text-center">
            <p className="font-display text-4xl tracking-wider text-bone">Next fight night TBA</p>
            <p className="text-sm text-muted">The card drops when the admins book it. Stay ready.</p>
          </div>
        </>
      )}

      {state.kind === 'fight' && (
        <>
          <Matchup red={state.fight.red_nickname} blue={state.fight.blue_nickname} />
          <div className="space-y-4 px-4 py-5">
            <div className="text-center">
              {state.fight.title && (
                <p className="font-display text-3xl leading-none tracking-wider text-bone">{state.fight.title}</p>
              )}
              <p className="mt-1 text-sm font-medium text-muted">
                {fmtFightTime(state.fight.scheduled_at)} <span className="text-muted/70">(Baghdad)</span>
              </p>
            </div>
            <Countdown target={state.fight.scheduled_at} />
            <p className="text-center text-xs text-muted">
              {state.fight.status === 'open'
                ? <>Picks lock {fmtFightTime(state.fight.lock_at)}. Members only.</>
                : <>Picks are locked. Results land in the app.</>}
            </p>
          </div>
        </>
      )}
    </section>
  )
}

function StatusPill({ status }: { status: string }) {
  const open = status === 'open'
  return (
    <span className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-[11px] font-bold uppercase tracking-[0.18em] ${open ? 'border-gold/60 text-gold' : 'border-line text-muted'}`}>
      {open
        ? <span className="ufn-pulse h-2 w-2 rounded-full bg-gold" aria-hidden />
        : <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2.4" aria-hidden><rect x="5" y="11" width="14" height="9" rx="2" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></svg>}
      {open ? 'Picks open' : 'Picks locked'}
    </span>
  )
}
