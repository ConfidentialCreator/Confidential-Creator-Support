import { describe, expect, it } from 'vitest'
import { type LogNotification, type LogSource, subscribeLogs } from './subscribe.ts'

function notification(signature: string, slot: number, err: unknown = null): LogNotification {
  return { context: { slot: BigInt(slot) }, value: { signature, err, logs: [`log ${signature}`] } }
}

// Each connection is a script: notifications to yield, then how the socket ends.
type Script = { yields: LogNotification[]; end: 'close' | 'throw' | 'hang' }

function scripted(scripts: Script[]) {
  let opened = 0
  const source: LogSource = (signal) => {
    const script = scripts[opened++]
    if (script === undefined) throw new Error('no more scripts')
    const { yields, end } = script
    async function* run() {
      for (const n of yields) yield n
      if (end === 'throw') throw new Error('socket closed')
      if (end === 'hang' && !signal.aborted) {
        await new Promise<void>((r) => signal.addEventListener('abort', () => r()))
      }
    }
    return Promise.resolve(run())
  }
  return { source, opened: () => opened }
}

describe('subscribeLogs', () => {
  it('delivers every notification as a program transaction', async () => {
    const seen: unknown[] = []
    const controller = new AbortController()
    const { source } = scripted([
      {
        yields: [notification('a', 1), notification('b', 2, { InstructionError: [0, 'Custom'] })],
        end: 'hang',
      },
    ])
    await subscribeLogs({
      source,
      onTransaction: (tx) => {
        seen.push(tx)
        if (seen.length === 2) controller.abort()
      },
      onError: () => {},
      retryMs: 1,
      signal: controller.signal,
    })
    expect(seen).toEqual([
      { signature: 'a', slot: 1n, blockTime: null, logs: ['log a'], failed: false },
      { signature: 'b', slot: 2n, blockTime: null, logs: ['log b'], failed: true },
    ])
  })

  it('reconnects after a closed and after a failed socket, until aborted', async () => {
    const seen: string[] = []
    const errors: unknown[] = []
    const controller = new AbortController()
    const { source, opened } = scripted([
      { yields: [notification('a', 1)], end: 'close' },
      { yields: [], end: 'throw' },
      { yields: [notification('b', 2)], end: 'hang' },
    ])
    await subscribeLogs({
      source,
      onTransaction: (tx) => {
        seen.push(tx.signature)
        if (tx.signature === 'b') controller.abort()
      },
      onError: (err) => errors.push(err),
      retryMs: 1,
      signal: controller.signal,
    })
    expect(seen).toEqual(['a', 'b'])
    expect(opened()).toBe(3)
    expect(errors).toHaveLength(1)
  })

  it('returns at once when already aborted', async () => {
    const controller = new AbortController()
    controller.abort()
    const { source, opened } = scripted([])
    await subscribeLogs({
      source,
      onTransaction: () => {},
      onError: () => {},
      retryMs: 1,
      signal: controller.signal,
    })
    expect(opened()).toBe(0)
  })
})
