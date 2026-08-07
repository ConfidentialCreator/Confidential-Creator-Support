// Гейт «жодного поля суми поза шифротекстами».
//
// Продукт стоїть на тому, що сума внеску існує лише в шифротекстах Token-2022 і
// в браузері держателя ключа. Найпростіший спосіб це зламати — колонка `amount`
// в індексі або поле `amount` у схемі API «для зручності». Гейт ганяє grep по
// шарах, де суми бути не може, і падає на першому збігу; дозволена лише публічна
// рекомендація автора `suggested_amount` / `suggestedAmount`.
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
  console.error('amount-guard: поле суми поза шифротекстами:')
  for (const h of hits) console.error(`  ${h}`)
  process.exit(1)
}
console.log(`amount-guard: чисто (${SCOPES.join(', ')})`)
