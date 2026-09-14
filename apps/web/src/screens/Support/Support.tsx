import {
  type ConfidentialKeys,
  confidentialAccountState,
  decryptAvailable,
  fetchRelayPayer,
  type PreparationStep,
} from '@ccsupport/chain'
import { type Address, type CreatorProfile, MAX_PERIODS, PERIOD_SECONDS } from '@ccsupport/shared'
import { address, createSolanaRpc, type TransactionSendingSigner } from '@solana/kit'
import { useSelectedWalletAccount, useWalletAccountTransactionSendingSigner } from '@solana/react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { UiWalletAccount } from '@wallet-standard/react'
import { useState } from 'react'
import { Link, useParams } from 'react-router'
import { fetchCreator } from '../../api/creators.ts'
import { requestFaucet } from '../../api/faucet.ts'
import { Chrome, Mono } from '../../components/Chrome.tsx'
import { Sealed } from '../../components/Sealed.tsx'
import { useConfidentialKeys } from '../../confidential/KeysProvider.tsx'
import { webEnv } from '../../config.ts'
import { TOKEN, trunc } from '../../mockData.ts'
import { formatUnits } from '../CreatorPage/format.ts'
import { parseUnits } from '../Register/form.ts'
import { chainPort } from '../Register/submit.ts'
import {
  apiRelay,
  chainOps,
  type Outcome,
  type Progress,
  runContribution,
  type TokenAccount,
} from './contribute.ts'
import {
  expectedSignatures,
  explorerUrl,
  fundsProblems,
  publicShortfall,
  STAGE_TEXT,
  stepLabels,
} from './flow.ts'

const rpc = createSolanaRpc(webEnv.rpcUrl)
const ports = { ops: chainOps(rpc), port: chainPort(rpc), relay: apiRelay(webEnv.apiUrl) }

// Rent of the token account plus the fees of two transactions; the proofs are paid
// by the platform. The faucet portion is 0.02 SOL.
const MIN_LAMPORTS = 5_000_000n
const DEVNET = webEnv.chain === 'solana:devnet'

export function Support() {
  const { handle = '' } = useParams()
  const [account] = useSelectedWalletAccount()
  const creator = useQuery({
    queryKey: ['creator', handle],
    queryFn: () => fetchCreator(webEnv.apiUrl, handle),
  })

  if (creator.isPending) {
    return (
      <Chrome>
        <div className="help">loading {handle}…</div>
      </Chrome>
    )
  }
  if (creator.isError) {
    return (
      <Chrome>
        <div className="text-refused">the api did not answer: {creator.error.message}</div>
      </Chrome>
    )
  }
  if (creator.data === null) {
    return (
      <Chrome>
        <h1 className="text-2xl font-normal">No creator with the handle {handle}</h1>
      </Chrome>
    )
  }
  const mint = webEnv.mint
  return (
    <Chrome>
      <h1 className="text-2xl font-normal">Support {creator.data.name}</h1>
      {!mint ? (
        <p className="mb-3 text-refused">No mint is configured for this deployment.</p>
      ) : !account ? (
        <p className="mb-3">Connect a wallet above — the transfer is signed by it.</p>
      ) : (
        <WithAccount key={account.address} account={account} profile={creator.data} mint={mint} />
      )}
    </Chrome>
  )
}

type AccountProps = { account: UiWalletAccount; profile: CreatorProfile; mint: Address }

function WithAccount({ account, profile, mint }: AccountProps) {
  const signer = useWalletAccountTransactionSendingSigner(account, webEnv.chain)
  const owner = address(account.address)
  const wallet = useQuery({
    queryKey: ['token-account', account.address, mint],
    queryFn: async () => {
      const [token, { value: lamports }] = await Promise.all([
        ports.ops.account(owner, mint),
        rpc.getBalance(owner, { commitment: 'confirmed' }).send(),
      ])
      return { ...token, lamports }
    },
  })
  const payer = useQuery({
    queryKey: ['relay-payer'],
    queryFn: () => fetchRelayPayer(webEnv.apiUrl),
    refetchInterval: false,
  })

  if (wallet.isPending || payer.isPending) return <div className="help">reading the chain…</div>
  if (wallet.isError) {
    return <div className="text-refused">the chain did not answer: {wallet.error.message}</div>
  }
  if (payer.isError) {
    return <div className="text-refused">the relay is not reachable: {payer.error.message}</div>
  }
  return (
    <Form
      signer={signer}
      profile={profile}
      mint={mint}
      wallet={wallet.data}
      payer={payer.data}
      refresh={() => wallet.refetch()}
    />
  )
}

type FormProps = {
  signer: TransactionSendingSigner
  profile: CreatorProfile
  mint: Address
  wallet: TokenAccount & { lamports: bigint }
  payer: Address
  refresh: () => Promise<unknown>
}

