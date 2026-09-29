<p align="center">
  <img src="public/logo.svg" alt="SettleX Logo" height="52" />
</p>

<h1 align="center">SettleX — Split Bills. Pay On-Chain.</h1>

<p align="center">
  A decentralised expense-splitting application built on the <strong>Stellar Network</strong>.<br/>
  Add group expenses, split them by any method, and settle every share directly from your wallet — confirmed on-chain in under 5 seconds.
</p>

<p align="center">
  <a href="https://stellar.expert/explorer/testnet/contract/CAXVH54JVEUCLDQQW45SMRFTCAAVUGVBT4SBVLAGYDQ2YMAPK6YL6ADI">
    <img src="https://img.shields.io/badge/Contract-Testnet%20Deployed-4CAF50?style=flat-square&logo=stellar" alt="Contract Deployed" />
  </a>
  <a href="https://stellar.expert/explorer/testnet/tx/04c679c7ab7ec960db505038b4c6ec1f367e5d3caae013696bf3111e493de967">
    <img src="https://img.shields.io/badge/Sample%20Tx-Verified-blue?style=flat-square&logo=stellar" alt="Sample Transaction" />
  </a>
  <a href="https://github.com/SnigdhaMandal/SettleX/actions/workflows/ci.yml">
    <img src="https://github.com/SnigdhaMandal/SettleX/actions/workflows/ci.yml/badge.svg" alt="CI Pipeline" />
  </a>
  <img src="https://img.shields.io/badge/Network-Stellar%20Testnet-7B68EE?style=flat-square" alt="Stellar Testnet" />
  <img src="https://img.shields.io/badge/Tests-45%20Passing-brightgreen?style=flat-square" alt="45 Tests Passing" />
</p>

<p align="center">
  <a href="https://settle-x-pi.vercel.app/"><strong>Live Demo</strong></a> &nbsp;&bull;&nbsp;
  <a href="https://youtu.be/gnUaUONmb3I"><strong>Demo Video</strong></a>
</p>

---

## Table of Contents

