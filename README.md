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

## What v0.2.0 shows — and what it does not

Live on devnet: https://confidentialcreator.github.io/Confidential-Creator-Support/ — the web on
GitHub Pages, the api and the indexer on Render, the index on Supabase. Supporters get the demo
token (`SUPD`, not a stablecoin) from a devnet faucet on the page.

v0.1.0 showed a single contribution: a clean wallet prepares its confidential balance,
contributes to a creator, the explorer shows no amount, the creator's page counter goes up and
the creator's cabinet decrypts the amount. v0.2.0 makes the support recurring:

- **Periods and expiry.** A contribution pays for 1..12 periods of 30 days. The form shows the
  expiry date before the wallet signs; the date is public on chain, the amount is not.
- **Renewal without a gap.** Renewing before the expiry date extends from that date, not from
  today, so a supporter never drops out of the count while renewing. After expiry the new
  periods start from the day of the renewal.
- **Grace of 3 days.** A supporter stays active until `expiry + 3 days`, then leaves the count
  on their own — nothing has to run for that: the status is computed from the chain-derived
  expiry at the moment of reading. Nothing renews by itself; there is no auto-charge.
- **Supporter's cabinet** (`/me`) — every creator the wallet supports, "ends in N days",
  renewal, and whether the wallet is listed on the creator's page (it is counted either
  way).
- **Supporters by month** on the creator's page — how many were active each month, counts only.

Measured on devnet (`fixtures/demo-run.json`, `fixtures/measure.json`, `fixtures/renewal.json`):

| Criterion | Budget | Measured |
|---|---|---|
| No amount recoverable from the transaction, logs or either token account | 100 % | 152/152 (demo) + 6/6 (probes) |
| Page counter matches the chain after a confirmation | ≤ 30 s | 1.8 s max (index), the page polls every 10 s |
| Repeat contribution: click → confirmed | ≤ 60 s p95, ≤ 2 wallet confirmations | 12.0 s p95 alone (33.6 s under load), 1 confirmation |
| First contribution (with wallet preparation) | ≤ 3 min, ≤ 6 confirmations | 18.9 s in the browser, 3 confirmations |
| Creator's cabinet decrypts every contribution | 128 in ≤ 20 s | 420 in 8.9 s, first amount in 0.4 s |
| 128 supporters raised by script | ≤ 30 min | 20.0 min |
| A lapsed supporter leaves the count after period + grace | ≤ 1 h | at the read itself; one second before `expiry + grace` active, at it not (Postgres, the repository's migrations) |
| Renewal before expiry: reads showing "inactive" | 0 | 0 of 16 (one read a second around the renewal, through the hosted api); new expiry = old + 30 days, indexed in 1.2 s |

Nobody waited 33 days on devnet: the end of a period is shown on substituted time in the index
queries and on a warped clock in the program tests, not on the calendar.

Not in v0.2.0, on purpose: selective disclosure of an amount and the auditor's tool (the audit
key exists in the mint, but nothing reads with it yet); withdrawal (a creator's funds stay in
the confidential balance); reminders outside the app — no email.

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

## Deployment

The demo runs on free tiers, each on the owner's own account: the database on Supabase, the
api with the indexer on Render, the web on GitHub Pages, and an uptime monitor that keeps the
api awake. No value from these services lives in the repository — `render.yaml` and
`pages.yml` name the variables, the dashboards hold them.

### Database — Supabase

One project, two connection strings: the transaction pooler (port 6543) is `DATABASE_URL` for
the api and the indexer; the session pooler (port 5432) is `MIGRATE_DATABASE_URL`, used only to
apply migrations. Run `pnpm --filter @ccsupport/db db:migrate` from a machine whose `.env` has
`MIGRATE_DATABASE_URL` — once, and again after each release that adds a file under
`packages/db/migrations`.

### Api and indexer — Render (free)

`render.yaml` is a Render Blueprint for one free web service: the api with the indexer
running inside it (`RUN_WORKER=true` — the free instance cannot run a background worker).
Steps: Render → New → Blueprint → this repository; fill in the `sync: false` variables
(`WEB_ORIGIN` = the Pages origin, `SOLANA_RPC_URL`, `DATABASE_URL`, `CCS_MINT`,
`PROOF_PAYER_SECRET`, `FAUCET_SECRET`). Every push to `main` redeploys it. The service answers
on `https://<name>.onrender.com` — that is `VITE_API_URL` for Pages. The process idles at about
105 MB, well inside the 512 MB of the free instance, and the 750 free hours a month cover one
service around the clock.

`SOLANA_RPC_URL` is spent by the indexer and the relay; when its provider's monthly credits run
out the RPC answers 429 and `/health` turns 503 — replace the key in Render; the service
restarts with it, no code change needed.

### Web — GitHub Pages

`.github/workflows/pages.yml` deploys on every push to `main`: the landing page
(`apps/landing`, static, no build) at `/<repository>/` and `apps/web` under
`/<repository>/app/` (a custom domain sets the variable `PAGES_BASE_PATH=/app/`). The root
`404.html` is the app shell, so deep links into the app work, and links from v0.1.0 that point
outside `/app/` are moved under it. The landing reads the live supporter count from
`VITE_API_URL` and keeps its printed figures when the api does not answer.
One-time repository settings: **Pages → Source: GitHub Actions**; variables `VITE_API_URL`,
`VITE_CCS_MINT`, `VITE_SOLANA_CLUSTER` (Settings → Secrets and variables → Actions, not
Environments). The secret `VITE_SOLANA_RPC_URL` is optional: without it the browser reads the
public devnet RPC, which is enough for one person's reads; with it the key ends up in the
bundle like any `VITE_*` value — restrict it to the Pages domain in the RPC provider.

Pages hosts the static web only; the api's `WEB_ORIGIN` must be the Pages origin (scheme and
host, no path), or the browser's requests are refused by CORS.

### Keep-alive — UptimeRobot

A free Render instance spins down after 15 minutes without HTTP traffic and takes about a
minute to come back; while it sleeps the index does not move (the backfill catches up on
wake). An HTTP monitor on `https://<name>.onrender.com/health` every 5 minutes keeps it up —
the path matters, the root answers 404 and the monitor would stay red; `HEAD` is accepted.
The monitor also mails the owner when the api goes down. UptimeRobot's free plan is for
non-commercial use; if that becomes a problem, any external pinger with the same URL and
interval does the job — cron-job.org is free and has no such clause. A GitHub Actions
schedule is not a substitute: `*/5` runs drift to 10–17 minutes apart, past the 15-minute
limit.
`.github/workflows/keepalive.yml` still pings from Actions as a second, best-effort wake-up.

## Layout

- `programs/ccsupport` — Anchor program: creator registry and pledges, no amounts.
  Tests run the real `.so` under mollusk.
- `packages/chain` — client: key derivation, confidential transfers, contribution builder,
  decryption, generated program client (Codama).
- `packages/shared` — Zod schemas shared by the API and the web, period constants.
- `packages/db` — Drizzle schema and read queries for the index (Supabase).
- `apps/api` — Hono: proof relay, public read routes, devnet faucet.
- `apps/worker` — indexer: program events → index, backfill plus a log subscription.
- `apps/web` — React + Vite: creator page, support flow, creator and supporter cabinets.
- `apps/landing` — the landing page at the site root: one HTML file, one stylesheet, no build.
- `tools/mint`, `tools/demo` — operator commands; demo set, spikes and measurements.
- `fixtures/` — real devnet transactions and the measured runs; no amounts inside.
- `scripts/` — gate helpers, WSL build/deploy, trace sweep before a push.
