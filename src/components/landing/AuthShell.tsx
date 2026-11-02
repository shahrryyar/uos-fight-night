import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import Mark from './Mark'
import './landing.css'

/** Shared poster-style backdrop for /login and /join. */
export default function AuthShell({ kicker, title, children, footer }: { kicker: string; title: ReactNode; children: ReactNode; footer?: ReactNode }) {
  return (
    <div className="relative min-h-dvh overflow-hidden bg-ink">
      <div aria-hidden className="pointer-events-none absolute inset-0">
        <div className="absolute -left-24 -top-24 h-72 w-[140%] -rotate-12 bg-gradient-to-r from-red-dark via-red/70 to-transparent opacity-50 blur-2xl" />
        <div className="absolute -bottom-32 -right-24 h-72 w-[140%] -rotate-12 bg-gradient-to-l from-blue-dark via-blue/60 to-transparent opacity-40 blur-2xl" />
        <div className="ufn-spotlight" />
        <div className="ufn-grain" />
      </div>

      <div className="relative mx-auto flex min-h-dvh w-full max-w-md flex-col px-4 pb-10 pt-[max(1rem,env(safe-area-inset-top))]">
        <Link to="/" className="inline-flex min-h-11 items-center gap-2 self-start font-display text-xl tracking-wider">
          <Mark className="h-8 w-8" />
          <span>UOS <span className="text-red">FIGHT</span> <span className="text-gold">NIGHT</span></span>
        </Link>

        <div className="mt-8 ufn-rise">
          <p className="text-xs font-semibold uppercase tracking-[0.3em] text-gold">{kicker}</p>
          <h1 className="mt-1 font-display text-6xl leading-[0.9] tracking-wide">{title}</h1>
        </div>

        <div className="mt-6 rounded-2xl border border-line bg-surface/85 p-5 shadow-2xl backdrop-blur ufn-rise" style={{ ['--d' as string]: '90ms' }}>
          {children}
        </div>

        {footer && <div className="mt-6 text-center text-sm text-muted">{footer}</div>}
        <p className="mt-auto pt-10 text-center text-[11px] uppercase tracking-[0.2em] text-muted/70">Fun points only — no cash value</p>
      </div>
    </div>
  )
}