function Form({ signer, profile, mint, wallet, payer, refresh }: FormProps) {
  const { keys } = useConfidentialKeys()
  const [amount, setAmount] = useState(formatUnits(profile.suggestedAmount, wallet.decimals))
  const [periods, setPeriods] = useState(1)
  const [showPublicly, setShowPublicly] = useState(false)
  const [progress, setProgress] = useState<Progress | null>(null)

  const units = parseUnits(amount, wallet.decimals)
  const state = confidentialAccountState(wallet.account)
  const shortfall = units === null ? null : publicShortfall(units, state)
  const publicBalance = state.kind === 'missing' ? 0n : state.publicBalance

  const { planned, planProblem } = usePreparationPlan({ signer, mint, wallet, keys, units })

  const contribute = useContribution({
    signer,
    profile,
    mint,
    payer,
    units,
    periods,
    showPublicly,
    onProgress: setProgress,
    refresh,
  })

  if (contribute.isSuccess) {
    return (
      <Done outcome={contribute.data} profile={profile} periods={periods} listed={showPublicly} />
    )
  }

  const problems = fundsProblems({
    units,
    amountEntered: amount.trim() !== '',
    shortfall,
    lamports: wallet.lamports,
    minLamports: MIN_LAMPORTS,
    planProblem,
    decimals: wallet.decimals,
  })
  const blocked = units === null || units <= 0n || problems.length > 0 || contribute.isPending
  const needsFunds = (shortfall !== null && shortfall > 0n) || wallet.lamports < MIN_LAMPORTS

  return (
    <>
      <WalletLine signer={signer} wallet={wallet} publicBalance={publicBalance} keys={keys} />

      <h2>Amount</h2>
      <div className="flex items-baseline gap-4">
        <input
          className="w-[12ch] text-right"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          inputMode="decimal"
          aria-label="Amount"
          disabled={contribute.isPending}
        />
        <span>{TOKEN}</span>
      </div>
      <div className="help">
        Any amount is support. The creator sees it; the page never does. Suggested:{' '}
        {formatUnits(profile.suggestedAmount, wallet.decimals)} {TOKEN}.
      </div>
      {problems.map((text) => (
        <p key={text} className="mt-2 text-refused">
          {text}. Nothing has been sent.
        </p>
      ))}
      {DEVNET && needsFunds && <Faucet wallet={signer.address} refresh={refresh} />}

      <h2>Periods</h2>
      <div className="flex items-baseline gap-4">
        <button
          type="button"
          className="act px-2.5"
          onClick={() => setPeriods(Math.max(1, periods - 1))}
          disabled={contribute.isPending}
        >
          −
        </button>
        <span>{periods}</span>
        <button
          type="button"
          className="act px-2.5"
          onClick={() => setPeriods(Math.min(MAX_PERIODS, periods + 1))}
          disabled={contribute.isPending}
        >
          +
        </button>
        <span>
          {periods} {periods === 1 ? 'period' : 'periods'} = {(periods * PERIOD_SECONDS) / 86_400}{' '}
          days
        </span>
      </div>
      <div className="help">One payment covers all chosen periods. Nothing renews by itself.</div>

      <h2>Listing</h2>
      <label className="flex items-baseline gap-4">
        <input
          type="checkbox"
          checked={showPublicly}
          onChange={(e) => setShowPublicly(e.target.checked)}
          disabled={contribute.isPending}
        />
        <span>List my wallet on the creator's page</span>
      </label>
      <div className="help">
        Your wallet is on chain either way. This only decides whether the page lists it.
      </div>

      <h2>Steps</h2>
      <ol className="steps">
        {stepLabels({ keysDerived: keys !== null, preparation: planned }).map((text, i) => (
          <li key={text}>
            {i + 1} {text}
          </li>
        ))}
      </ol>
      <div className="help">
        {expectedSignatures({
          keysDerived: keys !== null,
          preparation: planned === null || planned.length > 0,
        })}{' '}
        signatures in the wallet at most · the platform pays for the proofs, you pay only for what
        you sign
      </div>

      <p className="mt-6">
        <button
          type="button"
          className={blocked ? 'act act-off' : 'act'}
          disabled={blocked}
          onClick={() => contribute.mutate()}
        >
          Support
        </button>
      </p>
      {contribute.isPending && progress && (
        <div className="help">
          {STAGE_TEXT[progress.stage]} · {progress.signatures} signed so far
        </div>
      )}
      {contribute.isError && <div className="mt-2 text-refused">{contribute.error.message}</div>}
    </>
  )
}

type PlanOptions = {
  signer: TransactionSendingSigner
  mint: Address
  wallet: TokenAccount
  keys: ConfidentialKeys | null
  units: bigint | null
}

// With the keys at hand the exact plan is known before anything is signed: which
// steps the account needs, or that the funds do not cover the amount.
function usePreparationPlan({ signer, mint, wallet, keys, units }: PlanOptions) {
  const input = keys && units !== null && units > 0n ? { keys, units } : null
  const plan = useQuery({
    queryKey: ['preparation', signer.address, mint, input?.units.toString() ?? null],
    queryFn: () => {
      if (!input) throw new Error('nothing to plan')
      return ports.ops.plan(wallet.account, wallet.decimals, { owner: signer, mint, ...input })
    },
    enabled: input !== null,
    refetchInterval: false,
    retry: false,
  })
  const planned: readonly PreparationStep['kind'][] | null = plan.data
    ? plan.data.steps.map((s) => s.kind)
    : null
  return { planned, planProblem: plan.isError ? plan.error.message : null }
}

