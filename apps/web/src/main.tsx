import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { Providers } from './providers.tsx'
import { Router } from './router.tsx'
import './index.css'

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
