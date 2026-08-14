import { BrowserRouter, Navigate, Route, Routes } from 'react-router'
import { routes } from './components/Chrome.tsx'
import { Audit } from './screens/Audit/Audit.tsx'
import { CreatorPage } from './screens/CreatorPage/CreatorPage.tsx'
import { Dashboard } from './screens/Dashboard/Dashboard.tsx'
import { Support } from './screens/Support/Support.tsx'

export function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/c/:handle" element={<CreatorPage />} />
        <Route path="/support/:handle" element={<Support />} />
        <Route path="/creator" element={<Dashboard />} />
        <Route path="/audit" element={<Audit />} />
        <Route path="*" element={<Navigate to={routes.page} replace />} />
      </Routes>
    </BrowserRouter>
  )
}
