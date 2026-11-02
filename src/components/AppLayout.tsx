import { Suspense } from 'react'
import { NavLink, Outlet } from 'react-router-dom'
import { shownName, useAuth } from '../lib/auth'
import Splash from './landing/Splash'

const tabs = [
  { to: '/app', label: 'Tonight', icon: '🥊', end: true },
  { to: '/app/fighters', label: 'Fighters', icon: '🤼' },
  { to: '/app/leaderboard', label: 'Ranks', icon: '🏆' },
  { to: '/app/history', label: 'History', icon: '📜' },
  { to: '/app/me', label: 'Me', icon: '👤' },
]

export default function AppLayout() {
  const { isAdmin, profile } = useAuth()
  const name = shownName(profile)
  return (
    <div className="min-h-dvh flex flex-col">
      <header className="sticky top-0 z-20 bg-ink/90 backdrop-blur border-b border-line pt-[env(safe-area-inset-top)]">
        <div className="mx-auto max-w-2xl flex items-center justify-between gap-2 px-2 h-14">
          <NavLink to="/app" end aria-label="UoS Fight Night: tonight's card"
            className="inline-flex min-h-11 shrink-0 items-center rounded-lg px-2 font-display text-2xl tracking-wider">
            <span>UOS <span className="text-red">FIGHT</span> <span className="text-gold">NIGHT</span></span>
          </NavLink>
          <div className="flex min-w-0 items-center gap-1 text-sm">
            {isAdmin && (
              <NavLink to="/admin"
                className={({ isActive }) => `inline-flex min-h-11 items-center rounded-lg border px-3 font-semibold ${isActive ? 'border-gold bg-gold/15 text-gold' : 'border-gold/50 text-gold'}`}>
                Admin
              </NavLink>
            )}
            <NavLink to="/app/me" title={profile ? `@${profile.username}` : undefined}
              className="inline-flex min-h-11 min-w-0 items-center rounded-lg px-2 font-semibold text-bone/85 hover:text-bone">
              <span className="truncate max-w-[8rem]">{name}</span>
            </NavLink>
          </div>
        </div>
      </header>
      <main className="flex-1 mx-auto w-full max-w-2xl px-4 pt-4 pb-28">
        <Suspense fallback={<Splash inline />}>
          <Outlet />
        </Suspense>
      </main>
      <nav className="fixed bottom-0 inset-x-0 z-20 bg-surface/95 backdrop-blur border-t border-line pb-[env(safe-area-inset-bottom)]">
        <ul className="mx-auto max-w-2xl grid grid-cols-5">
          {tabs.map(t => (
            <li key={t.to}>
              <NavLink to={t.to} end={t.end}
                className={({ isActive }) => `flex flex-col items-center justify-center h-16 text-[11px] font-semibold uppercase tracking-wide ${isActive ? 'text-gold' : 'text-muted'}`}>
                <span className="text-xl leading-none mb-1" aria-hidden>{t.icon}</span>{t.label}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>
    </div>
  )
}
