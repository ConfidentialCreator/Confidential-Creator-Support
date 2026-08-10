import { mkdirSync, writeFileSync } from 'node:fs'
import { z } from 'zod'

export const FIXTURE_DIR = new URL('../../../../fixtures/tx/', import.meta.url)

const hex = z.string().regex(/^[0-9a-f]+$/)

// Секрети тут — одноразові ключі спайку на devnet, потрібні тестам розшифрування
// (T024, T048) як «відома сума»; до продукту вони стосунку не мають.
export const txFixtureSchema = z.object({
  label: z.string(),
  cluster: z.literal('devnet'),
  signature: z.string(),
  slot: z.number().int().nonnegative(),
  blockTime: z.number().int().nullable(),
  sizeBytes: z.number().int().positive(),
  wire: z.string(),
  logMessages: z.array(z.string()),
  context: z.object({
    mint: z.string(),
    decimals: z.number().int(),
    supporter: z.string(),
    supporterToken: z.string(),
    creator: z.string(),
    creatorToken: z.string(),
    auditorElgamalPubkey: z.string(),
    amount: z.string().regex(/^\d+$/),
    keys: z.object({
      supporterElgamalSecret: hex,
      supporterAe: hex,
      creatorElgamalSecret: hex,
      creatorAe: hex,
      auditorElgamalSecret: hex,
    }),
  }),
})

export type TxFixture = z.infer<typeof txFixtureSchema>

export function writeFixture(name: string, fixture: TxFixture): void {
  mkdirSync(FIXTURE_DIR, { recursive: true })
  writeFileSync(new URL(`${name}.json`, FIXTURE_DIR), `${JSON.stringify(fixture, null, 2)}\n`)
}
