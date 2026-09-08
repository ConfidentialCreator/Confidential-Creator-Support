import {
  createDefaultRpcTransport,
  createSolanaRpcFromTransport,
  isSolanaError,
  type Rpc,
  type RpcTransport,
  SOLANA_ERROR__RPC__TRANSPORT_HTTP_ERROR,
  type SolanaRpcApi,
} from '@solana/kit'

export type PacingOptions = {
  // Helius Free: 10 запитів/с на ключ, а `sendTransaction` — окремо 1/с.
  rps: number
  sendRps: number
  maxAttempts?: number
  now?: () => number
  sleep?: (ms: number) => Promise<void>
}

const MAX_BACKOFF_MS = 8_000
const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

function rateLimitDelay(err: unknown, attempt: number): number | null {
  if (!isSolanaError(err, SOLANA_ERROR__RPC__TRANSPORT_HTTP_ERROR)) return null
  if (err.context.statusCode !== 429) return null
  const retryAfter = Number(err.context.headers.get('retry-after'))
  return retryAfter > 0 ? retryAfter * 1_000 : Math.min(1_000 * 2 ** attempt, MAX_BACKOFF_MS)
}

type Lane = { reserve(): Promise<void>; pushBack(until: number): void }

function createLane(rps: number, now: () => number, sleep: (ms: number) => Promise<void>): Lane {
  const interval = 1_000 / rps
  let nextSlot = 0
  return {
    async reserve() {
      const at = Math.max(now(), nextSlot)
      nextSlot = at + interval
      if (at > now()) await sleep(at - now())
    },
    pushBack(until) {
      nextSlot = Math.max(nextSlot, until)
    },
  }
}

function methodOf(config: Parameters<RpcTransport>[0]): string {
  const payload: unknown = config.payload
  return typeof payload === 'object' && payload !== null && 'method' in payload
    ? String(payload.method)
    : ''
}

// Один розклад на весь процес: API і прихильники стають в одну чергу, а 429
// відсуває всіх, не лише того, хто його впіймав.
export function createPacedTransport(inner: RpcTransport, options: PacingOptions): RpcTransport {
  const maxAttempts = options.maxAttempts ?? 6
  const now = options.now ?? Date.now
  const sleep = options.sleep ?? defaultSleep
  const lanes = {
    send: createLane(options.sendRps, now, sleep),
    other: createLane(options.rps, now, sleep),
  }

  return async function paced<TResponse>(config: Parameters<RpcTransport>[0]) {
    const lane = methodOf(config) === 'sendTransaction' ? lanes.send : lanes.other
    let lastError: unknown
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      await lane.reserve()
      try {
        return await inner<TResponse>(config)
      } catch (err) {
        const delay = rateLimitDelay(err, attempt)
        if (delay === null) throw err
        lastError = err
        lane.pushBack(now() + delay)
        await sleep(delay)
      }
    }
    throw lastError
  }
}

export function createPacedRpc(url: string, options: PacingOptions): Rpc<SolanaRpcApi> {
  return createSolanaRpcFromTransport(
    createPacedTransport(createDefaultRpcTransport({ url }), options),
  )
}
