# Confidential Creator Support

Recurring support for creators — journalists, activists, independent media — on Solana.
The **fact** of support is public and verifiable on chain; the **amount** of every
contribution is encrypted (Token-2022 confidential transfers) and readable only by the
supporter, the creator and the holder of the audit key.

A creator's page shows how many people support them this period, counted from the chain.
Nobody — not the page, not the indexer, not an explorer — can see how much any of them gave.

## Roles

- **Supporter** — connects a wallet, gets a one-time key pair for confidential balances
  derived from a wallet signature, contributes any amount for 1..12 periods of 30 days in a
  single payment. Nothing renews by itself; there is no auto-charge.
- **Creator** — registers a handle and profile on chain from their wallet, sees the total
  received and every contribution decrypted in the browser (the keys live in the tab only).
- **Operator** (the client, in the demo and at launch) — issues the demo token, keeps the audit
  key and the mint authority offline, and funds one server key that pays for the zero-knowledge
  proof transactions. The server never holds a supporter's or a creator's key.

## What v0.1.0 shows — and what it does not

Shown, on devnet: a clean wallet gets devnet funds → prepares its confidential balance →
contributes to a creator → the transaction is on the explorer with no amount in it → the
creator's page counter goes up → the creator's cabinet shows the amount. A script raises 128
synthetic supporters (plus 24 repeat contributions) in about 20 minutes with no manual steps.

Measured on devnet (`fixtures/demo-run.json`, `fixtures/measure.json`):

| Criterion | Budget | Measured |
|---|---|---|
| No amount recoverable from the transaction, logs or either token account | 100 % | 152/152 (demo) + 6/6 (probes) |
| Page counter matches the chain after a confirmation | ≤ 30 s | 1.8 s max (index), the page polls every 10 s |
| Repeat contribution: click → confirmed | ≤ 60 s p95, ≤ 2 wallet confirmations | 12.0 s p95 alone (33.6 s under load), 1 confirmation |
| First contribution (with wallet preparation) | ≤ 3 min, ≤ 6 confirmations | 18.9 s in the browser, 3 confirmations |
| Creator's cabinet decrypts every contribution | 128 in ≤ 20 s | 420 in 8.9 s, first amount in 0.4 s |
| 128 supporters raised by script | ≤ 30 min | 20.0 min |

