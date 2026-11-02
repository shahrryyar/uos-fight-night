import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../lib/auth'
import Mark from '../components/landing/Mark'
import NextFight from '../components/landing/NextFight'
import ShareButton from '../components/landing/ShareButton'
import '../components/landing/landing.css'

const steps = [
  { n: '1', t: 'Pick your fighter', d: 'Call the winner of every bout before picks lock. Change your mind any time until then.' },
  { n: '2', t: 'Bet fun points', d: 'Start with 1,000 points and get +100 every Monday. Back your pick from a shared pool and watch the odds move live.' },
  { n: '3', t: 'Climb the ranks', d: 'Top the points board, or step on the mat and build your record and Elo rating.' },
]

const rules = [
  ['Tap = stop.', 'The second someone taps or says stop, it ends. No exceptions.'],
  ["Referee's call is final.", 'No arguing with the ref, on the mat or in the group chat.'],
  ['No strikes.', 'Wrestling only. No punches, kicks, slaps or elbows.'],
  ['Everyone opts in.', 'Nobody gets pushed into a fight. Saying no is always fine.'],
  ['18+ only.', 'Every fighter and every member is an adult.'],
] as const

const SHARE_TEXT = 'UoS Fight Night: dorm wrestling, real records, fun points. Got an invite? Pick your fighter.'

function Cta({ to, children, variant }: { to: string; children: ReactNode; variant: 'primary' | 'ghost' }) {
  const base = 'flex min-h-14 items-center justify-center rounded-xl px-6 font-display text-2xl tracking-[0.12em] transition active:scale-[0.98]'
  const styles = variant === 'primary'
    ? 'bg-red text-bone shadow-[0_14px_40px_-12px_rgba(215,25,42,.9)] hover:bg-[#e52536]'
    : 'border border-bone/25 bg-ink/40 text-bone backdrop-blur hover:border-bone/50'
  return <Link to={to} className={`${base} ${styles}`}>{children}</Link>
}

