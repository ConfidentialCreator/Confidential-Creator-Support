// IDL Anchor → kit-клієнт. Запускати після `scripts/wsl-build.sh idl`.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { rootNodeFromAnchor } from '@codama/nodes-from-anchor'
import { renderVisitor } from '@codama/renderers-js'
import { createFromRoot, updateInstructionsVisitor } from 'codama'

const idl = JSON.parse(
  readFileSync(new URL('../../../target/idl/ccsupport.json', import.meta.url), 'utf8'),
)
const codama = createFromRoot(rootNodeFromAnchor(idl))
// Акаунт `Pledge` та інструкція `pledge` дають у клієнті два `PLEDGE_DISCRIMINATOR`;
// інструкція йде під ім'ям accounts-структури програми, `MakePledge`.
codama.update(updateInstructionsVisitor({ pledge: { name: 'makePledge' } }))
// Рендерер приймає теку пакета й пише в її `src/generated`; версії залежностей
// у package.json тримаємо самі, тому синхронізацію вимкнено. Клієнт виконує не лише
// Vite, а й Node без транспіляції (`apps/api`, `tools/*`): імпорти з `.ts` замість
// тек, і жодного `enum` — strip-only режим Node його не стирає.
codama.accept(
  renderVisitor(fileURLToPath(new URL('..', import.meta.url)), {
    erasableSyntax: true,
    importExtension: 'ts',
    syncPackageJson: false,
  }),
)
