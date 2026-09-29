# Architecture Assumptions and Known Limitations

## Architecture Summary

SettleX uses:

- Next.js + TypeScript frontend
- Next.js route handlers (`/api/auth/*`) for SEP-10 style wallet authentication
- Supabase for app data and realtime sync
- Stellar payment operations for value transfer
- Soroban settlement contract for immutable payment recording
- Separate pool contract for inter-contract withdraw flow. `withdraw`
  requires authorization from both the configured settlement contract and
  the member, so pool credits can only be spent through `record_payment`.

## Key Assumptions

- Users operate on Stellar testnet, not mainnet.
- Wallet extensions (Freighter, xBull, Lobstr) are available client-side.
- Supabase anon key is safe with proper RLS policies. It carries no identity of
  its own: RLS authorizes on the `wallet_address` claim of a JWT that
  `/api/auth/verify` signs with `SUPABASE_JWT_SECRET`, and that secret is only
  ever read server-side.
- `SUPABASE_JWT_SECRET` (and `AUTH_CHALLENGE_SECRET`, when set) are configured
  as server-only environment variables. Prefixing either with `NEXT_PUBLIC_`
  would let any visitor mint a token for any wallet.
- Contract IDs in env/docs are synchronized with deployed testnet contracts.

## Authentication Model

- A wallet proves key ownership by signing a server-issued challenge
  transaction built with sequence number 0, which the network can never accept.
- The challenge nonce is bound to the wallet and an expiry by an HMAC, so the
  handshake needs no shared session store. Single use is enforced separately in
  Postgres (`auth_nonces`) so the guard holds across serverless instances.
- The auth routes are rate limited through a shared Postgres window
  (`auth_rate_limits`), so the configured 30 requests/minute is the real limit
  rather than 30 per running instance.
- On success the server mints a Supabase JWT carrying `wallet_address`. Every
  RLS policy reads it through `public.settlex_wallet()`; requests without a
  valid token match no rows.
- Sessions are cached in `localStorage` and last 1 hour by default
  (`AUTH_SESSION_TTL_SECONDS`, capped at 12 hours). They re-sign silently before
  expiry, so the short lifetime is invisible in normal use.
- Every token carries a `jti`. Signing out writes that id to
  `public.revoked_tokens`, and `settlex_wallet()` — the one function every RLS
  policy resolves identity through — returns NULL for a revoked token, so it
  matches no row on any table. "Sign out everywhere" writes a wallet-wide
  tombstone that denies every token issued at or before that moment.

## Known Limitations

- Project is testnet-oriented; mainnet operational controls are not included.
- README still needs one explicit phone viewport screenshot for final checklist completeness.
- CI merge protection enforcement is a GitHub repository setting and must be enabled manually in repo settings.
- Wallet UX depends on extension behavior and user approval flow, including the
  one-per-session signature that establishes an authenticated session.
- **Serverless replay and rate-limit state — conditionally mitigated.** The
  durable mitigation is implemented by the `auth_nonces` and
  `auth_rate_limits` tables/RPCs in `supabase-setup.sql`, but it is active only
  when that schema is deployed and `SUPABASE_SERVICE_ROLE_KEY` is configured.
  Without both, the guards fall back to process memory: a captured challenge
  can be replayed against a sibling instance for the rest of the 60-second
  challenge TTL, and the effective limit becomes 30 requests/minute times the
  instance count. Treat the service-role key and current schema as required for
  every multi-instance/serverless deployment; the in-memory path is suitable
  only for local or single-process use.
- If the shared store is configured but unreachable, the replay guard fails
  closed: `/api/auth/verify` returns 503 rather than minting a token it cannot
  prove is single-use. The rate limiter deliberately falls back to its local
  window so a database outage does not block every sign-in. That fallback is
  weaker across instances and is not a substitute for an edge/WAF rate limit.
- **Token revocation — conditionally mitigated.** Current schema and route code
  maintain `revoked_tokens` and `revoked_wallets`, and `settlex_wallet()` denies
  revoked JWTs. This depends on the same service-role configuration and current
  `supabase-setup.sql`; without them server-side sign-out returns 503 and a
  leaked bearer token remains valid until expiry. Keep
  `AUTH_SESSION_TTL_SECONDS` short enough for that residual risk.
- **RLS has no column-level protection by itself — mitigated by database
  triggers, but deployment-dependent.** The expense and trip UPDATE policies
  intentionally authorize a member at row level. The current schema adds
  `validate_expense_update`, `validate_trip_update`, and
  `validate_user_update` `BEFORE UPDATE` triggers: creator/identity fields are
  immutable, non-creators cannot change membership or split metadata, and a
  member can only mark their own share paid with a transaction hash. These
  checks exist only after the latest `supabase-setup.sql` has been applied;
  older deployments that have only the RLS policies still allow an authorized
  member to rewrite every column in the row. Schema version checks and RLS/
  trigger breach tests are therefore required before production use.
- Some screenshots in README are desktop captures; mobile screenshots should be added for evaluator clarity.
- Pool balances are internal contract accounting credits, not native XLM/token custody transfers on-chain.
- `record_payment` stores the provided `payer`, `amount` and `tx_hash` without
  verifying any of them against Horizon. With no attestor configured the record
  is **self-attested** — it proves a member wrote a string, nothing more — and
  every such record carries `attested: false` so consumers cannot mistake it for
  proof. Do not present self-attested records as evidence of payment; the
  Stellar transaction on the explorer is the evidence.
- Setting an attestor (`set_attestor`) makes a co-signature mandatory on every
  `record_payment`, and marks the resulting records `attested: true`. This is
  the on-chain half of real verification: the off-chain verifier that checks the
  Horizon transaction (payer, destination, amount, memo) before co-signing is
  **not implemented** — until it is deployed and configured, all records remain
  self-attested.
- `clear_paid` is an admin-gated escape hatch for the `ExpensePaid` flag. Without
  it, a bogus or mistaken record permanently blocks the legitimate one for that
  `(expense_id, member)` pair. It clears the flag only; the original entry stays
  in the trip's payment history so the audit trail is not rewritten.

## Operational Constraints

- Any contract redeployment changes contract ID and requires env + README updates.
- Incorrect wallet/account setup can block end-to-end payment tests.
- Supabase configuration errors can affect sync behavior even if chain operations work.

## Recommended Future Improvements

- Add automated e2e tests (Playwright) with mobile viewport assertions.
- Add a script to validate README proof links are live.
- Add an automated checklist CI job that verifies required docs/sections exist.
- Introduce token/native-asset backed pool settlement model (transfer in/out) for stronger economic guarantees.
- Build and deploy the off-chain verifier service that checks Horizon before
  co-signing, then point `set_attestor` at it. The contract-side hook already
  exists; only the service is missing.
- Consider requiring the payer to co-sign `record_payment` as a second source of
  truth. Not done here because the frontend signs with a single wallet, so it
  would break every payment until a co-signature flow is built.
- Add a deployment health check that verifies the shared auth RPCs, revocation
  tables, and column-validation triggers exist before serving production
  traffic.
- Sweep expired `auth_nonces` / `auth_rate_limits` rows on a schedule (pg_cron)
  as well as opportunistically inside the RPCs.
- Prefer narrowly scoped RPCs for member update operations so callers do not
  need broad row-level UPDATE permission; keep the validation triggers as
  defense in depth.
