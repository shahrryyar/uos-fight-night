import { Navigate, Route, Routes, useLocation } from 'react-router-dom'
import type { ReactNode } from 'react'
import { useAuth } from './lib/auth'
import AppLayout from './components/AppLayout'
import Landing from './pages/Landing'
import Login from './pages/Login'
import Join from './pages/Join'
import FightCard from './pages/FightCard'
import Fighters from './pages/Fighters'
import FighterProfile from './pages/FighterProfile'
import Leaderboard from './pages/Leaderboard'
import Me from './pages/Me'
import History from './pages/History'
import AdminHome from './pages/admin/AdminHome'

function Splash() {
  return <div className="min-h-dvh grid place-items-center font-display text-3xl tracking-wider text-muted">LOADING…</div>
}

function RequireMember({ children }: { children: ReactNode }) {
  const { session, profile, loading } = useAuth()
  const loc = useLocation()
  if (loading) return <Splash />
  if (!session) return <Navigate to="/login" replace state={{ from: loc.pathname }} />
  if (!profile) return <Splash />
  if (!profile.active) return <div className="min-h-dvh grid place-items-center p-6 text-center text-muted">Your account is deactivated. Ask an admin.</div>
  return <>{children}</>
}

function RequireAdmin({ children }: { children: ReactNode }) {
  const { isAdmin, loading } = useAuth()
  if (loading) return <Splash />
  if (!isAdmin) return <Navigate to="/app" replace />
  return <>{children}</>
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Landing />} />
      <Route path="/login" element={<Login />} />
      <Route path="/join" element={<Join />} />
      <Route element={<RequireMember><AppLayout /></RequireMember>}>
        <Route path="/app" element={<FightCard />} />
        <Route path="/app/fighters" element={<Fighters />} />
        <Route path="/app/fighters/:id" element={<FighterProfile />} />
        <Route path="/app/leaderboard" element={<Leaderboard />} />
        <Route path="/app/history" element={<History />} />
        <Route path="/app/me" element={<Me />} />
        <Route path="/admin/*" element={<RequireAdmin><AdminHome /></RequireAdmin>} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
