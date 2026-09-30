import { stdSerializers } from 'pino'

// kit freezes `SolanaError.context`, and an HTTP-error context carries a `message`, so
// pino's serializer takes it for a nested error and throws while tagging it: the log
// call itself fails, and a handled RPC outage escapes its catch. Serialize a copy.
export function serializeErr(err: unknown): unknown {
  if (!(err instanceof Error)) return err
  if (!('context' in err) || typeof err.context !== 'object' || err.context === null) {
    return stdSerializers.err(err)
  }
  const { context: _frozen, ...own } = Object.getOwnPropertyDescriptors(err)
  const copy: Error = Object.create(Object.getPrototypeOf(err), {
    ...own,
    context: { value: { ...err.context }, enumerable: true },
  })
  return stdSerializers.err(copy)
}
