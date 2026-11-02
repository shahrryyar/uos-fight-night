import { Navigate, Route, Routes } from 'react-router-dom'
import AdminFights from './AdminFights'
import AdminFighters from './AdminFighters'
import AdminMembers from './AdminMembers'
import AdminPoints from './AdminPoints'
import AdminLog from './AdminLog'
import AdminTabs, { ADMIN_HOME } from './AdminTabs'

export default function AdminHome() {
  return (
    <div>
      <div className="mb-3 flex items-baseline justify-between">
        <h1 className="font-display text-4xl tracking-wider leading-none">
          <span className="text-gold">ADMIN</span> CORNER
        </h1>
        <span className="text-xs text-muted">fun points — no cash value</span>
      </div>
      <AdminTabs />
      <Routes>
        <Route index element={<Navigate to={ADMIN_HOME} replace />} />
        <Route path="fights" element={<AdminFights />} />
        <Route path="fighters" element={<AdminFighters />} />
        <Route path="members" element={<AdminMembers />} />
        <Route path="points" element={<AdminPoints />} />
        <Route path="log" element={<AdminLog />} />
        <Route path="*" element={<Navigate to={ADMIN_HOME} replace />} />
      </Routes>
    </div>
  )
}
