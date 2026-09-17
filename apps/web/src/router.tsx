import { BrowserRouter, Navigate, Route, Routes } from 'react-router'
import { routes } from './components/Chrome.tsx'
import { Audit } from './screens/Audit/Audit.tsx'
import { CreatorPage } from './screens/CreatorPage/CreatorPage.tsx'
import { Dashboard } from './screens/Dashboard/Dashboard.tsx'
import { Register } from './screens/Register/Register.tsx'
import { Support } from './screens/Support/Support.tsx'

export function Router() {
  return (
    <BrowserRouter basename={import.meta.env.BASE_URL}>
      <Routes>
        <Route path="/c/:handle" element={<CreatorPage />} />
        <Route path="/support/:handle" element={<Support />} />
        <Route path="/creator" element={<Dashboard />} />
        <Route path="/creator/new" element={<Register />} />
        <Route path="/audit" element={<Audit />} />
        <Route path="*" element={<Navigate to={routes.page} replace />} />
      </Routes>
    </BrowserRouter>
  )
}
