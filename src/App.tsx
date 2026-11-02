import { lazy, Suspense, type ReactNode } from 'react'
import { Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { useAuth } from './lib/auth'
import AppLayout from './components/AppLayout'
import Splash from './components/landing/Splash'
import Landing from './pages/Landing'
import Login from './pages/Login'
import NotFound from './components/landing/NotFound'
import { EmptyState } from './components/ui'

// Member + admin pages are split into their own chunks so the public landing/login stay small.
const FightCard = lazy(() => import('./pages/FightCard'))
const Fighters = lazy(() => import('./pages/Fighters'))
const FighterProfile = lazy(() => import('./pages/FighterProfile'))
const Leaderboard = lazy(() => import('./pages/Leaderboard'))
const Me = lazy(() => import('./pages/Me'))
const History = lazy(() => import('./pages/History'))
const AdminHome = lazy(() => import('./pages/admin/AdminHome'))

function RequireMember({ children }: { children: ReactNode }) {
  const { session, profile, loading } = useAuth()
  const loc = useLocation()
  if (loading) return <Splash />
  if (!session) return <Navigate to="/login" replace state={{ from: loc.pathname }} />
  if (!profile) return <Splash />
  if (!profile.active) return <main className="wrap"><EmptyState as="h1" size="title" title="Account switched off" body="Ask an admin to turn it back on." /></main>
  return <>{children}</>
}

function RequireAdmin({ children }: { children: ReactNode }) {
  const { isAdmin, loading } = useAuth()
  if (loading) return <Splash inline />
  if (!isAdmin) return <Navigate to="/app" replace />
  return <>{children}</>
}

export default function App() {
  return (
    <Suspense fallback={<Splash />}>
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/login" element={<Login />} />
        {/* Self-signup is gone (admins create accounts). Old invite links land on login. */}
        <Route path="/join" element={<Navigate to="/login" replace />} />
        <Route element={<RequireMember><AppLayout /></RequireMember>}>
          <Route path="/app" element={<FightCard />} />
          <Route path="/app/fighters" element={<Fighters />} />
          <Route path="/app/fighters/:id" element={<FighterProfile />} />
          <Route path="/app/leaderboard" element={<Leaderboard />} />
          <Route path="/app/history" element={<History />} />
          <Route path="/app/me" element={<Me />} />
          <Route path="/admin/*" element={<RequireAdmin><AdminHome /></RequireAdmin>} />
        </Route>
        <Route path="*" element={<NotFound />} />
      </Routes>
    </Suspense>
  )
}
