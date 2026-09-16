// Anchor IDL → kit client. Run after `scripts/wsl-build.sh idl`.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { rootNodeFromAnchor } from '@codama/nodes-from-anchor'
import { renderVisitor } from '@codama/renderers-js'
import { createFromRoot, updateInstructionsVisitor } from 'codama'

const idl = JSON.parse(
  readFileSync(new URL('../../../target/idl/ccsupport.json', import.meta.url), 'utf8'),
)
const codama = createFromRoot(rootNodeFromAnchor(idl))
// The `Pledge` account and the `pledge` instruction would both produce `PLEDGE_DISCRIMINATOR`;
// the instruction goes under the program's accounts struct name, `MakePledge`.
codama.update(updateInstructionsVisitor({ pledge: { name: 'makePledge' } }))
// The renderer takes the package folder and writes into its `src/generated`; dependency
// versions in package.json are managed by hand, so the sync is off. The client runs not only
// under Vite but also under plain Node (`apps/api`, `tools/*`): imports carry `.ts` instead of
// folders, and no `enum` — Node's strip-only mode does not erase it.
codama.accept(
  renderVisitor(fileURLToPath(new URL('..', import.meta.url)), {
    erasableSyntax: true,
    importExtension: 'ts',
    syncPackageJson: false,
  }),
)