- [Project Description](#project-description)
- [Features](#features)
- [Tech Stack](#tech-stack)
- [Screenshots](#screenshots)
- [How It Works](#how-it-works)
- [Smart Contract](#smart-contract)
- [Submission Checklist Evidence](#submission-checklist-evidence)
- [Setup Instructions](#setup-instructions)
- [Environment Variables](#environment-variables)
- [Wallet Authentication](#wallet-authentication)
- [Testing](#testing)
- [Project Structure](#project-structure)
- [Testnet Notes](#testnet-notes)
- [Final Documentation Package](#final-documentation-package)

---

## Project Description

SettleX solves a fundamental problem with group expense sharing: apps like Splitwise only track IOUs — you still have to chase people for real money. SettleX closes the loop by connecting split calculations directly to on-chain payments.

Every payment produces a **real, verifiable transaction hash** on the Stellar blockchain — that hash, checkable on any explorer, is the evidence a payment happened. An on-chain Soroban smart contract additionally records each settlement so participants share one append-only history. Those records are currently *self-attested*: the contract stores what the member submits without checking it against Horizon, so treat the Stellar transaction as the proof and the contract record as bookkeeping (see [Architecture and Limitations](docs/ARCHITECTURE_AND_LIMITATIONS.md)). The app syncs across all participants in real time — when someone pays, everyone sees it immediately.

**Core design principles:**

- **Non-custodial** — your private key never leaves your wallet extension. SettleX only receives the signed transaction envelope.
- **No intermediary** — money moves peer-to-peer between Stellar wallets; the app never holds funds.
- **On-chain receipts** — every settled share has a Stellar transaction hash you can verify on [stellar.expert](https://stellar.expert/explorer/testnet).
- **Multi-wallet** — supports Freighter, xBull, Lobstr, and Rabet with install detection. WalletConnect (mobile wallets) is documented as a one-step add in [docs/WALLET_INTEGRATION.md](docs/WALLET_INTEGRATION.md).

---



| Feature                                                      | Status |
| ------------------------------------------------------------ | ------ |
| Multi-wallet connect (Freighter, xBull, Lobstr, Rabet)      | Live   |
| Create and split expenses — equal, percentage, custom weight | Live   |
| Pay shares with XLM (Stellar Payment operation)              | Live   |
| SEP-0007 QR code generation for mobile wallets               | Live   |
| Transaction hash receipt linked to Stellar Explorer          | Live   |
| Soroban contract: append-only on-chain settlement records     | Live   |
| Real-time event listening from contract (`pmt_rec` events)   | Live   |
| Attestor-backed payment verification                         | Not live yet |
| Trip mode — group expenses with net-balance settle-up        | Live   |
| Live cross-user sync via Supabase Realtime                   | Live   |
| Net-balance algorithm (minimises transactions needed)        | Live   |
| Mobile-responsive UI                                         | Live   |

---

## Tech Stack

| Layer            | Technology                                     |
| ---------------- | ---------------------------------------------- |
| Framework        | Next.js 14 (App Router, TypeScript)            |
| Styling          | Tailwind CSS 3.4, Framer Motion                |
| Blockchain SDK   | `@stellar/stellar-sdk` v14                     |
| Wallet support   | `@stellar/freighter-api` v6, xBull SDK, Lobstr |
| Smart contract   | Soroban (Rust, `soroban-sdk` v21)              |
| Network          | Stellar Testnet (Horizon + Soroban RPC)        |
| Database         | Supabase (PostgreSQL + Realtime)               |
| QR codes         | `qrcode.react`, `qrcode`                       |
| Testing          | Jest 29 + ts-jest (45 unit tests)              |
| State management | React Context + Supabase + localStorage        |
| UI primitives    | Radix UI, Lucide React                         |

---

## Screenshots

### Home / Landing Page

![Home](public/home.png)

---

### Dashboard — Wallet Connected & Balance Displayed

The dashboard shows your connected public key, live XLM balance fetched from Horizon, and the Testnet indicator.

![Dashboard](public/Dashboard.png)

---

### Expenses — Wallet Options & Split View

The multi-wallet selector lets users connect via Freighter, xBull, or Lobstr. Wallets not installed show an "Install" badge. Below it the expenses list shows split breakdowns with Pay XLM buttons per share.

![Expenses](public/expencess.png)

---

### Trips Overview

![Trips](public/trips.png)

---

### New Expense Form

Define members, set amounts, and choose the split mode (equal / percentage / custom weight). The form calculates each share in real time.

![New Expense Form](public/new_expencess_form.png)

---

### Test Output — 45 Tests Passing

All three test suites passing with Jest + ts-jest.

![Test Output](public/test_pass.png)

---

### Deployment Proof (CLI)

Fresh testnet deployment output and contract ID confirmation.

![Deployment Proof](public/deployment.png)

---

## How It Works

```
User connects wallet (Freighter / xBull / Lobstr)
              |
User creates expense, adds members, picks split mode
              |
App calculates each member's exact share
              |
Payer clicks "Pay XLM"
              |
    +---------+-----------+
    |                     |
buildTransaction()    checkIsPaid()     <- on-chain duplicate check (Soroban)
    |
TransactionBuilder constructs Payment operation
  · from:   payer public key
  · to:     payee Stellar address
  · amount: share amount in XLM
  · memo:   expense ID
    |
Wallet extension signs client-side
(private key never leaves the browser)
    |
Signed envelope submitted to Horizon REST API
    |
Stellar validators confirm in ~5 seconds
    |
recordPaymentOnChain() stores to Soroban contract:
  trip_id, expense_id, payer, member, amount, tx_hash
    |
tx hash stored in app, share marked "paid"
useContractEvents polls every 10s -> syncs state for all participants
```

---

## Smart Contract

SettleX deploys a **Soroban smart contract** on Stellar Testnet as an immutable, tamper-proof ledger of all settled payments.

### Deployed Contracts (Testnet)

| Contract Role | Contract ID | Explorer |
| ------------- | ----------- | -------- |
| Settlement contract | `CAXVH54JVEUCLDQQW45SMRFTCAAVUGVBT4SBVLAGYDQ2YMAPK6YL6ADI` | [View](https://stellar.expert/explorer/testnet/contract/CAXVH54JVEUCLDQQW45SMRFTCAAVUGVBT4SBVLAGYDQ2YMAPK6YL6ADI) |
| Pool contract | `CB4P4EXLGS56IXVNU3PLJO2BHF5BEEPBBYJAHXEPZDSD2OISQIGO53JA` | [View](https://stellar.expert/explorer/testnet/contract/CB4P4EXLGS56IXVNU3PLJO2BHF5BEEPBBYJAHXEPZDSD2OISQIGO53JA) |

Network: Stellar Testnet  
Language: Rust (`soroban-sdk` v21.7.6)

### Verified On-Chain Transactions

- Settlement deploy tx: [826092e11281bd8fe3c8997ef0a4886b1bd3728069c6855ec4e3866f0a8f9d06](https://stellar.expert/explorer/testnet/tx/826092e11281bd8fe3c8997ef0a4886b1bd3728069c6855ec4e3866f0a8f9d06)
- Pool deploy tx: [fa245da3ce0a478a9146cccdfa0b1b7f918985c0c138dec3f061f104e5b8f39e](https://stellar.expert/explorer/testnet/tx/fa245da3ce0a478a9146cccdfa0b1b7f918985c0c138dec3f061f104e5b8f39e)
- Pool init tx (`pool_ini`): [a04a0a2f79e06448156b52ebd07060281cab5bee323889e92c584e0aaf50546d](https://stellar.expert/explorer/testnet/tx/a04a0a2f79e06448156b52ebd07060281cab5bee323889e92c584e0aaf50546d)
- Settlement init tx (`stx_ini`): [f05c2f59f980a00e99f3f00d57e22b8b10fd0405064096273fd912c9b05a037e](https://stellar.expert/explorer/testnet/tx/f05c2f59f980a00e99f3f00d57e22b8b10fd0405064096273fd912c9b05a037e)
- Inter-contract settlement proof tx (`record_payment` + internal pool `withdraw`): [04c679c7ab7ec960db505038b4c6ec1f367e5d3caae013696bf3111e493de967](https://stellar.expert/explorer/testnet/tx/04c679c7ab7ec960db505038b4c6ec1f367e5d3caae013696bf3111e493de967)

The final proof transaction above is verifiable evidence of the inter-contract path: settlement `record_payment` triggered pool `withdraw` in the same on-chain execution.

Security hardening note:
- Pool credits are now admin-managed in the pool contract to prevent untrusted self-crediting.
- Pool `withdraw` requires auth from **both** the configured settlement contract and the member. Credits can therefore only be consumed as part of a `record_payment` call — a member cannot drain their own credits directly, and no other contract can spend them. Rotating `set_settlement_contract` immediately revokes the previous contract's ability to withdraw.
- Settlement records now carry an `attested` flag. With no attestor configured a record is **self-attested** — it proves only that a member wrote a string, and the contract verifies neither the `payer`, the `amount`, nor the `tx_hash` against Horizon. Treat the Stellar transaction on the explorer as the evidence, not the in-app record. `set_attestor` makes a verifier's co-signature mandatory and marks records `attested: true`; the verifier service itself is not yet built, so attestor-backed verification is not live in this repo.
- `clear_paid` (admin-only) clears the `ExpensePaid` flag, so a bogus or mistaken record can no longer permanently block the legitimate one. It preserves the original entry in trip history.

> **Redeploy required.** `PaymentRecord` gained a field and `CONTRACT_VERSION` is now `2`. Records written by a v1 deployment cannot be read by this build — deploy fresh contracts and update `NEXT_PUBLIC_CONTRACT_ID`.

---

## Project Status & Production Roadmap

**Status: Testnet beta.** SettleX runs entirely on Stellar **Testnet** — no real
funds move yet. Settlement currently uses native **XLM**. USDC settlement,
verified on-chain settlement, broader wallet support, and a Mainnet launch are on
the roadmap. We state exactly where we are rather than overselling.

The complete, honest plan to take SettleX from project to shipped product —
including the known trust gaps and how each one is closed — lives in
**[docs/PRODUCT_CONVERSION_GUIDE.md](docs/PRODUCT_CONVERSION_GUIDE.md)**.

| Area | Today | Next |
| --- | --- | --- |
| Network | Stellar Testnet | Mainnet (after a contract audit) |
| Settlement asset | XLM (native) | USDC via Stellar path payments |
| Settlement integrity | On-chain receipt log (tx hash stored; not yet verified in-contract) | Verified / atomic on-chain settlement |
| Wallets | Freighter, xBull, Lobstr, Rabet | + WalletConnect (mobile), passkey smart wallets |
| App shell | Installable PWA, nonce-based CSP | Push notifications, offline reads |
| Identity | Wallet address (client-supplied) | Sign-In-With-Stellar (signed challenge) |

Verified locally with `npm run build`, `npm run lint`, and `npm test`.

## Submission Checklist Evidence

This section maps the required submission checklist to concrete proof in this repository.

| Requirement | Proof |
| --- | --- |
| Public GitHub repository | https://github.com/SnigdhaMandal/SettleX |
| README with complete documentation | This file plus final docs links in [Final Documentation Package](#final-documentation-package) |
| Minimum 8+ meaningful commits | Local repository history: 44 commits |
| Live demo link | [https://settle-x-pi.vercel.app/](https://settle-x-pi.vercel.app/) |
| Screenshot: mobile responsive view | UI pages were hardened for mobile in Phase 9. Add one fresh phone viewport screenshot to `public/mobile-responsive.png` and reference it here before final submission. |
| Screenshot or badge: CI/CD pipeline running | CI badge at the top of this README (GitHub Actions `ci.yml`) |
| Contract addresses and transaction hash (inter-contract) | [Deployed Contracts](#deployed-contracts-testnet) and [Verified On-Chain Transactions](#verified-on-chain-transactions) |
| Token or pool address (if custom token or pool deployed) | Pool contract in [Deployed Contracts](#deployed-contracts-testnet) |

### Contract Functions

| Function                                                              | Type  | Purpose                                                 |
| --------------------------------------------------------------------- | ----- | ------------------------------------------------------- |
| `record_payment(trip_id, expense_id, payer, member, amount, tx_hash)` | Write | Stores payment record on-chain after XLM transfer       |
| `get_payments(trip_id)`                                               | Read  | Returns all payment records for a trip                  |
| `is_paid(expense_id, member)`                                         | Read  | Checks if a member has already settled a specific share |

**Error codes handled by the frontend:**

| Code | Name            | Meaning                                  |
| ---- | --------------- | ---------------------------------------- |
| #1   | `InvalidAmount` | Payment amount is zero or negative       |
| #2   | `AlreadyPaid`   | This share was already settled on-chain  |
| #3   | `EmptyId`       | Trip ID or expense ID is an empty string |

### Why a Smart Contract?

In a Horizon-only setup there is no shared source of truth for payment status — any user could mark a share as paid without actually transferring XLM. The Soroban contract solves this:

- `record_payment` stores the real Stellar `tx_hash` as proof of transfer.
- `is_paid` acts as a duplicate guard — re-settling an already-paid share is rejected on-chain with `AlreadyPaid (#2)`.
- All records are permanently on the Stellar ledger and cannot be modified or deleted by anyone, including the app operator.

### Real-Time Events

The contract emits a `pmt_rec` event for every confirmed payment. `hooks/useContractEvents.ts` polls the Soroban RPC every 10 seconds and on browser tab focus. New events are deduplicated by `txHash` and merged into React state — all participants see confirmed payments without refreshing the page.

---

## Setup Instructions

### Prerequisites

- **Node.js** v18 or later
- **npm** v9 or later
- **Freighter Wallet** browser extension — [freighter.app](https://freighter.app)
  - In Freighter: Settings → Network → select **Testnet**
- A funded Stellar Testnet account — get free XLM from [Stellar Friendbot](https://horizon-testnet.stellar.org/friendbot?addr=YOUR_PUBLIC_KEY)

### 1. Clone the repository

```bash
git clone https://github.com/SnigdhaMandal/SettleX.git
cd SettleX
```

### 2. Install dependencies

```bash
npm install
```

### 3. Create a Supabase project

SettleX uses Supabase for real-time cross-user sync. Without it, data only persists locally in the current browser session.

1. Create a free project at [supabase.com](https://supabase.com).
2. In the SQL Editor, run the full schema from [`supabase-setup.sql`](supabase-setup.sql) (or follow [docs/SUPABASE_SETUP.md](docs/SUPABASE_SETUP.md) for a walkthrough).
3. Copy your **Project URL** and **anon key** from Project Settings → API.
4. Copy your **JWT Secret** from the same page into `SUPABASE_JWT_SECRET`. Row Level Security authorizes on a `wallet_address` claim that the app's server signs with this secret — without it, every database call is rejected. See [Wallet Authentication](#wallet-authentication).

### 4. Configure environment variables

```bash
cp .env.local.example .env.local
```

Fill in your Supabase credentials. The contract ID and RPC URL are pre-filled with the deployed testnet values. See [Environment Variables](#environment-variables) for the full reference.

### 5. Start the development server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) and connect your Freighter wallet (set to Testnet).

### 6. Build for production

```bash
npm run build
npm run start
```

---

## Environment Variables

Create (or edit) `.env.local` in the project root:

```env
# Stellar Network
NEXT_PUBLIC_STELLAR_NETWORK=TESTNET
NEXT_PUBLIC_HORIZON_URL=https://horizon-testnet.stellar.org
NEXT_PUBLIC_STELLAR_EXPLORER=https://stellar.expert/explorer/testnet

# Soroban Smart Contract (deployed — no changes needed)
NEXT_PUBLIC_SOROBAN_RPC_URL=https://soroban-testnet.stellar.org
NEXT_PUBLIC_CONTRACT_ID=CAXVH54JVEUCLDQQW45SMRFTCAAVUGVBT4SBVLAGYDQ2YMAPK6YL6ADI

# Supabase (from Project Settings → API in your Supabase dashboard)
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key-here

# App
NEXT_PUBLIC_APP_NAME=SettleX
NEXT_PUBLIC_APP_VERSION=1.0.0

# ─── Server-only — never prefix these with NEXT_PUBLIC_ ─────────────────────
# Supabase Dashboard → Settings → API → JWT Secret.
SUPABASE_JWT_SECRET=your-supabase-jwt-secret
# Binds an auth challenge to the wallet it was issued to. Required in
# production and must differ from SUPABASE_JWT_SECRET (the server refuses to
# boot otherwise); falls back to it in dev. Generate: openssl rand -base64 48
AUTH_CHALLENGE_SECRET=
# Optional. Session lifetime in seconds (default 43200 = 12h, max 86400).
AUTH_SESSION_TTL_SECONDS=43200
```

> Variables with the `NEXT_PUBLIC_` prefix are read client-side and are inlined into the JavaScript bundle — treat every one of them as public. The Supabase anon key is safe to expose because access is governed by Row Level Security.
>
> `SUPABASE_JWT_SECRET` and `AUTH_CHALLENGE_SECRET` are **not** public. They are read only inside the `/api/auth/*` route handlers. Prefixing either with `NEXT_PUBLIC_` would ship it to every visitor and let anyone mint a token for any wallet.

---

## Wallet Authentication

Your Stellar address is your identity, and the app proves you control it before the database will accept it — a SEP-10 style challenge/response:

1. **Challenge** — `POST /api/auth/challenge` returns a transaction built for your address with **sequence number 0**, carrying a random nonce. Sequence 0 is always below an account's real sequence, so the network can never accept it: it is signable but unsubmittable, and costs no fee.
2. **Sign** — your wallet (Freighter, xBull, Lobstr) signs it locally. Your private key never leaves the extension.
3. **Verify** — `POST /api/auth/verify` checks the signature against the claimed public key and, only on success, mints a short-lived Supabase JWT whose `wallet_address` claim carries the proven address. The token is signed with `SUPABASE_JWT_SECRET`, which never reaches the browser.
4. **Authorize** — every RLS policy reads that claim via `public.settlex_wallet()`. Requests without a valid token get no rows at all.

The token is cached in `localStorage` and reused until it expires (12 hours by default), so you sign roughly once a day rather than once per action.

> **Upgrading an existing deployment:** earlier versions authorized on an `x-wallet-address` request header that the browser set itself. Because the anon key is public, anyone could send that header with any address and read or modify every user's data. Re-run [`supabase-setup.sql`](supabase-setup.sql) to replace those policies and set `SUPABASE_JWT_SECRET`. Until you do, the data layer is effectively unauthenticated.

---

## Testing

### JavaScript / TypeScript unit tests

```bash
npm test
```

For coverage report:

```bash
npm run test:coverage
```

| Test file                                 | Coverage                                                                                     |
| ----------------------------------------- | -------------------------------------------------------------------------------------------- |
| `__tests__/split/calculator.test.ts`      | Equal split, custom/weighted split, amount validation, Stellar address format checks         |
| `__tests__/settlement/netBalance.test.ts` | Net-balance algorithm: simple debt, netting, three-person chains, wallet address passthrough |
| `__tests__/utils/formatters.test.ts`      | `formatAddress`, `formatXLM`, `stroopsToXlm` conversions                                     |

**45 tests across 3 suites — all passing.** See the test output screenshot in [Screenshots](#screenshots).

### Rust contract tests

```bash
cd contract
cargo test
```

8 tests: `record_and_query`, `multiple_members`, `multiple_expenses_same_trip`, `duplicate_payment_rejected`, `zero_amount_rejected`, `negative_amount_rejected`, `is_paid_unknown_returns_false`, `get_payments_unknown_trip_is_empty`.

---

## Project Structure

```
settlex/
├── app/
│   ├── page.tsx                  # Landing page
│   ├── auth/page.tsx             # Authentication
│   ├── dashboard/page.tsx        # Dashboard (wallet + balance)
│   ├── expenses/page.tsx         # Expense list and management
│   ├── trips/
│   │   ├── page.tsx              # Trip list
│   │   └── [id]/page.tsx         # Trip detail — expenses + settle-up tab
│   └── api/auth/
│       ├── challenge/route.ts    # Issues the challenge transaction to sign
│       └── verify/route.ts       # Verifies the signature, mints the Supabase JWT
│
├── components/
│   ├── landing/                  # Hero, Features, HowItWorks, Pricing, Testimonials
│   ├── expenses/                 # ExpenseForm, SplitCalculator, PaymentRow, ReceiptModal
│   ├── payment/                  # PayButton, PaymentStatus, QRCodeDisplay, TransactionHash
│   ├── trips/                    # TripCard, TripForm, ExpenseList, SettlementSummary
│   ├── wallet/                   # ConnectWalletButton, WalletInfo, WalletGuard
│   └── ui/                       # Button, Modal, Badge, Spinner, Toast, Logo
│
├── context/
│   ├── ExpenseContext.tsx        # Global expense state
│   ├── TripContext.tsx           # Global trip state
│   ├── AuthContext.tsx           # Authentication state
│   └── WalletContext.tsx         # Wallet connection state
│
├── hooks/
│   ├── useWallet.ts              # Multi-wallet connection (StellarWalletsKit)
│   ├── useExpense.ts             # Expense CRUD
│   ├── useTrip.ts                # Trip CRUD
│   ├── usePayment.ts             # Full 7-state payment flow orchestration
│   └── useContractEvents.ts      # Real-time Soroban event polling
│
├── lib/
│   ├── auth/
│   │   ├── challenge.ts          # Challenge build + signature verification (server)
│   │   ├── jwt.ts                # Supabase access-token minting (server)
│   │   ├── serverConfig.ts       # Server-only auth secrets
│   │   └── rateLimit.ts          # Throttling for the public auth routes
│   ├── supabase/session.ts       # Wallet-authenticated Supabase client (browser)
│   ├── stellar/
│   │   ├── walletsKit.ts         # Custom multi-wallet provider (Freighter, xBull, Lobstr)
│   │   ├── contract.ts           # Soroban contract calls + error decoding
│   │   ├── events.ts             # pmt_rec event fetch and decode
│   │   ├── buildTransaction.ts   # Stellar Payment transaction builder
│   │   ├── submitTransaction.ts  # Horizon broadcast
│   │   └── getBalance.ts         # Account balance query
│   ├── qr/generator.ts           # SEP-0007 URI + QR generation
│   └── settlement/netBalance.ts  # Net-balance optimisation algorithm
│
├── contract/
│   └── src/lib.rs                # Soroban smart contract source (Rust)
│
├── __tests__/
│   ├── split/calculator.test.ts
│   ├── settlement/netBalance.test.ts
│   └── utils/formatters.test.ts
│
└── docs/
    ├── QUICKSTART.md
    ├── SUPABASE_SETUP.md
    ├── AUTHENTICATION_SETUP.md
    └── MANUAL_TESTING_GUIDE.md
```

---

## Testnet Notes

- This app runs entirely on **Stellar Testnet** — no real funds are used.
- Fund your Freighter testnet wallet with the Friendbot:
  ```
  https://horizon-testnet.stellar.org/friendbot?addr=YOUR_PUBLIC_KEY
  ```
- All transactions and contract events are visible at [stellar.expert/explorer/testnet](https://stellar.expert/explorer/testnet).
- The deployed contract address and sample transaction on this page can be verified live on the explorer at any time.

---

## Final Documentation Package

**Product & strategy**
- [Product Conversion Guide](docs/PRODUCT_CONVERSION_GUIDE.md) — the full project→product roadmap
- [Brand Guidelines](docs/BRAND.md)
- [Wallet Integration](docs/WALLET_INTEGRATION.md) — supported wallets + adding WalletConnect

**Getting started & testing**
- [Quickstart](docs/QUICKSTART.md)
- [Supabase Setup](docs/SUPABASE_SETUP.md)
- [Authentication](docs/AUTHENTICATION_SETUP.md)
- [Manual Testing Guide](docs/MANUAL_TESTING_GUIDE.md)

**Operations & architecture**
- [Release Checklist](docs/RELEASE_CHECKLIST.md)
- [Production Runbook](docs/RUNBOOK.md)
- [Requirement-to-Proof Matrix](docs/REQUIREMENT_PROOF_MATRIX.md)
- [Architecture Assumptions and Known Limitations](docs/ARCHITECTURE_AND_LIMITATIONS.md)

---

## License

MIT © 2026 SettleX