Not in v0.1.0, on purpose: renewal reminders and expiry dates in the UI; the supporter's own
cabinet (a supporter does not see their contribution in the app); selective disclosure of an
amount and the auditor's tool (the audit key exists in the mint, but nothing reads with it yet);
withdrawal (a creator's funds stay in the confidential balance). Everything runs on a laptop,
not on hosting. The token is a demo mint (`SUPD`), not a stablecoin; supporters get it from a
devnet faucet.

The devnet demo does not prove: fee economics on mainnet, behaviour with a public stablecoin
whose audit key belongs to someone else, or throughput at thousands of supporters.

## Wallets

Any Wallet Standard wallet that offers `solana:signMessage` and `solana:signAndSendTransaction`
(Phantom, Solflare, Backpack and the like). Wallets do not make confidential transfers
themselves: the app builds every transaction and the wallet only signs. The confidential keys
(ElGamal + AES) come from one signature over a canonical message and never leave the tab.
A wallet without message signing cannot derive the keys.

## How it holds

- **The amount exists only in ciphertexts.** No amount field in the program, the database or
  the API — `scripts/amount-guard.mjs` runs in the gate and fails on the first one. Decryption
  happens in the key holder's browser.
- **The program verifies the fact of support, not the indexer.** `pledge` reads the
  `Instructions` sysvar and requires a Token-2022 confidential `Transfer` from the supporter to
  the creator, in this mint, in the same transaction. No transfer, no record.
- **One key on the server, and it only pays.** The relay accepts transactions from an
  allow-list (ZkElGamalProof, Record, System `CreateAccount`) with the platform as fee payer;
  it cannot move tokens.
- **Every counter on a page can be rebuilt from chain state** without the platform.

Devnet addresses: program `8tX3MJt6vzw9fw7gAeBdEtom5cfXR8BMZn9UCPQJrj6z`, demo mint
`HApEuJSUaLofM9Z7PUhAKfxpHkapxBTmpdsnjG9nud36`.

## Run locally

Requirements: Node 22+, pnpm, a Postgres (Supabase) project, a devnet RPC (Helius Free is
enough), and — only to build or deploy the program — WSL with Rust, Solana CLI 3.1 and
Anchor 1.2.

```bash
pnpm install
cp .env.example .env      # fill it in: RPC, mint, Supabase, payer and faucet keys
pnpm --filter @ccsupport/db db:migrate
pnpm dev                  # worker (indexer), api on :8787, web on :5173
pnpm gate                 # amount guard + lint + typecheck + test — green before every commit
```

The operator's one-time steps live in `tools/mint`: `create-mint` (the token with the
confidential extension and the audit key), `mint-to` (fund the faucet), `init-config` (the
program's `Config` for this mint). Keys are read from `CCS_KEYS_DIR` and never enter the repo.

The demo and the measurements: `pnpm --filter @ccsupport/demo demo` raises the supporters
against an in-process API; `pnpm --filter @ccsupport/demo measure` probes a running API and
worker and writes `fixtures/measure.json`.

On-chain work runs in WSL and is called from PowerShell:
`wsl.exe -e bash /mnt/<drive>/<repo>/scripts/wsl-build.sh <build-sbf|idl|build|fmt|fmt-check|clippy|test|gate>`
and `scripts/wsl-deploy.sh <deploy|verify|status>`. The network artifact is SBPFv0
(`build-sbf`); `anchor build` is only for the IDL.

## Web on GitHub Pages

`.github/workflows/pages.yml` builds `apps/web` on every push to `main` and deploys it to
GitHub Pages under `/<repository>/` (a custom domain sets the variable `PAGES_BASE_PATH=/`).
One-time repository settings: **Pages → Source: GitHub Actions**; variables `VITE_API_URL`,
`VITE_CCS_MINT`, `VITE_SOLANA_CLUSTER`; secret `VITE_SOLANA_RPC_URL`. The RPC key ends up in
the bundle like any `VITE_*` value — restrict it to the Pages domain in the RPC provider.

Pages hosts the static web only. The api (proof relay, faucet, read routes) and the worker
(indexer) are processes with a payer key and a database connection — they run elsewhere, the
api's `WEB_ORIGIN` is the Pages origin, and `VITE_API_URL` points at the api.

## Api and indexer on Render (free)

`render.yaml` is a Render Blueprint for one free web service: the api with the indexer
running inside it (`RUN_WORKER=true` — the free instance cannot run a background worker).
Steps: Render → New → Blueprint → this repository; fill in the `sync: false` variables
(`WEB_ORIGIN` = the Pages origin, `SOLANA_RPC_URL`, `DATABASE_URL` on the 6543 pooler,
`CCS_MINT`, `PROOF_PAYER_SECRET`, `FAUCET_SECRET`); run `db:migrate` once from a machine with
`MIGRATE_DATABASE_URL`. The service answers on `https://<name>.onrender.com` — that is
`VITE_API_URL` for Pages.

A free instance spins down after 15 minutes without traffic and takes about a minute to
come back; while it sleeps the index does not move (the backfill catches up on wake). A free
uptime pinger (cron-job.org, UptimeRobot) hitting `/health` every 10 minutes keeps it awake,
and the 750 free hours a month cover one service around the clock. The process idles at
about 105 MB, well inside the 512 MB of the free instance.

## Layout

- `programs/ccsupport` — Anchor program: creator registry and pledges, no amounts.
  Tests run the real `.so` under mollusk.
- `packages/chain` — client: key derivation, confidential transfers, contribution builder,
  decryption, generated program client (Codama).
- `packages/shared` — Zod schemas shared by the API and the web, period constants.
- `packages/db` — Drizzle schema and read queries for the index (Supabase).
- `apps/api` — Hono: proof relay, public read routes, devnet faucet.
- `apps/worker` — indexer: program events → index, backfill plus a log subscription.
- `apps/web` — React + Vite: creator page, support flow, creator cabinet.
- `tools/mint`, `tools/demo` — operator commands; demo set, spikes and measurements.
- `fixtures/` — real devnet transactions and the measured runs; no amounts inside.
- `scripts/` — gate helpers, WSL build/deploy, trace sweep before a push.
