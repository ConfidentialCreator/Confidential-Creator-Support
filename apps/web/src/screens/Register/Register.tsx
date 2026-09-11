import {
  type Creator,
  creatorPda,
  fetchMaybeCreator,
  registerCreatorInstruction,
  updateCreatorInstruction,
} from '@ccsupport/chain'
import {
  address,
  createSolanaRpc,
  type Signature,
  type TransactionSendingSigner,
} from '@solana/kit'
import { useSelectedWalletAccount, useWalletAccountTransactionSendingSigner } from '@solana/react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { UiWalletAccount } from '@wallet-standard/react'
import { type FormEvent, type ReactNode, useMemo, useState } from 'react'
import { Link } from 'react-router'
import { fetchCreator } from '../../api/creators.ts'
import { Chrome, Mono } from '../../components/Chrome.tsx'
import { webEnv } from '../../config.ts'
import { TOKEN, trunc } from '../../mockData.ts'
import { formatUnits, TOKEN_DECIMALS } from '../CreatorPage/format.ts'
import { handleFromBytes, parseUnits, validateProfile } from './form.ts'
import { chainPort, sendInstruction, waitConfirmed } from './submit.ts'

const rpc = createSolanaRpc(webEnv.rpcUrl)
const port = chainPort(rpc)

export function Register() {
  const [account] = useSelectedWalletAccount()
  return (
    <Chrome>
      {account ? (
        <WithAccount key={account.address} account={account} />
      ) : (
        <>
          <h1 className="text-2xl font-normal">Register as a creator</h1>
          <p className="mb-3">Connect a wallet above — the profile is written on chain by it.</p>
        </>
      )}
    </Chrome>
  )
}

function WithAccount({ account }: { account: UiWalletAccount }) {
  const signer = useWalletAccountTransactionSendingSigner(account, webEnv.chain)
  const onChain = useQuery({
    queryKey: ['creator-account', account.address],
    queryFn: async () => {
      const [pda] = await creatorPda(address(account.address))
      const maybe = await fetchMaybeCreator(rpc, pda)
      return maybe.exists ? maybe.data : null
    },
    refetchInterval: false,
  })

  if (onChain.isPending) return <div className="help">reading the chain…</div>
  if (onChain.isError) {
    return <div className="text-refused">the chain did not answer: {onChain.error.message}</div>
  }
  return onChain.data ? (
    <EditForm signer={signer} creator={onChain.data} />
  ) : (
    <RegisterForm signer={signer} />
  )
}

function RegisterForm({ signer }: { signer: TransactionSendingSigner }) {
  const queryClient = useQueryClient()
  const [handle, setHandle] = useState('')
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [problem, setProblem] = useState<string | null>(null)

  const register = useMutation({
    mutationFn: async (input: { handle: string; name: string; description: string }) => {
      // The program refuses a taken handle, but only after the wallet asked for a signature.
      if ((await fetchCreator(webEnv.apiUrl, input.handle)) !== null) {
        throw new Error(`the handle ${input.handle} is already taken`)
      }
      const signature = await sendInstruction(
        port,
        signer,
        await registerCreatorInstruction({ wallet: signer, ...input }),
      )
      await waitConfirmed(port, signature)
      return { signature, handle: input.handle }
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['creator-account'] }),
  })

  const submit = (event: FormEvent) => {
    event.preventDefault()
    const checked = validateProfile({ handle, name, description })
    if (!checked.ok) {
      setProblem(`${checked.field}: ${checked.message}`)
      return
    }
    setProblem(null)
    register.mutate(checked.value)
  }

  if (register.isSuccess) {
    return (
      <>
        <h1 className="text-2xl font-normal">Registered</h1>
        <p className="mb-3">
          Transaction <Mono>{trunc(register.data.signature)}</Mono>. The public page shows the
          profile once the index has read the transaction — a few seconds.
        </p>
        <p>
          <Link to={`/c/${register.data.handle}`} className="act">
            Open the page
          </Link>
        </p>
      </>
    )
  }

  return (
    <form onSubmit={submit}>
      <h1 className="text-2xl font-normal">Register as a creator</h1>
      <p className="mb-3">
        One transaction from <Mono>{trunc(signer.address)}</Mono>; the wallet pays the rent of two
        small accounts. The suggested support figure is set afterwards.
      </p>
      <Field id="handle" label="Handle" hint="the page address: /c/<handle>">
        <input
          id="handle"
          className="field"
          value={handle}
          onChange={(e) => setHandle(e.target.value)}
          placeholder="marrow-dispatch"
          autoCapitalize="none"
          spellCheck={false}
        />
      </Field>
      <Field id="name" label="Name" hint="up to 64 bytes">
        <input id="name" className="field" value={name} onChange={(e) => setName(e.target.value)} />
      </Field>
      <Field id="description" label="Description" hint="up to 256 bytes">
        <textarea
          id="description"
          className="field"
          rows={3}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
      </Field>
      <Outcome problem={problem} error={register.error} busy={register.isPending} />
      <button type="submit" className="act" disabled={register.isPending}>
        {register.isPending ? 'waiting for the wallet and the chain…' : 'Register on chain'}
      </button>
    </form>
  )
}

