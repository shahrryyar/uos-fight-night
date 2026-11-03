import { lazy, Suspense } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import AdminFights from './AdminFights'
import AdminFighters from './AdminFighters'
import AdminMembers from './AdminMembers'
import AdminPoints from './AdminPoints'
import AdminLog from './AdminLog'
import AdminSeason from './AdminSeason'
import AdminTabs, { ADMIN_HOME } from './AdminTabs'
import { Loading } from '../../components/ui'
import '../../components/admin/admin.css'

// The referee scoreboard is a separate full-screen view (B4), loaded only when a ref opens it.
const Referee = lazy(() => import('./Referee'))

/** Admin (DESIGN 10 "Admin"): title, 5 section tabs (all visible, aria-current), then the section.
 *  The fun-points line lives in the shared footer, so it is not repeated here. */
function AdminSections() {
  return (
    <div className="pg-admin">
      <h1 className="t-title">Admin</h1>
      <AdminTabs />
      <Routes>
        <Route index element={<Navigate to={ADMIN_HOME} replace />} />
        <Route path="fights" element={<AdminFights />} />
        <Route path="fighters" element={<AdminFighters />} />
        <Route path="members" element={<AdminMembers />} />
        <Route path="points" element={<AdminPoints />} />
        <Route path="log" element={<AdminLog />} />
        <Route path="season" element={<AdminSeason />} />
        <Route path="*" element={<Navigate to={ADMIN_HOME} replace />} />
      </Routes>
    </div>
  )
}

export default function AdminHome() {
  return (
    <Routes>
      <Route path="ref/:fightId" element={<Suspense fallback={<Loading label="Loading the scoreboard…" />}><Referee /></Suspense>} />
      <Route path="*" element={<AdminSections />} />
    </Routes>
  )
}
