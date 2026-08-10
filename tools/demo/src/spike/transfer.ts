// Спайк S1 (T006): повний конфіденційний переказ на devnet тим самим SDK, що піде в
// продукт. Міряє кількість і розмір транзакцій, запас під `pledge` у транзакції
// переказу, час побудови доказів; знімає сирі транзакції у `fixtures/tx/`.
//
// Запуск: pnpm --filter @ccsupport/demo spike:transfer (читає `.env` з кореня).
import { readFileSync } from 'node:fs'
import {
  type Address,
  appendTransactionMessageInstructions,
  assertIsSuccessfulTransactionPlanResult,
  assertIsTransactionWithBlockhashLifetime,
  createKeyPairSignerFromBytes,
  createSolanaRpc,
  createSolanaRpcSubscriptions,
  createTransactionMessage,
  createTransactionPlanExecutor,
  createTransactionPlanner,
  generateKeyPairSigner,
  getAddressDecoder,
  getBase64EncodedWireTransaction,
  getSignatureFromTransaction,
  getTransactionSize,
  getTransactionSizeLimit,
  type Instruction,
  type InstructionPlan,
  type KeyPairSigner,
  lamports,
  pipe,
  type Signature,
  sendAndConfirmTransactionFactory,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  signTransactionMessageWithSigners,
  some,
  type TransactionMessage,
  type TransactionMessageWithFeePayer,
} from '@solana/kit'
import { AeKey, ElGamalCiphertext, ElGamalKeypair, ElGamalSecretKey } from '@solana/zk-sdk'
import { getTransferSolInstruction } from '@solana-program/system'
import {
  extension,
  fetchToken,
  findAssociatedTokenPda,
  getConfidentialDepositInstruction,
  getCreateMintInstructionPlan,
  getMintToInstruction,
  parseConfidentialTransferInstruction,
  TOKEN_2022_PROGRAM_ADDRESS,
} from '@solana-program/token-2022'
import {
  deriveAeKeyForOwnerMint,
  deriveElGamalKeypairForOwnerMint,
  fetchConfidentialTransferBalance,
  getApplyConfidentialPendingBalanceInstructionFromToken,
  getConfidentialTransferWithRecordInstructionPlan,
  getCreateConfidentialTransferAccountInstructionPlan,
} from '@solana-program/token-2022/confidential'
import { z } from 'zod'
import { type TxFixture, writeFixture } from './fixture.ts'
import { findConfidentialTransfer, syntheticPledge } from './instructions.ts'

const env = z
  .object({ SOLANA_RPC_URL: z.url(), SPIKE_PAYER_KEYPAIR: z.string().min(1) })
  .parse(process.env)

const DECIMALS = 6
const DEPOSIT_UNITS = 25_000_000n
const TRANSFER_UNITS = 7_250_000n
// Скільки акаунтів `pledge` додає до тих, що вже є в транзакції переказу
// (прихильник-підписант уже там): config, creator, pledge, sysvar Instructions,
// System — 4 за планом T006, 5–6 із запасом.
const PLEDGE_EXTRA_ACCOUNTS = [4, 5, 6]

const rpc = createSolanaRpc(env.SOLANA_RPC_URL)
const rpcSubscriptions = createSolanaRpcSubscriptions(env.SOLANA_RPC_URL.replace(/^http/, 'ws'))
const sendAndConfirm = sendAndConfirmTransactionFactory({ rpc, rpcSubscriptions })
const rentClient = {
  getMinimumBalance: (space: number) => rpc.getMinimumBalanceForRentExemption(BigInt(space)).send(),
}

type Sent = { label: string; signature: Signature; sizeBytes: number; instructions: number }
const sent: Sent[] = []

type Message = TransactionMessage & TransactionMessageWithFeePayer

async function send(label: string, message: Message): Promise<Sent> {
  const { value: blockhash } = await rpc.getLatestBlockhash({ commitment: 'confirmed' }).send()
  const transaction = await signTransactionMessageWithSigners(
    setTransactionMessageLifetimeUsingBlockhash(blockhash, message),
  )
  assertIsTransactionWithBlockhashLifetime(transaction)
  const started = performance.now()
  await sendAndConfirm(transaction, { commitment: 'confirmed' })
  const row = {
    label,
    signature: getSignatureFromTransaction(transaction),
    sizeBytes: getTransactionSize(transaction),
    instructions: message.instructions.length,
  }
  sent.push(row)
  console.log(
    `  ${label.padEnd(18)} ${String(row.sizeBytes).padStart(5)} B  ${row.instructions} ix  ${Math.round(performance.now() - started)} ms  ${row.signature}`,
  )
  return row
}

