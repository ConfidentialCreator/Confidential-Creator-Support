# Confidential Creator Support

Recurring support for creators on Solana where the fact of support is public and
verifiable on-chain, while the amount of every contribution stays confidential
(Token-2022 confidential transfers). Supporters can disclose their own amount
selectively; an auditor key can be used for compliance.

## Layout

- `programs/ccsupport` — Anchor program: creator registry and pledges, no amounts.
- `packages/chain` — client: key derivation, confidential transfers, generated program client.
- `packages/shared`, `packages/db` — shared schemas and the read-only index.
- `apps/web`, `apps/api`, `apps/worker` — UI, API with proof relay, indexer.
- `tools/mint`, `tools/demo` — platform mint setup and devnet demo data.

## Commands

```bash
pnpm install
pnpm gate      # amount guard + lint + typecheck + test
pnpm dev
```

On-chain build runs in WSL: `scripts/wsl-build.sh <build-sbf|idl|build|test|clippy|gate>`.
