import type { z } from 'zod'

export function encodeCursor(parts: readonly string[]): string {
  return Buffer.from(JSON.stringify(parts)).toString('base64url')
}

export function decodeCursor<T extends z.ZodType>(cursor: string, shape: T): z.infer<T> | null {
  let decoded: unknown
  try {
    decoded = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'))
  } catch {
    return null
  }
  const parsed = shape.safeParse(decoded)
  return parsed.success ? parsed.data : null
}
