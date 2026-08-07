import { serve } from '@hono/node-server'
import { createApp } from './app.ts'

// 8080 на цій машині зайнятий Steam — тому 8787.
const port = Number(process.env.API_PORT ?? 8787)
serve({ fetch: createApp().fetch, port })
console.log(`api on :${port}`)
