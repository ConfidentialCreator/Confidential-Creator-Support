import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { Providers } from './providers.tsx'
import { Router } from './router.tsx'
import './index.css'
import { legacyPath } from './legacy-path.ts'

const moved = legacyPath(window.location.pathname, import.meta.env.BASE_URL)
if (moved)
  window.history.replaceState(null, '', moved + window.location.search + window.location.hash)

const root = document.getElementById('root')
if (root) {
  createRoot(root).render(
    <StrictMode>
      <Providers>
        <Router />
      </Providers>
    </StrictMode>,
  )
}
