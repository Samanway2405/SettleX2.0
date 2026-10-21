# SettleX Release Checklist

Date: 2026-03-29

## Pre-release Quality

- [x] Install dependencies with `npm ci` / `npm install`
- [x] Frontend lint passes: `npm run lint`
- [x] Frontend tests pass: `npm test -- --runInBand`
- [x] Production build passes: `npm run build`
- [x] Contract tests pass: `cd contract && cargo test`

## Contract and Deployment

- [x] Settlement contract deployed to testnet
- [ ] Pool schema v2 deployed or a supported pool upgraded and migrated (v1 is vulnerable to SX-179)
- [ ] Admin-only allocation test executed against the deployed pool; member-only allocation rejected
- [x] `NEXT_PUBLIC_CONTRACT_ID` updated in `.env.local`
- [x] Explorer links documented in README

## CI/CD

- [x] CI workflow defined in `.github/workflows/ci.yml`
- [x] Production check workflow defined in `.github/workflows/production-check.yml`
- [x] CI badge added to README

## Documentation

- [x] README includes live demo link
- [x] README includes contract IDs and transaction proofs
- [ ] README updated with the v2 pool address after deployment; legacy v1 ID remains marked unsafe
- [x] README includes deployment screenshot (`public/deployment.png`)
- [x] README includes submission checklist evidence section
- [x] Final docs package added under `docs/`

## Auth Shared State (required before any multi-instance deploy)

- [ ] `supabase-setup.sql` re-applied so `auth_nonces` and `auth_rate_limits`
      exist (section 5.6)
- [ ] `SUPABASE_SERVICE_ROLE_KEY` set as a server-only env var (never
      `NEXT_PUBLIC_`) in every deployment environment
- [ ] Verified a signed challenge cannot be replayed: post the same
      `/api/auth/verify` body twice and confirm the second attempt is rejected
- [ ] Confirmed `CHALLENGE_TTL_SECONDS` is 60 — it is the replay window whenever
      the shared store is unavailable

## Submission Gate

- [x] Public GitHub repository ready
- [x] Commit history exceeds minimum requirement (44 commits)
- [ ] Add one explicit mobile viewport screenshot (phone-sized capture) and reference it in README before final submission

Notes:
- All automated checks are currently green locally.
- One manual evidence item remains: a dedicated phone viewport screenshot.