type WalletLineProps = {
  signer: TransactionSendingSigner
  wallet: TokenAccount & { lamports: bigint }
  publicBalance: bigint
  keys: ConfidentialKeys | null
}

function WalletLine({ signer, wallet, publicBalance, keys }: WalletLineProps) {
  const sealed = keys && wallet.account ? decryptAvailable(keys.ae(), wallet.account) : null
  return (
    <div className="mt-1 text-xs italic text-muted">
      as <Mono>{trunc(signer.address)}</Mono> ·{' '}
      {formatUnits(publicBalance.toString(), wallet.decimals)} {TOKEN} and{' '}
      {formatUnits(wallet.lamports.toString(), 9)} SOL in your wallet
      {sealed?.ok
        ? ` · sealed balance ${formatUnits(sealed.units.toString(), wallet.decimals)} ${TOKEN}`
        : ''}
    </div>
  )
}

type ContributionOptions = {
  signer: TransactionSendingSigner
  profile: CreatorProfile
  mint: Address
  payer: Address
  units: bigint | null
  periods: number
  showPublicly: boolean
  onProgress: (progress: Progress | null) => void
  refresh: () => Promise<unknown>
}

function useContribution(options: ContributionOptions) {
  const queryClient = useQueryClient()
  const { keys, derive } = useConfidentialKeys()
  const { signer, profile, mint, payer, units, periods, showPublicly, onProgress, refresh } =
    options

  return useMutation({
    mutationFn: async (): Promise<Outcome> => {
      if (units === null || units <= 0n) throw new Error('enter an amount')
      let signatures = 0
      let derived = keys
      if (!derived) {
        if (!derive) throw new Error('no wallet to derive the keys with')
        derived = await derive()
        signatures = 1
      }
      return runContribution(
        { ...ports, onProgress },
        {
          keys: derived,
          supporter: signer,
          creator: profile.wallet,
          mint,
          units,
          periods,
          showPublicly,
          payer,
        },
        signatures,
      )
    },
    onMutate: () => onProgress(null),
    onSettled: () =>
      Promise.all([
        refresh(),
        queryClient.invalidateQueries({ queryKey: ['creator', profile.handle] }),
        queryClient.invalidateQueries({ queryKey: ['supporters', profile.handle] }),
      ]),
  })
}

type FaucetProps = { wallet: Address; refresh: () => Promise<unknown> }

function Faucet({ wallet, refresh }: FaucetProps) {
  const faucet = useMutation({
    mutationFn: () => requestFaucet(webEnv.apiUrl, wallet),
    onSuccess: () => refresh(),
  })
  return (
    <p className="mt-2">
      <button
        type="button"
        className="act"
        disabled={faucet.isPending}
        onClick={() => faucet.mutate()}
      >
        {faucet.isPending ? 'asking the faucet…' : `Get devnet funds: 0.02 SOL and 100 ${TOKEN}`}
      </button>
      {faucet.isError && <span className="ml-3 text-refused">{faucet.error.message}</span>}
      {faucet.isSuccess && (
        <span className="ml-3 help">
          sent · <Mono>{trunc(faucet.data.signature)}</Mono>
        </span>
      )}
    </p>
  )
}

type DoneProps = { outcome: Outcome; profile: CreatorProfile; periods: number; listed: boolean }

function Done({ outcome, profile, periods, listed }: DoneProps) {
  return (
    <>
      <div className="mt-4 border-t border-b border-t-ink border-b-rule py-3">
        Recorded. Your support of {profile.name} for {periods}{' '}
        {periods === 1 ? 'period' : 'periods'} is on chain — {outcome.signatures}{' '}
        {outcome.signatures === 1 ? 'signature' : 'signatures'} in the wallet. Transaction{' '}
        <a
          href={explorerUrl(outcome.transfer, webEnv.chain)}
          className="act"
          target="_blank"
          rel="noreferrer"
        >
          <Mono>{trunc(outcome.transfer)}</Mono>
        </a>
        .
      </div>
      <div className="help mt-4 mb-1">What the explorer shows</div>
      <div className="clip">
        <div className="font-mono text-xs">
          Confidential transfer · you → {trunc(profile.wallet)} · amount <Sealed revealed={false} />
        </div>
        <div className="font-mono text-xs">
          ccsupport · pledge · periods {periods} · listed {listed ? 'yes' : 'no'}
        </div>
        {outcome.preparation && (
          <div className="font-mono text-xs">preparation {trunc(outcome.preparation)}</div>
        )}
        <div className="font-mono text-xs">
          proofs {outcome.proofs.map(trunc).join(', ')} · paid by the platform
        </div>
      </div>
      {outcome.closeError && (
        <p className="help">
          The proof accounts were not closed ({outcome.closeError}); their rent stays with the
          platform, not with you. Your support is recorded regardless.
        </p>
      )}
      <p className="mt-6">
        <Link to={`/c/${profile.handle}`} className="act">
          Back to the page
        </Link>
      </p>
    </>
  )
}
