import { ApiError, apiErrorBodySchema } from '@ccsupport/shared'
import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { describe, expect, it } from 'vitest'
import type { AppEnv } from '../env.ts'
import { errorHandler, fail, notFoundHandler } from './errors.ts'

function build() {
  const app = new Hono<AppEnv>()
  app.get('/fail', (c) => fail(c, 'UNAUTHORIZED', 'no session'))
  app.get('/api-error', () => {
    throw new ApiError('NOT_FOUND', 'no such creator', { reason: 'handle' })
  })
  app.get('/http-exception', () => {
    throw new HTTPException(400, { message: 'malformed body' })
  })
  app.get('/http-teapot', () => {
    throw new HTTPException(418, { message: 'teapot' })
  })
  app.get('/boom', () => {
    throw new Error('postgres://user:pw@host/db')
  })
  app.notFound(notFoundHandler)
  app.onError(errorHandler)
  return app
}

async function bodyOf(res: Response) {
  return apiErrorBodySchema.parse(await res.json()).error
}

describe('fail', () => {
  it('answers with the status of the code and the shared body', async () => {
    const res = await build().request('/fail')
    expect(res.status).toBe(401)
    expect(await bodyOf(res)).toEqual({ code: 'UNAUTHORIZED', message: 'no session' })
  })
})

describe('errorHandler', () => {
  it('maps a thrown ApiError to its status, keeping details', async () => {
    const res = await build().request('/api-error')
    expect(res.status).toBe(404)
    expect(await bodyOf(res)).toEqual({
      code: 'NOT_FOUND',
      message: 'no such creator',
      details: { reason: 'handle' },
    })
  })

  it('maps a known HTTPException status to a code', async () => {
    const res = await build().request('/http-exception')
    expect(res.status).toBe(400)
    expect(await bodyOf(res)).toEqual({ code: 'INVALID_INPUT', message: 'malformed body' })
  })

  it('hides an unexpected error and an unknown status behind INTERNAL', async () => {
    const boom = await build().request('/boom')
    expect(boom.status).toBe(500)
    const body = await bodyOf(boom)
    expect(body.code).toBe('INTERNAL')
    expect(JSON.stringify(body)).not.toContain('postgres://')

    const teapot = await build().request('/http-teapot')
    expect(teapot.status).toBe(500)
    expect((await bodyOf(teapot)).code).toBe('INTERNAL')
  })
})

describe('notFoundHandler', () => {
  it('answers 404 NOT_FOUND for an unknown path', async () => {
    const res = await build().request('/nope')
    expect(res.status).toBe(404)
    expect((await bodyOf(res)).code).toBe('NOT_FOUND')
  })
})