function EditForm({ signer, creator }: { signer: TransactionSendingSigner; creator: Creator }) {
  const queryClient = useQueryClient()
  const handle = useMemo(() => handleFromBytes(creator.handle), [creator.handle])
  const [name, setName] = useState(creator.name)
  const [description, setDescription] = useState(creator.description)
  const [suggested, setSuggested] = useState(
    formatUnits(creator.suggestedAmount.toString(), TOKEN_DECIMALS),
  )
  const [problem, setProblem] = useState<string | null>(null)

  const update = useMutation({
    mutationFn: async (input: { name: string; description: string; suggestedAmount: bigint }) => {
      const signature = await sendInstruction(
        port,
        signer,
        await updateCreatorInstruction({ wallet: signer, ...input }),
      )
      await waitConfirmed(port, signature)
      return signature
    },
    onSuccess: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: ['creator-account'] }),
        queryClient.invalidateQueries({ queryKey: ['creator', handle] }),
      ]),
  })

  const submit = (event: FormEvent) => {
    event.preventDefault()
    const checked = validateProfile({ handle, name, description })
    if (!checked.ok) {
      setProblem(`${checked.field}: ${checked.message}`)
      return
    }
    const suggestedAmount = parseUnits(suggested, TOKEN_DECIMALS)
    if (suggestedAmount === null) {
      setProblem(`suggested support: a ${TOKEN} figure with up to ${TOKEN_DECIMALS} decimals`)
      return
    }
    setProblem(null)
    update.mutate({
      name: checked.value.name,
      description: checked.value.description,
      suggestedAmount,
    })
  }

  return (
    <form onSubmit={submit}>
      <h1 className="text-2xl font-normal">Your creator profile</h1>
      <p className="mb-3">
        <Mono>{trunc(signer.address)}</Mono> is registered as{' '}
        <Link to={`/c/${handle}`} className="act">
          /c/{handle}
        </Link>
        . The handle cannot change; everything below can, one transaction per save.
      </p>
      <Field id="name" label="Name" hint="up to 64 bytes">
        <input id="name" className="field" value={name} onChange={(e) => setName(e.target.value)} />
      </Field>
      <Field id="description" label="Description" hint="up to 256 bytes">
        <textarea
          id="description"
          className="field"
          rows={3}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
      </Field>
      <Field
        id="suggested"
        label={`Suggested support, ${TOKEN}`}
        hint="public; the chain accepts any figure"
      >
        <input
          id="suggested"
          className="field"
          value={suggested}
          onChange={(e) => setSuggested(e.target.value)}
          inputMode="decimal"
        />
      </Field>
      <Outcome
        problem={problem}
        error={update.error}
        busy={update.isPending}
        saved={update.data ?? null}
      />
      <button type="submit" className="act" disabled={update.isPending}>
        {update.isPending ? 'waiting for the wallet and the chain…' : 'Save on chain'}
      </button>
    </form>
  )
}

type FieldProps = { id: string; label: string; hint: string; children: ReactNode }

function Field({ id, label, hint, children }: FieldProps) {
  return (
    <div className="mb-4">
      <label htmlFor={id} className="text-xs italic text-muted">
        {label} · {hint}
      </label>
      {children}
    </div>
  )
}

type OutcomeProps = {
  problem: string | null
  error: Error | null
  busy: boolean
  saved?: Signature | null
}

function Outcome({ problem, error, busy, saved = null }: OutcomeProps) {
  if (busy) return null
  if (problem) return <div className="mb-3 text-refused">{problem}</div>
  if (error) return <div className="mb-3 text-refused">{error.message}</div>
  if (saved) {
    return (
      <div className="help">
        saved · transaction <Mono>{trunc(saved)}</Mono>
      </div>
    )
  }
  return null
}
