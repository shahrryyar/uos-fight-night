import { NavLink, Navigate, Route, Routes } from 'react-router-dom'
import AdminFights from './AdminFights'
import AdminFighters from './AdminFighters'
import AdminInvites from './AdminInvites'
import AdminMembers from './AdminMembers'
import AdminPoints from './AdminPoints'
import AdminLog from './AdminLog'

const tabs = [
  { to: 'fights', label: 'Fights' },
  { to: 'fighters', label: 'Fighters' },
  { to: 'invites', label: 'Invites' },
  { to: 'members', label: 'Members' },
  { to: 'points', label: 'Points' },
  { to: 'log', label: 'Log' },
]

export default function AdminHome() {
  return (
    <div>
      <div className="mb-3 flex items-baseline justify-between">
        <h1 className="font-display text-4xl tracking-wider leading-none">
          <span className="text-gold">ADMIN</span> CORNER
        </h1>
        <span className="text-xs text-muted">fun points — no cash value</span>
      </div>
      <nav className="-mx-4 mb-4 overflow-x-auto px-4 [scrollbar-width:none]" aria-label="Admin sections">
        <ul className="flex gap-2 w-max">
          {tabs.map(t => (
            <li key={t.to}>
              <NavLink to={t.to}
                className={({ isActive }) =>
                  `flex items-center min-h-11 rounded-full px-4 text-sm font-bold uppercase tracking-wider border transition ${
                    isActive ? 'bg-gold text-ink border-gold' : 'bg-surface border-line text-muted hover:text-bone'}`}>
                {t.label}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>
      <Routes>
        <Route index element={<Navigate to="fights" replace />} />
        <Route path="fights" element={<AdminFights />} />
        <Route path="fighters" element={<AdminFighters />} />
        <Route path="invites" element={<AdminInvites />} />
        <Route path="members" element={<AdminMembers />} />
        <Route path="points" element={<AdminPoints />} />
        <Route path="log" element={<AdminLog />} />
        <Route path="*" element={<Navigate to="fights" replace />} />
      </Routes>
    </div>
  )
}