function messageFor(payer: KeyPairSigner, instructions: Instruction[]): Message {
  return pipe(
    createTransactionMessage({ version: 0 }),
    (m) => setTransactionMessageFeePayerSigner(payer, m),
    (m) => appendTransactionMessageInstructions(instructions, m),
  )
}

async function runPlan(
  label: string,
  payer: KeyPairSigner,
  plan: InstructionPlan,
): Promise<Sent[]> {
  const planner = createTransactionPlanner({
    createTransactionMessage: () =>
      pipe(createTransactionMessage({ version: 0 }), (m) =>
        setTransactionMessageFeePayerSigner(payer, m),
      ),
  })
  const before = sent.length
  let n = 0
  const executor = createTransactionPlanExecutor({
    executeTransactionMessage: async (_context, message) => {
      n += 1
      const { signature } = await send(`${label}-${n}`, message)
      return { signature }
    },
  })
  const result = await executor(await planner(plan))
  assertIsSuccessfulTransactionPlanResult(result)
  const rows = sent.slice(before)
  if (rows.length === 1 && rows[0]) rows[0].label = label
  return rows
}

function splitTransferPlan(plan: InstructionPlan) {
  if (plan.kind !== 'sequential' || plan.plans.length !== 3) {
    throw new Error(`unexpected transfer plan shape: ${plan.kind}`)
  }
  const [setup, transfer, cleanup] = plan.plans
  if (!setup || !cleanup || transfer?.kind !== 'single') {
    throw new Error('unexpected transfer plan shape: middle plan is not the transfer')
  }
  return { setup, transfer: transfer.instruction, cleanup }
}

function hex(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('hex')
}

function elgamalAddress(keypair: ElGamalKeypair): Address {
  return getAddressDecoder().decode(new Uint8Array(keypair.pubkey().toBytes()))
}

async function deriveKeys(owner: KeyPairSigner, mint: Address) {
  const started = performance.now()
  const elgamal = await deriveElGamalKeypairForOwnerMint({
    signer: owner,
    owner: owner.address,
    mint,
  })
  const ae = await deriveAeKeyForOwnerMint({ signer: owner, owner: owner.address, mint })
  return {
    elgamal: ElGamalKeypair.fromSecretKey(ElGamalSecretKey.fromBytes(elgamal.secretKey)),
    elgamalSecret: elgamal.secretKey,
    ae: AeKey.fromBytes(ae),
    aeBytes: ae,
    ms: performance.now() - started,
  }
}

async function snapshot(row: Sent, context: TxFixture['context']): Promise<void> {
  const tx = await rpc
    .getTransaction(row.signature, {
      encoding: 'base64',
      maxSupportedTransactionVersion: 0,
      commitment: 'confirmed',
    })
    .send()
  if (!tx) throw new Error(`transaction ${row.signature} not found`)
  writeFixture(row.label, {
    label: row.label,
    cluster: 'devnet',
    signature: row.signature,
    slot: Number(tx.slot),
    blockTime: tx.blockTime === null ? null : Number(tx.blockTime),
    sizeBytes: row.sizeBytes,
    wire: tx.transaction[0],
    logMessages: [...(tx.meta?.logMessages ?? [])],
    context,
  })
}

