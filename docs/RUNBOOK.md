# SettleX Production Runbook

## 1. Prerequisites

- Node.js 18+
- npm 9+
- Rust toolchain (for contract work)
- Stellar CLI (for deployment operations)
- Funded Stellar testnet account
- Supabase project with schema from `supabase-setup.sql`

## 2. Environment Setup

Create `.env.local` and set:

- `NEXT_PUBLIC_STELLAR_NETWORK=TESTNET`
- `NEXT_PUBLIC_HORIZON_URL`
- `NEXT_PUBLIC_STELLAR_EXPLORER`
- `NEXT_PUBLIC_SOROBAN_RPC_URL`
- `NEXT_PUBLIC_CONTRACT_ID`
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`

Server-only (must **not** carry the `NEXT_PUBLIC_` prefix — that would publish
them in the browser bundle and let anyone mint a token for any wallet):

- `SUPABASE_JWT_SECRET` — Supabase → Settings → API → JWT Secret. Required;
  without it `/api/auth/verify` returns 503 and no database call is authorized.
- `AUTH_CHALLENGE_SECRET` — **required in production**, and must differ from
  `SUPABASE_JWT_SECRET`. The server refuses to boot without it, so a missing
  value fails the deploy rather than the first sign-in. Falls back to the JWT
  secret outside production only.
- `AUTH_SESSION_TTL_SECONDS` — optional, default 3600 (1h), capped at 43200 (12h).

Set the same server-only values in the deployment environment (Vercel → Project
Settings → Environment Variables, or equivalent), not just in `.env.local`.

## 3. Local Validation

Run in project root:

- `npm run lint`
- `npm test -- --runInBand`
- `npm run build`

Run contract tests:

- `cd contract && cargo test`

## 4. Contract Deployment (Testnet)

Recommended flow:

1. Run `./scripts/deploy-contract.sh <secret-key-or-alias> [network]`.
   Constructors atomically initialize both instances, and the script then
   submits the admin-authenticated cross-reference update.
2. Record the printed contract IDs and transaction output.
3. Before allocating any credit, confirm the deployed pool WASM and release record are schema version `2`. The previous v1 deployment allowed member self-crediting and is retired.
4. Execute an administrator-authorized `deposit(member, amount)` and verify that the same call signed only by `member` fails. This pool is an accounting ledger; do not describe this operation as a token deposit.
5. Update `NEXT_PUBLIC_CONTRACT_ID` with the printed settlement contract ID.
6. Save all explorer links in README/docs.

## 5. CI/CD Verification

- Ensure workflow files exist and are valid:
  - `.github/workflows/ci.yml`
  - `.github/workflows/production-check.yml`
- Confirm CI badge resolves in README.
- Confirm repo settings enforce checks on PRs (manual GitHub setting).

## 6. Release Documentation Pack

Before submission, verify:

- README is up to date
- `docs/RELEASE_CHECKLIST.md` current
- `docs/REQUIREMENT_PROOF_MATRIX.md` current
- `docs/ARCHITECTURE_AND_LIMITATIONS.md` current

## 7. Incident / Rollback Basics

If production-like issue occurs:

1. Stop deployment changes.
2. Re-run lint/test/build and contract tests.
3. Validate `.env.local` contract ID.
4. Compare README proof IDs/tx hashes against explorer.
5. If contract ID is wrong, redeploy and update env + docs consistently.