export default function Landing() {
  const { session } = useAuth()

  return (
    <div className="relative min-h-dvh overflow-x-clip bg-ink text-bone">
      <title>UoS Fight Night</title>

      {/* ───────── HERO ───────── */}
      <header className="relative isolate overflow-hidden">
        <div aria-hidden className="pointer-events-none absolute inset-0 -z-10">
          {/* diagonal red vs blue corners */}
          <div className="absolute inset-0 bg-[linear-gradient(118deg,rgba(215,25,42,.55)_0%,rgba(143,15,27,.35)_32%,transparent_46%,transparent_58%,rgba(23,63,128,.35)_70%,rgba(42,111,219,.5)_100%)]" />
          <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_50%_115%,#0b0b0d_35%,transparent_75%)]" />
          <div className="ufn-spotlight" />
          <div className="absolute inset-x-0 bottom-0 h-40 bg-gradient-to-b from-transparent to-ink" />
          <div className="ufn-grain" />
        </div>

        <nav className="mx-auto flex max-w-2xl items-center justify-between px-4 pt-[max(.75rem,env(safe-area-inset-top))]">
          <span className="inline-flex min-h-11 items-center gap-2">
            <Mark className="h-9 w-9" />
            <span className="sr-only">UoS Fight Night</span>
          </span>
          {session
            ? <Link to="/app" className="inline-flex min-h-11 items-center rounded-lg px-3 text-sm font-semibold text-gold">Enter the arena →</Link>
            : <Link to="/login" className="inline-flex min-h-11 items-center rounded-lg px-3 text-sm font-semibold text-bone/90 hover:text-bone">Log in</Link>}
        </nav>

        <div className="mx-auto max-w-2xl px-4 pb-16 pt-10 text-center">
          <p className="ufn-rise text-[11px] font-semibold uppercase tracking-[0.35em] text-gold">Members-only dorm league</p>
          <h1 className="mt-4 font-display leading-[0.8]">
            <span className="ufn-rise block text-[clamp(3rem,16vw,5.5rem)] tracking-[0.28em] text-bone pl-[0.28em]" style={{ ['--d' as string]: '60ms' }}>UOS</span>
            <span className="ufn-slam ufn-title-red block text-[clamp(6.5rem,36vw,13rem)] tracking-wide text-red" style={{ ['--d' as string]: '160ms' }}>FIGHT</span>
            <span className="ufn-slam ufn-title-gold block text-[clamp(6.5rem,36vw,13rem)] tracking-wide text-gold" style={{ ['--d' as string]: '300ms' }}>NIGHT</span>
          </h1>
          <p className="ufn-rise mx-auto mt-6 max-w-sm text-base text-bone/85" style={{ ['--d' as string]: '420ms' }}>
            Real records. Live odds. Bragging rights. Call the winner, back it with fun points, and own the leaderboard.
          </p>

          <div className="ufn-rise mx-auto mt-8 grid max-w-sm gap-3" style={{ ['--d' as string]: '520ms' }}>
            {session ? (
              <Cta to="/app" variant="primary">Enter the arena</Cta>
            ) : (
              <>
                <Cta to="/join" variant="primary">Got an invite? Join</Cta>
                <Cta to="/login" variant="ghost">Log in</Cta>
              </>
            )}
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-2xl space-y-14 px-4 pb-16">
        {/* ───────── NEXT UP ───────── */}
        <NextFight />

        {/* ───────── HOW IT WORKS ───────── */}
        <section aria-labelledby="how">
          <h2 id="how" className="font-display text-5xl tracking-wide">How it <span className="text-red">works</span></h2>
          <ol className="mt-5 space-y-3">
            {steps.map(s => (
              <li key={s.n} className="relative flex gap-4 overflow-hidden rounded-2xl border border-line bg-surface p-4">
                <span aria-hidden className="ufn-outline-num w-12 shrink-0 font-display text-7xl leading-[0.85]">{s.n}</span>
                <div>
                  <h3 className="font-display text-3xl leading-none tracking-wide text-bone">{s.t}</h3>
                  <p className="mt-1.5 text-sm text-muted">{s.d}</p>
                </div>
              </li>
            ))}
          </ol>
        </section>

        {/* ───────── HOUSE RULES ───────── */}
        <section aria-labelledby="rules" className="overflow-hidden rounded-2xl border border-gold/40 bg-surface">
          <div className="ufn-tape h-3" aria-hidden />
          <div className="p-5">
            <h2 id="rules" className="font-display text-5xl tracking-wide text-gold">House rules</h2>
            <p className="text-sm text-muted">Break one and you're off the card.</p>
            <ul className="mt-4 divide-y divide-line">
              {rules.map(([t, d]) => (
                <li key={t} className="flex gap-3 py-3">
                  <span aria-hidden className="mt-1.5 h-2.5 w-2.5 shrink-0 rotate-45 bg-red" />
                  <p className="text-sm text-muted"><strong className="font-semibold text-bone">{t}</strong> {d}</p>
                </li>
              ))}
            </ul>
          </div>
          <div className="ufn-tape h-3" aria-hidden />
        </section>

        {/* ───────── POINTS NOTICE ───────── */}
        <section className="flex items-start gap-4 rounded-2xl border border-line bg-gradient-to-br from-surface to-ink p-5">
          <span aria-hidden className="grid h-12 w-12 shrink-0 place-items-center rounded-full border-2 border-gold font-display text-xl text-gold">PTS</span>
          <div>
            <h2 className="font-display text-3xl leading-none tracking-wide">Fun points only</h2>
            <p className="mt-1.5 text-sm text-muted">No cash value, nothing to buy or cash out. Points exist for bragging rights and nothing else.</p>
          </div>
        </section>

        {/* ───────── SHARE ───────── */}
        <section className="relative overflow-hidden rounded-2xl border border-line p-6 text-center">
          <div aria-hidden className="absolute inset-0 -z-0 bg-[linear-gradient(118deg,rgba(215,25,42,.35),transparent_45%,transparent_55%,rgba(42,111,219,.35))]" />
          <div className="relative">
            <h2 className="font-display text-5xl leading-none tracking-wide">Bring the <span className="text-gold">dorm</span></h2>
            <p className="mx-auto mt-2 max-w-xs text-sm text-muted">It's invite-only. Share the page, and an admin hands out the codes.</p>
            <ShareButton className="mt-5 w-full max-w-xs" title="UoS Fight Night" text={SHARE_TEXT} />
          </div>
        </section>
      </main>

      <footer className="border-t border-line px-4 pb-[max(2rem,env(safe-area-inset-bottom))] pt-8 text-center">
        <p className="font-display text-2xl tracking-[0.2em]">UOS <span className="text-red">FIGHT</span> <span className="text-gold">NIGHT</span></p>
        <p className="mt-1 text-xs text-muted">Private league · Members only · 18+ · Fun points, no cash value</p>
        {!session && (
          <p className="mt-4 text-sm">
            <Link to="/join" className="inline-flex min-h-11 items-center px-3 font-semibold text-gold">Join with invite</Link>
            <span className="text-line">|</span>
            <Link to="/login" className="inline-flex min-h-11 items-center px-3 font-semibold text-bone/80">Log in</Link>
          </p>
        )}
      </footer>
    </div>
  )
}