async function main() {
  const payerBytes = z
    .array(z.number().int().min(0).max(255))
    .length(64)
    .parse(JSON.parse(readFileSync(env.SPIKE_PAYER_KEYPAIR, 'utf8')))
  const payer = await createKeyPairSignerFromBytes(new Uint8Array(payerBytes))
  const supporter = await generateKeyPairSigner()
  const creator = await generateKeyPairSigner()
  const mint = await generateKeyPairSigner()
  const auditor = new ElGamalKeypair()
  console.log(
    `payer ${payer.address}\nsupporter ${supporter.address}\ncreator ${creator.address}\nmint ${mint.address}`,
  )

  console.log('\n— підготовка')
  await send(
    'fund',
    messageFor(payer, [
      getTransferSolInstruction({
        source: payer,
        destination: supporter.address,
        amount: lamports(10_000_000n),
      }),
    ]),
  )
  await runPlan(
    'mint',
    payer,
    await getCreateMintInstructionPlan(rentClient, {
      payer,
      newMint: mint,
      decimals: DECIMALS,
      mintAuthority: payer,
      extensions: [
        extension('ConfidentialTransferMint', {
          authority: some(payer.address),
          autoApproveNewAccounts: true,
          auditorElgamalPubkey: some(elgamalAddress(auditor)),
        }),
      ],
    }),
  )

  const supporterKeys = await deriveKeys(supporter, mint.address)
  const creatorKeys = await deriveKeys(creator, mint.address)
  console.log(
    `  деривація ElGamal+AES: ${supporterKeys.ms.toFixed(1)} ms (прихильник), ${creatorKeys.ms.toFixed(1)} ms (автор)`,
  )

  const [supporterToken] = await findAssociatedTokenPda({
    owner: supporter.address,
    mint: mint.address,
    tokenProgram: TOKEN_2022_PROGRAM_ADDRESS,
  })
  const [creatorToken] = await findAssociatedTokenPda({
    owner: creator.address,
    mint: mint.address,
    tokenProgram: TOKEN_2022_PROGRAM_ADDRESS,
  })

  console.log('\n— перший внесок: підготовка гаманця прихильника (і автора)')
  const [configureRow] = await runPlan(
    'configure',
    payer,
    await getCreateConfidentialTransferAccountInstructionPlan({
      payer,
      owner: supporter,
      mint: mint.address,
      rpc,
      elgamalKeypair: supporterKeys.elgamal,
      aesKey: supporterKeys.ae,
    }),
  )
  await runPlan(
    'configure-creator',
    payer,
    await getCreateConfidentialTransferAccountInstructionPlan({
      payer,
      owner: creator,
      mint: mint.address,
      rpc,
      elgamalKeypair: creatorKeys.elgamal,
      aesKey: creatorKeys.ae,
    }),
  )
  await send(
    'mint-to',
    messageFor(payer, [
      getMintToInstruction({
        mint: mint.address,
        token: supporterToken,
        mintAuthority: payer,
        amount: DEPOSIT_UNITS,
      }),
    ]),
  )
  const depositRow = await send(
    'deposit',
    messageFor(payer, [
      getConfidentialDepositInstruction({
        token: supporterToken,
        mint: mint.address,
        authority: supporter,
        amount: DEPOSIT_UNITS,
        decimals: DECIMALS,
      }),
    ]),
  )
  const applyRow = await send(
    'apply',
    messageFor(payer, [
      getApplyConfidentialPendingBalanceInstructionFromToken({
        token: supporterToken,
        tokenAccount: (await fetchToken(rpc, supporterToken)).data,
        authority: supporter,
        elgamalSecretKey: supporterKeys.elgamal.secret(),
        aesKey: supporterKeys.ae,
      }),
    ]),
  )

  console.log(
    '\n— повторний внесок: три докази (платник), переказ (прихильник), закриття (платник)',
  )
  const contributionStarted = performance.now()
  const buildStarted = performance.now()
  const transferPlan = await getConfidentialTransferWithRecordInstructionPlan({
    sourceToken: supporterToken,
    mint: mint.address,
    destinationToken: creatorToken,
    sourceTokenAccount: (await fetchToken(rpc, supporterToken)).data,
    destinationTokenAccount: (await fetchToken(rpc, creatorToken)).data,
    authority: supporter,
    amount: TRANSFER_UNITS,
    sourceElgamalKeypair: supporterKeys.elgamal,
    aesKey: supporterKeys.ae,
    payer,
    rpc,
  })
  const buildMs = performance.now() - buildStarted
  const { setup, transfer, cleanup } = splitTransferPlan(transferPlan)

  const proofRows = await runPlan('proof', payer, setup)
  const transferRow = await send('transfer', messageFor(supporter, [transfer]))
  const transferConfirmedMs = performance.now() - contributionStarted
  const closeRows = await runPlan('close', payer, cleanup)
  const contributionMs = performance.now() - contributionStarted

  const applyCreatorRow = await send(
    'apply-creator',
    messageFor(payer, [
      getApplyConfidentialPendingBalanceInstructionFromToken({
        token: creatorToken,
        tokenAccount: (await fetchToken(rpc, creatorToken)).data,
        authority: creator,
        elgamalSecretKey: creatorKeys.elgamal.secret(),
        aesKey: creatorKeys.ae,
      }),
    ]),
  )

  console.log('\n— запас під `pledge` у транзакції переказу (лише компіляція, програми ще немає)')
  const { value: blockhash } = await rpc.getLatestBlockhash().send()
  const pledgeSizes: Array<{ extra: number; sizeBytes: number }> = []
  for (const extra of PLEDGE_EXTRA_ACCOUNTS) {
    const tx = await signTransactionMessageWithSigners(
      setTransactionMessageLifetimeUsingBlockhash(
        blockhash,
        messageFor(supporter, [transfer, syntheticPledge(supporter.address, extra)]),
      ),
    )
    pledgeSizes.push({ extra, sizeBytes: getTransactionSize(tx) })
  }

  console.log('\n— перевірка: дискримінатори, розшифрування')
  const transferIndex = findConfidentialTransfer([transfer])
  const parsed = parseConfidentialTransferInstruction({
    ...transfer,
    accounts: transfer.accounts ?? [],
    data: transfer.data ?? new Uint8Array(),
  })
  const auditorLo = ElGamalCiphertext.fromBytes(
    new Uint8Array(parsed.data.transferAmountAuditorCiphertextLo),
  )
  const auditorHi = ElGamalCiphertext.fromBytes(
    new Uint8Array(parsed.data.transferAmountAuditorCiphertextHi),
  )
  if (!auditorLo || !auditorHi) throw new Error('auditor ciphertexts do not parse')
  const decryptStarted = performance.now()
  const auditorAmount =
    auditor.secret().decrypt(auditorLo) + (auditor.secret().decrypt(auditorHi) << 16n)
  const auditorDecryptMs = performance.now() - decryptStarted
  const creatorBalance = await fetchConfidentialTransferBalance({
    rpc,
    token: creatorToken,
    elgamalSecretKey: creatorKeys.elgamal.secret(),
    aesKey: creatorKeys.ae,
  })
  const supporterBalance = await fetchConfidentialTransferBalance({
    rpc,
    token: supporterToken,
    elgamalSecretKey: supporterKeys.elgamal.secret(),
    aesKey: supporterKeys.ae,
  })

  const context: TxFixture['context'] = {
    mint: mint.address,
    decimals: DECIMALS,
    supporter: supporter.address,
    supporterToken,
    creator: creator.address,
    creatorToken,
    auditorElgamalPubkey: elgamalAddress(auditor),
    amount: TRANSFER_UNITS.toString(),
    keys: {
      supporterElgamalSecret: hex(supporterKeys.elgamalSecret),
      supporterAe: hex(supporterKeys.aeBytes),
      creatorElgamalSecret: hex(creatorKeys.elgamalSecret),
      creatorAe: hex(creatorKeys.aeBytes),
      auditorElgamalSecret: hex(new Uint8Array(auditor.secret().toBytes())),
    },
  }
  console.log('\n— фікстури')
  for (const row of [
    configureRow,
    depositRow,
    applyRow,
    ...proofRows,
    transferRow,
    ...closeRows,
    applyCreatorRow,
  ]) {
    if (row) await snapshot(row, context)
  }

  const transferTx = await signTransactionMessageWithSigners(
    setTransactionMessageLifetimeUsingBlockhash(blockhash, messageFor(supporter, [transfer])),
  )
  const largest = sent.reduce((a, b) => (b.sizeBytes > a.sizeBytes ? b : a))
  console.log('\n=== ПІДСУМОК ===')
  console.log(
    `транзакцій усього: ${sent.length}; найбільша: ${largest.label} ${largest.sizeBytes} B`,
  )
  console.log(
    `повторний внесок: ${proofRows.length} tx доказів + 1 переказ + ${closeRows.length} закриття; переказ підтверджено за ${(transferConfirmedMs / 1000).toFixed(1)} s, усе разом ${(contributionMs / 1000).toFixed(1)} s`,
  )
  console.log(`побудова трьох доказів у Node: ${buildMs.toFixed(0)} ms`)
  console.log(
    `переказ: ${transferRow.sizeBytes} B (base64 ${getBase64EncodedWireTransaction(transferTx).length}), ${transfer.accounts?.length ?? 0} акаунтів в інструкції, дискримінатори ${transfer.data?.[0]}/${transfer.data?.[1]}, знайдено: ${transferIndex === 0}`,
  )
  for (const { extra, sizeBytes } of pledgeSizes) {
    console.log(
      `  + pledge (${extra} нових акаунтів, 13 B даних): ${sizeBytes} B, запас ${getTransactionSizeLimit(transferTx) - sizeBytes} B`,
    )
  }
  console.log(
    `аудитор розшифрував суму з інструкції: ${auditorAmount} (очікувано ${TRANSFER_UNITS}) за ${auditorDecryptMs.toFixed(0)} ms`,
  )
  console.log(
    `автор: available ${creatorBalance.availableBalance}, pending ${creatorBalance.pendingBalance}; прихильник: available ${supporterBalance.availableBalance} (очікувано ${DEPOSIT_UNITS - TRANSFER_UNITS})`,
  )
  if (auditorAmount !== TRANSFER_UNITS || creatorBalance.availableBalance !== TRANSFER_UNITS) {
    throw new Error('amounts do not match')
  }
}

main().then(
  () => process.exit(0),
  (error) => {
    console.error(error)
    process.exit(1)
  },
)
