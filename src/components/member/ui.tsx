import type { ReactNode } from 'react'

export function PageTitle({ children, sub }: { children: ReactNode; sub?: ReactNode }) {
  return (
    <div className="mb-4">
      <h1 className="font-display text-4xl tracking-wider leading-none">{children}</h1>
      {sub && <p className="mt-1 text-sm text-muted">{sub}</p>}
    </div>
  )
}

export function Loading({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="py-16 grid place-items-center gap-3 text-muted" role="status">
      <div className="size-8 rounded-full border-2 border-line border-t-gold animate-spin" />
      <span className="font-display tracking-widest text-lg">{label}</span>
    </div>
  )
}

export function ErrorBox({ error, onRetry }: { error: string; onRetry?: () => void }) {
  return (
    <div className="rounded-xl border border-red/50 bg-red/10 p-4 text-sm" role="alert">
      <p className="text-bone">{error}</p>
      {onRetry && (
        <button onClick={onRetry} className="mt-3 min-h-11 rounded-lg border border-line px-4 font-semibold">
          Try again
        </button>
      )}
    </div>
  )
}

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <section className={`rounded-2xl border border-line bg-surface ${className}`}>{children}</section>
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="py-8 text-center text-sm text-muted">{children}</p>
}

/** Small "W3" / "L2" pill. */
export function StreakPill({ streak, label }: { streak: number; label: string }) {
  const tone = streak > 0 ? 'text-gold border-gold/40' : streak < 0 ? 'text-red border-red/40' : 'text-muted border-line'
  return <span className={`inline-flex items-center rounded px-1.5 py-0.5 text-[11px] font-bold border ${tone}`}>{label}</span>
}

export function Tabs<T extends string>({ value, onChange, tabs }: {
  value: T; onChange: (v: T) => void; tabs: { id: T; label: string }[]
}) {
  return (
    <div className="mb-4 grid gap-1 rounded-xl bg-surface p-1 border border-line" style={{ gridTemplateColumns: `repeat(${tabs.length}, minmax(0, 1fr))` }} role="tablist">
      {tabs.map(t => (
        <button key={t.id} role="tab" aria-selected={value === t.id} onClick={() => onChange(t.id)}
          className={`min-h-11 rounded-lg font-display text-xl tracking-wider ${value === t.id ? 'bg-surface-2 text-gold' : 'text-muted'}`}>
          {t.label}
        </button>
      ))}
    </div>
  )
}

export const NO_CASH = 'Fun points — no cash value'
