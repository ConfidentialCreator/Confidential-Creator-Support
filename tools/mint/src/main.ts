// Platform operator: `create-mint` issues the SUPD token with ConfidentialTransferMint and
// the audit key, `mint-to <wallet> <units>` tops up a public balance (the faucet wallet
// and the like), `init-config` creates the program `Config` with this mint. Keys live in CCS_KEYS_DIR
// (~/.config/ccsupport by default) and never enter the repo.
//
// Run: pnpm --filter @ccsupport/mint mint <create-mint | mint-to <wallet> <units> | init-config>
import { addressSchema } from '@ccsupport/shared'
import {
  assertIsSuccessfulTransactionPlanResult,
  assertIsTransactionWithBlockhashLifetime,
  createSolanaRpc,
  createSolanaRpcSubscriptions,
  createTransactionMessage,
  createTransactionPlanExecutor,
  createTransactionPlanner,
  generateKeyPairSigner,
  getSignatureFromTransaction,
  type InstructionPlan,
  type KeyPairSigner,
  pipe,
  sendAndConfirmTransactionFactory,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  signTransactionMessageWithSigners,
} from '@solana/kit'
import { fetchMint } from '@solana-program/token-2022'
import { z } from 'zod'
import { createMintPlan, DECIMALS, elgamalAddress, TOKEN_SYMBOL } from './create-mint.ts'
import { findConfig, initConfigPlan } from './init-config.ts'
import {
  AUDITOR_FILE,
  DEFAULT_KEYS_DIR,
  loadOrCreateAuditor,
  loadOrCreateMintAuthority,
  MINT_AUTHORITY_FILE,
} from './keys.ts'
import { mintToPlan, parseMintToArgs } from './mint-to.ts'

// `.env.example` ships the keys empty; an empty string means "not set", not "invalid".
const blankToUndefined = (value: unknown) => (value === '' ? undefined : value)

const env = z
  .object({
    SOLANA_RPC_URL: z.url({ protocol: /^https?$/ }),
    CCS_KEYS_DIR: z.preprocess(blankToUndefined, z.string().prefault(DEFAULT_KEYS_DIR)),
    CCS_MINT: z.preprocess(blankToUndefined, addressSchema.optional()),
  })
  .parse(process.env)

const rpc = createSolanaRpc(env.SOLANA_RPC_URL)
const rpcSubscriptions = createSolanaRpcSubscriptions(env.SOLANA_RPC_URL.replace(/^http/, 'ws'))
const sendAndConfirm = sendAndConfirmTransactionFactory({ rpc, rpcSubscriptions })
const rent = {
  getMinimumBalance: (space: number) => rpc.getMinimumBalanceForRentExemption(BigInt(space)).send(),
}

async function runPlan(payer: KeyPairSigner, plan: InstructionPlan): Promise<void> {
  const planner = createTransactionPlanner({
    createTransactionMessage: () =>
      pipe(createTransactionMessage({ version: 0 }), (m) =>
        setTransactionMessageFeePayerSigner(payer, m),
      ),
  })
  const executor = createTransactionPlanExecutor({
    executeTransactionMessage: async (_context, message) => {
      const { value: blockhash } = await rpc.getLatestBlockhash({ commitment: 'confirmed' }).send()
      const transaction = await signTransactionMessageWithSigners(
        setTransactionMessageLifetimeUsingBlockhash(blockhash, message),
      )
      assertIsTransactionWithBlockhashLifetime(transaction)
      await sendAndConfirm(transaction, { commitment: 'confirmed' })
      const signature = getSignatureFromTransaction(transaction)
      console.log(`  ${message.instructions.length} ix  ${signature}`)
      return { signature }
    },
  })
  assertIsSuccessfulTransactionPlanResult(await executor(await planner(plan)))
}

async function requireBalance(authority: KeyPairSigner): Promise<void> {
  const { value } = await rpc.getBalance(authority.address).send()
  console.log(`authority ${authority.address}  ${Number(value) / 1e9} SOL`)
  if (value === 0n) {
    throw new Error(
      `authority has no SOL — fund it first: solana transfer ${authority.address} 0.3 --allow-unfunded-recipient`,
    )
  }
}

async function createMint(): Promise<void> {
  const { signer: authority, created: authorityCreated } = await loadOrCreateMintAuthority(
    env.CCS_KEYS_DIR,
  )
  const { keypair: auditor, created: auditorCreated } = loadOrCreateAuditor(env.CCS_KEYS_DIR)
  console.log(
    `${MINT_AUTHORITY_FILE}  ${authorityCreated ? 'generated' : 'loaded'}\n${AUDITOR_FILE}  ${auditorCreated ? 'generated' : 'loaded'}  ${elgamalAddress(auditor.pubkey())}`,
  )
  await requireBalance(authority)

  const mint = await generateKeyPairSigner()
  await runPlan(
    authority,
    await createMintPlan(rent, { authority, mint, auditor: auditor.pubkey() }),
  )
  console.log(`\nmint ${mint.address}  (${TOKEN_SYMBOL}, ${DECIMALS} decimals)`)
  console.log(`CCS_MINT=${mint.address}\nVITE_CCS_MINT=${mint.address}`)
}

async function mintTo(argv: readonly string[]): Promise<void> {
  const mint = env.CCS_MINT
  if (!mint) throw new Error('CCS_MINT is not set — run create-mint first')
  const args = parseMintToArgs(argv)
  const { signer: authority } = await loadOrCreateMintAuthority(env.CCS_KEYS_DIR)
  await requireBalance(authority)

  const { data } = await fetchMint(rpc, mint)
  await runPlan(authority, await mintToPlan({ ...args, authority, mint, decimals: data.decimals }))
  console.log(`\nminted ${args.units} units to ${args.wallet}`)
}

async function initConfig(): Promise<void> {
  const mint = env.CCS_MINT
  if (!mint) throw new Error('CCS_MINT is not set — run create-mint first')
  const existing = await findConfig(rpc)
  if (existing) {
    console.log(
      `config ${existing.address} already exists  mint ${existing.mint}  authority ${existing.authority}`,
    )
    if (existing.mint !== mint) throw new Error(`config mint differs from CCS_MINT=${mint}`)
    return
  }
  const { signer: authority } = await loadOrCreateMintAuthority(env.CCS_KEYS_DIR)
  await requireBalance(authority)
  await runPlan(authority, await initConfigPlan({ authority, mint }))
  const created = await findConfig(rpc)
  console.log(`\nconfig ${created?.address}  mint ${mint}  authority ${authority.address}`)
}

async function main(): Promise<void> {
  const [command, ...rest] = process.argv.slice(2)
  switch (command) {
    case 'create-mint':
      return createMint()
    case 'mint-to':
      return mintTo(rest)
    case 'init-config':
      return initConfig()
    default:
      throw new Error('usage: mint <create-mint | mint-to <wallet> <units> | init-config>')
  }
}

// The subscriptions socket keeps the event loop alive; exit explicitly once done.
main().then(
  () => process.exit(0),
  (error) => {
    console.error(error instanceof Error ? error.message : error)
    process.exit(1)
  },
)
