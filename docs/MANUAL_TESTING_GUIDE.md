# Manual Testing Guide

End-to-end checks to run before shipping a build. Automated tests
(`npm test`, `cd contract && cargo test`) cover the pure logic; this covers the
wallet + chain + UI paths a unit test can't.

## Setup
- Wallet extension set to **Testnet**, account funded via
  [Friendbot](https://horizon-testnet.stellar.org/friendbot).
- App running: `npm run dev`.

## 1. Wallet connect (all supported wallets)
For **each** installed wallet (Freighter, xBull, Lobstr, Rabet):
- [ ] Connect opens the chooser and lists the wallet as **Available**.
- [ ] Selecting it returns your `G…` address; the header shows the truncated key + network.
- [ ] **Reload the page** — you stay connected, and the correct wallet is remembered (sign still routes to the right extension).
- [ ] Disconnect clears the session.

## 2. Create & split an expense
- [ ] Create an expense, add members with Stellar addresses.
- [ ] Try **equal**, **percentage**, and **custom weight** splits — shares recompute live and sum to the total.
- [ ] Validation blocks zero/negative amounts and malformed addresses.

## 3. Pay a share (the core flow)
- [ ] Click Pay → wallet prompts to sign → confirm.
- [ ] Status walks through building → signing → submitting → recording.
- [ ] On success you get a **real tx hash**; open it on Stellar Expert and confirm amount/destination.
- [ ] The share flips to **paid**; balance refreshes within a few seconds.
- [ ] **Reject** the signature → app shows "cancelled", no state change.
- [ ] Pay the same share again → blocked as already settled.

## 3a. Pool authorization regression (operator only)
- [ ] On a pool schema v2 deployment, invoke `deposit(member, amount)` with only the member signature: it must fail and the member balance must remain unchanged.
- [ ] Invoke the same allocation with the configured pool administrator: it succeeds and the member accounting balance increases by exactly `amount`.
- [ ] Confirm operator material calls this an **accounting allocation**, never an XLM/USDC deposit. The pool does not transfer or custody assets in this release.

## 4. Cross-user sync (needs Supabase)
- [ ] Open the same trip in a second browser/user; an expense or payment update appears in the other within about five seconds while the page is visible.
- [ ] Hide the second browser tab, make a change, then return to it; it refreshes promptly without a manual reload.
- [ ] In DevTools, confirm `/api/auth/verify` does not return an access token in its JSON body and the session cookie is HttpOnly.
- [ ] Confirm Supabase REST requests go to the same-origin `/api/supabase/rest/v1/*` route, not directly to the Supabase URL.

## 5. PWA
- [ ] `npm run build && npm run start`, open in Chrome → install prompt appears; install works and launches standalone with the correct icon.
- [ ] DevTools → Application → Manifest: no errors; maskable icon present.
- [ ] Go offline and navigate → the offline fallback page shows (balances are **not** served stale).
- [ ] Lighthouse PWA audit passes.

## 6. Security headers
- [ ] Load any page, check response headers: `Content-Security-Policy` present with a per-request `nonce`, plus HSTS / X-Frame-Options / nosniff.
- [ ] No CSP violations in the console during normal use (connect wallet, pay, navigate).

## 7. Responsiveness
- [ ] Test at 360px, 768px, 1280px. No horizontal scroll; addresses/hashes truncate; tap targets ≥44px; sticky bars clear the iOS safe area.
