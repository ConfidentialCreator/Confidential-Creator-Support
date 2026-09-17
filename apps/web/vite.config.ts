import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import wasm from 'vite-plugin-wasm'

// @solana-program/token-2022 imports @solana/zk-sdk through its bundler build
// (wasm ESM integration), which Vite 5 cannot bundle on its own. Target esnext leaves
// top-level await as is: vite-plugin-top-level-await 1.6.0 fails on swc
// ("missing field type"), and without it the wasm module initialises through TLA.
export default defineConfig(({ mode }) => ({
  plugins: [react(), wasm()],
  // GitHub Pages serves a project site under `/<repo>/`; the Pages workflow sets
  // BASE_PATH, a local build and a custom domain keep `/`.
  base: process.env.BASE_PATH ?? '/',
  // The codama client gates its error messages on `process.env["NODE_ENV"]`, and the
  // browser has no `process`.
  define: { 'process.env': JSON.stringify({ NODE_ENV: mode }) },
  worker: { format: 'es', plugins: () => [wasm()] },
  build: { target: 'esnext' },
  optimizeDeps: { esbuildOptions: { target: 'esnext' } },
  // One `.env` at the repo root for every app; Vite still exposes only `VITE_*`.
  envDir: '../..',
  server: { port: 5173 },
}))
