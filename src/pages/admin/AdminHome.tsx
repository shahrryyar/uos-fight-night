import { Navigate, Route, Routes } from 'react-router-dom'
import AdminFights from './AdminFights'
import AdminFighters from './AdminFighters'
import AdminMembers from './AdminMembers'
import AdminPoints from './AdminPoints'
import AdminLog from './AdminLog'
import AdminTabs, { ADMIN_HOME } from './AdminTabs'
import '../../components/admin/admin.css'

/** Admin (DESIGN 10 "Admin"): title, 5 section tabs (all visible, aria-current), then the section.
 *  The fun-points line lives in the shared footer, so it is not repeated here. */
export default function AdminHome() {
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
        <Route path="*" element={<Navigate to={ADMIN_HOME} replace />} />
      </Routes>
    </div>
  )
}
