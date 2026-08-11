import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import wasm from 'vite-plugin-wasm'

// @solana-program/token-2022 імпортує @solana/zk-sdk через bundler-збірку
// (wasm ESM integration), яку Vite 5 сам не збирає. Target esnext лишає
// top-level await як є: vite-plugin-top-level-await 1.6.0 падає на swc
// («missing field type»), а без нього wasm-модуль ініціалізується через TLA.
export default defineConfig({
  plugins: [react(), wasm()],
  worker: { format: 'es', plugins: () => [wasm()] },
  build: { target: 'esnext' },
  optimizeDeps: { esbuildOptions: { target: 'esnext' } },
  server: { port: 5173 },
})
