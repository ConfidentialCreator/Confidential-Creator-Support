// The "no amount field outside the ciphertexts" gate.
//
// The product rests on the contribution amount existing only in Token-2022 ciphertexts
// and in the key holder's browser. The easiest way to break that is an `amount` column
// in the index or an `amount` field in the API schema "for convenience". The gate greps
// the layers where no amount may exist and fails on the first hit; the only allowed
// one is the creator's public suggestion `suggested_amount` / `suggestedAmount`.
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const ROOT = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]):/, '$1:')
const SCOPES = ['packages/db/src', 'packages/shared/src', 'apps/api/src', 'apps/worker/src']
const FORBIDDEN = /\bamount\b/i
const ALLOWED = /\bsuggested_?amount\b/i

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (/\.(ts|tsx|sql)$/.test(name)) out.push(p)
  }
  return out
}

const hits = []
for (const scope of SCOPES) {
  const dir = join(ROOT, scope)
  let files = []
  try {
    files = walk(dir)
  } catch {
    continue
  }
  for (const file of files) {
    const lines = readFileSync(file, 'utf8').split('\n')
    lines.forEach((line, i) => {
      if (FORBIDDEN.test(line.replace(ALLOWED, ''))) {
        hits.push(`${relative(ROOT, file)}:${i + 1}: ${line.trim()}`)
      }
    })
  }
}

if (hits.length > 0) {
  console.error('amount-guard: amount field outside the ciphertexts:')
  for (const h of hits) console.error(`  ${h}`)
  process.exit(1)
}
console.log(`amount-guard: clean (${SCOPES.join(', ')})`)
