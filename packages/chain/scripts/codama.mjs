// IDL Anchor → kit-клієнт. Запускати після `scripts/wsl-build.sh idl`.
import { readFileSync } from 'node:fs'
import { rootNodeFromAnchor } from '@codama/nodes-from-anchor'
import { renderVisitor } from '@codama/renderers-js'
import { createFromRoot } from 'codama'

const idl = JSON.parse(
  readFileSync(new URL('../../../target/idl/ccsupport.json', import.meta.url), 'utf8'),
)
const codama = createFromRoot(rootNodeFromAnchor(idl))
codama.accept(
  renderVisitor(
    new URL('../src/generated', import.meta.url).pathname.replace(/^\/([A-Za-z]):/, '$1:'),
  ),
)
