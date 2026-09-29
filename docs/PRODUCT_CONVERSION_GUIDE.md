# SettleX — Project → Product Conversion Guide

> **Purpose of this document.** SettleX today is an excellent *demonstration project* (well-tested, well-documented, testnet-deployed, working smart contract). This guide is the honest, detailed roadmap to turn it into a *shippable product* people trust with real money. It does not flatter the current state — where something is a demo illusion rather than a real guarantee, it says so, because you asked for an honest process, not a marketing deck.
>
> Everything here is grounded in the actual code in this repository as of the current `main` branch. File references are clickable.
>
> **Author's note on one recurring word:** you wrote "XML" a few times — the token is **XLM** (Stellar Lumens). This guide uses XLM throughout. This matters because a product's docs and UI can't have that mistake in front of users.

---

## Table of Contents

1. [The blunt current-state assessment (project vs. product)](#1-the-blunt-current-state-assessment)
2. [Priority matrix — what to do first](#2-priority-matrix)
3. [Product positioning & honest market narrative](#3-product-positioning--honest-market-narrative)
4. [Branding & visual identity upgrade](#4-branding--visual-identity-upgrade)
5. [UI/UX & responsiveness — screen by screen](#5-uiux--responsiveness--screen-by-screen)
6. [PWA (installable mobile app)](#6-pwa-installable-mobile-app)
7. [Global wallet support — the honest Stellar reality](#7-global-wallet-support--the-honest-stellar-reality)
8. [Stablecoins & USDC — how conversion actually works](#8-stablecoins--usdc--how-conversion-actually-works)
9. [The settlement-integrity problem (the "pool" illusion)](#9-the-settlement-integrity-problem)
10. [Security hardening](#10-security-hardening)
11. [Testnet → Mainnet migration](#11-testnet--mainnet-migration)
12. [Backend & infrastructure productionization](#12-backend--infrastructure-productionization)
13. [Legal, compliance & regulatory reality](#13-legal-compliance--regulatory-reality)
14. [Analytics, growth & monetization](#14-analytics-growth--monetization)
15. [Phased execution roadmap](#15-phased-execution-roadmap)
16. [Concrete repo change checklist](#16-concrete-repo-change-checklist)

---

## 1. The blunt current-state assessment

### What is genuinely strong (keep and build on)

- **Real architecture, not a mock.** Next.js 14 App Router + TypeScript, a working Soroban contract in [contract/src/lib.rs](../contract/src/lib.rs), Horizon payment building in [lib/stellar/buildTransaction.ts](../lib/stellar/buildTransaction.ts), and a real deployed testnet contract.
- **Non-custodial signing.** The private key never leaves the wallet extension — the app only receives a signed XDR envelope. That is the correct trust model and a genuine selling point.
- **Test discipline.** 45 JS tests + Rust contract tests, CI workflow, release checklist, runbook. Most "projects" don't have this.
- **A clean, opinionated design system.** The lime `#B9FF66` / near-black `#0F0F14` palette in [tailwind.config.ts](../tailwind.config.ts) is distinctive and coherent.

### What makes it a *project*, not yet a *product* (the honest gaps)

| # | Gap | Where it shows | Severity |
|---|-----|----------------|----------|
| G1 | **Everything runs on Testnet.** No real value ever moves. The whole app is a rehearsal. | [lib/utils/constants.ts](../lib/utils/constants.ts) defaults to `TESTNET` | 🔴 Blocker for "product" |
| G2 | **The "settlement pool" is an accounting illusion.** Pool credits are internal bookkeeping, *not* custody of real tokens, and `record_payment` **does not verify** the Horizon `tx_hash` it stores. | [docs/ARCHITECTURE_AND_LIMITATIONS.md](./ARCHITECTURE_AND_LIMITATIONS.md) lines 27–28; [contract/src/lib.rs:154](../contract/src/lib.rs#L154) | 🔴 Trust-critical |
| G3 | **WalletConnect and passkey onboarding still need product-specific configuration.** The maintained Stellar Wallets Kit now supplies the default wallet modules and connection modal, but WalletConnect still needs Reown metadata and passkeys remain a separate roadmap item. | `walletsKit.ts` | 🟡 Medium |
| G4 | **Not actually installable / not a PWA.** No `manifest.webmanifest`, no service worker, only a single `icon.svg`. `metadataBase` points at `https://settlex.app` and references `/og-image.png` which **does not exist** in [public/](../public/). | [app/layout.tsx:38](../app/layout.tsx#L38), [public/](../public/) | 🟠 High |
| G4b | **Broken referenced files.** The README links to `docs/QUICKSTART.md`, `docs/SUPABASE_SETUP.md`, `docs/AUTHENTICATION_SETUP.md`, `docs/MANUAL_TESTING_GUIDE.md` — none exist in [docs/](.). The OG image is also missing. Broken links read as "unfinished" to any serious evaluator. | README vs. actual `docs/` | 🟡 Medium |
| G5 | **"Bill pay" is really "send a share to a friend's wallet."** There is no biller network, no fiat rail, no stablecoin. Calling it bill-pay overstates it. | Product framing | 🟠 High (honesty) |
| G6 | **No stablecoin.** Splitting a $30 dinner in XLM means both people eat XLM's volatility between split and settle. A real product needs USDC. | `buildTransaction.ts` uses `Asset.native()` only | 🟠 High |
| G7 | **Security surface unaudited for production.** No CSP header, unverified `tx_hash` trust, Supabase RLS not proven, no rate limiting, no error monitoring, no wallet-address ownership challenge. | [next.config.mjs](../next.config.mjs), Supabase | 🟠 High |
| G8 | **Positioning is "hackathon submission," not "product."** The README has a "Submission Checklist Evidence" section and "Phase 8 Proof." Great for judges, wrong for customers. | [README.md](../README.md) | 🟡 Medium |

**The single most important honesty point:** SettleX currently produces *two independent things* per settlement — (a) a real native-XLM payment on Horizon, and (b) a separate Soroban record that *claims* that payment happened but never checks it. A malicious client could record a payment with a fake/foreign `tx_hash`. For a demo that's fine. For a product where money is real, that gap has to close (see [§9](#9-the-settlement-integrity-problem)).

---

## 2. Priority matrix

Ordered by **(impact on being a real product) ÷ (effort)**. Do the top block before touching the bottom block.

### Tier 0 — Do first (cheap, high credibility, no money-risk)
1. Fix broken asset/doc references: create `/og-image.png`, remove or write the missing `docs/*.md` links (G4b).
2. Replace the custom `walletsKit.ts` with the already-installed `@creit.tech/stellar-wallets-kit` → instantly unlocks WalletConnect + many wallets ([§7](#7-global-wallet-support--the-honest-stellar-reality)).
3. Ship the PWA layer: manifest, icons, service worker, install prompt ([§6](#6-pwa-installable-mobile-app)).
4. Rewrite positioning/README from "submission" to "product" ([§3](#3-product-positioning--honest-market-narrative), [§8](#8-honest-scope)).
5. Add CSP + tighten headers ([§10](#10-security-hardening)).

### Tier 1 — Core product truth (must precede real money)
6. Redesign settlement so the contract records *verified* payments, and drop or honestly relabel the "pool" ([§9](#9-the-settlement-integrity-problem)).
7. Add USDC (trustline + path payment) so people can split and settle in a stable unit ([§8](#8-stablecoins--usdc--how-conversion-actually-works)).
8. Wallet-ownership challenge (sign-in-with-Stellar) so an address in the DB is proven, not just claimed ([§10](#10-security-hardening)).
9. Harden Supabase RLS and prove it with tests ([§10](#10-security-hardening), [§12](#12-backend--infrastructure-productionization)).

### Tier 2 — Go-to-market
10. Mainnet migration with a staged rollout ([§11](#11-testnet--mainnet-migration)).
11. Compliance posture for any fiat on/off-ramp ([§13](#13-legal-compliance--regulatory-reality)).
12. Analytics, monetization, growth loops ([§14](#14-analytics-growth--monetization)).

---

## 3. Product positioning & honest market narrative

### The problem worth solving
Splitwise and its clones **track IOUs but never move money** — you still chase friends over UPI/Venmo/cash. SettleX's real, defensible wedge is: **split → settle in one tap, with a cryptographic receipt, in seconds, across borders, for near-zero fees.** Stellar is genuinely good at exactly this (sub-cent fees, ~5s finality, native stablecoins).

### Who it's actually for (pick a beachhead, don't boil the ocean)
Ranked by fit:
1. **Crypto-native friend groups & DAOs / remote teams** splitting shared costs — they already have wallets. *Lowest friction, ship here first.*
2. **Cross-border groups** (students abroad, migrant families, international trips) where "settle up" today means expensive FX + remittance fees. Stellar + USDC is a real 10× here.
3. **Freelancer/creator collectives** splitting tool subscriptions and revenue.

Mainstream "split my pizza" users are a *later* market — they don't have wallets and won't for a small bill. Passkey smart wallets ([§7](#passkey-smart-wallets)) are the bridge to them, but don't lead with that segment.

### The honest one-liner
> **SettleX — split any shared expense and settle it on-chain in seconds, in dollars (USDC) or XLM, with a receipt you can verify. No IOUs. No chasing. No custodian.**

### Claims you may make honestly vs. claims to drop
| ✅ Honest to claim | ❌ Do not claim (yet) |
|---|---|
| "Non-custodial — we never hold your funds." | "Bank-grade security" (no audit yet). |
| "Every settlement has a verifiable Stellar transaction hash." | "Pay your electricity/phone bill." (No biller network — see [§8 scope](#8-honest-scope).) |
| "Settle across borders for pennies." | "Instant fiat cash-out anywhere." (Depends on anchors/licensing.) |
| "Split in USDC to avoid volatility." | "FDIC insured / a bank account." |

Ship the honesty. A product that *undersells and delivers* builds the trust that a money app lives or dies on.

---

## 4. Branding & visual identity upgrade

### Current state
- One horizontal logo, [public/logo.svg](../public/logo.svg): dark rounded square + lime lightning bolt + "Settle" (dark) + "X" (lime).
- One app icon, [public/icon.svg](../public/icon.svg).
- No favicon set, no maskable icon, no OG image (referenced but missing), no monochrome/inverse variants, no wordmark-only or icon-only lockups, no brand guide.

The mark itself is fine — **lightning + lime is a legitimate identity for a "fast settlement" product.** You don't need a rebrand; you need a *complete asset system* around the existing mark.

### The full asset set a product needs

Create a `public/brand/` folder and produce:

| Asset | Sizes / format | Purpose |
|---|---|---|
| Icon, primary | SVG + PNG 16/32/48/180/192/512 | Favicon, tabs, home screen |
| Icon, **maskable** | PNG 192 & 512 with ≥20% safe padding | Android adaptive icons (PWA) |
| Apple touch icon | PNG 180×180, no transparency | iOS home screen |
| Logo lockups | horizontal, stacked, icon-only — each in dark-on-light **and** light-on-dark | Header, footer, dark sections, print |
| Monochrome logo | pure black & pure white SVG | Partner decks, embeds, watermark |
| OG / social card | PNG **1200×630** → `public/og-image.png` | Fixes the broken [app/layout.tsx:38](../app/layout.tsx#L38) reference; controls how links look when shared |
| PWA splash screens | iOS sizes (optional) | Native-feel launch |
| Favicon bundle | `favicon.ico` (multi-res) | Legacy browser tabs |

### Brand tokens to formalize (you already have most)
Lift these out of Tailwind into a one-page `docs/BRAND.md` so designers/partners stay consistent:
- **Accent:** `#B9FF66` (lime), dark `#9AE040`, light `#D4FFB0`
- **Ink:** `#0F0F14`; card `#1A1A22`; muted `#2A2A35`
- **Neutrals:** bg `#F6F6F6`, card `#FFFFFF`, border `#E5E5E5`
- **Type:** Poppins (display/UI), JetBrains Mono (addresses, hashes, amounts)
- Logo clear-space, min sizes, and "don't" examples (don't recolor the bolt, don't stretch, don't put lime text on white for body copy — it fails contrast).

> **Accessibility flag:** lime `#B9FF66` on white has a contrast ratio ~1.3:1 — it is **invisible as text/for small UI**. Use lime only as a *fill behind dark text* (as the buttons already do) or as an accent on dark backgrounds. Never as foreground text or thin icons on light. This is both a UX and an ADA/WCAG issue for a product.

### Practical generation path
- Design the master icon + lockups in Figma (or refine the existing SVGs).
- Use [RealFaviconGenerator](https://realfavicongenerator.net/) or [`pwa-asset-generator`](https://github.com/elegantapp/pwa-asset-generator) to emit every icon size + maskable + apple-touch + `manifest` icon entries from one source SVG in one command:
  ```bash
  npx pwa-asset-generator public/brand/icon-master.svg public/brand \
    --background "#0F0F14" --padding "18%" --maskable true --favicon
  ```
- Design the OG card at 1200×630 with the logo, the tagline, and the lime accent; export to `public/og-image.png`.

---

## 5. UI/UX & responsiveness — screen by screen

The design language is solid; the work is polish, consistency, and mobile correctness. Audit each screen at **360px (small phone), 768px (tablet), 1280px (desktop)**.

### Cross-cutting fixes
- **The wallet modal is inline-styled DOM, not React.** [lib/stellar/walletsKit.ts:140-315](../lib/stellar/walletsKit.ts#L140) builds the connect modal with `document.createElement` and hardcoded hex colors. It ignores dark mode, your design tokens, focus-trapping, and keyboard/`Esc` a11y. Replacing the kit ([§7](#7-global-wallet-support--the-honest-stellar-reality)) gives you the maintained kit's modal, or rebuild it as a real React component using your existing [components/ui/Modal.tsx](../components/ui/Modal.tsx).
- **Tap targets:** ensure every button/row is ≥44×44px on mobile (Apple HIG / Google min). Payment rows and wallet list items are the usual offenders.
- **Safe areas:** add `viewport-fit=cover` and use `env(safe-area-inset-*)` padding so the sticky header/footer and any bottom action bar clear the iPhone notch/home indicator (critical once it's an installed PWA).
- **Long strings:** Stellar addresses (`G...`, 56 chars) and tx hashes (64 chars) must **never** cause horizontal scroll. Use the existing `formatAddress` truncation everywhere, and wrap any full value in a `break-all` monospace container with a copy button.
- **Monospace for money & keys:** amounts, balances, addresses, hashes → `font-mono` (JetBrains Mono is already configured). Prevents digit jitter and misreads.
- **Loading & empty states:** every list (trips, expenses, payments) needs a skeleton loader and a friendly empty state with a primary CTA. Money apps feel broken when they flash blank.
- **Toasts for every chain action:** building tx, awaiting signature, submitting, confirmed, failed — you have [components/ui/Toast.tsx](../components/ui/Toast.tsx); make sure all 7 payment states in `usePayment` surface visibly.

### Per screen
| Screen | File | What to improve |
|---|---|---|
| **Landing / Hero** | [components/landing/Hero.tsx](../components/landing/Hero.tsx) | Rewrite copy to the honest one-liner ([§3](#3-product-positioning--honest-market-narrative)). Ensure hero art scales and doesn't push the CTA below the fold on 360px. Add a "works on mainnet/testnet" honest badge. |
| **Header** | [components/layout/Header.tsx](../components/layout/Header.tsx) | Mobile hamburger with a full-height drawer; wallet connect chip that truncates address and shows network (Testnet/Mainnet) with a colored dot. |
| **Dashboard** | [app/dashboard/page.tsx](../app/dashboard/page.tsx) | Balance card: show XLM **and** USDC balance once trustlines exist ([§8](#8-stablecoins--usdc--how-conversion-actually-works)); a prominent network banner when on Testnet ("You're on Testnet — no real funds"). |
| **New Expense form** | [components/expenses/ExpenseForm.tsx](../components/expenses/ExpenseForm.tsx) | On mobile, the split-mode selector + per-member amounts get cramped. Use a single-column stacked layout <640px, inline validation, and a live "each pays X" summary pinned at the bottom. |
| **Expenses list** | [app/expenses/page.tsx](../app/expenses/page.tsx), [components/expenses/PaymentRow.tsx](../components/expenses/PaymentRow.tsx) | Turn each row into a card on mobile; "Pay" button full-width; show paid/pending as a clear pill. |
| **Trip detail / Settle-up** | [app/trips/[id]/page.tsx](../app/trips/) | The net-balance settlement summary is your best "wow" — make it visual (who owes whom, arrows), and make the settle CTA sticky. |
| **Receipt modal** | [components/expenses/ReceiptModal.tsx](../components/expenses/ReceiptModal.tsx) | Add a "Share receipt" (Web Share API) + "View on Stellar Expert" + copy hash. This is your viral loop — every settlement should be shareable. |
| **Pricing/Testimonials** | [components/landing/Pricing.tsx](../components/landing/Pricing.tsx), `Testimonials.tsx` | If testimonials are fabricated, **remove them** until real — fake social proof is exactly the "not honest" trap. Replace with real metrics or a "be an early user" CTA. |

### Add dark mode properly
`darkMode: ["class"]` is configured in [tailwind.config.ts](../tailwind.config.ts) and you have `dark.*` tokens, but the body is hardcoded `bg-[#F6F6F6] text-[#0F0F14]` in [app/layout.tsx:75](../app/layout.tsx#L75). Either commit to light-only for v1 (fine) or wire a real theme toggle + `prefers-color-scheme`. Half-implemented dark mode is worse than none.

---

## 6. PWA (installable mobile app)

**Goal:** installable to the home screen, works offline for reads, feels native. You asked specifically for PWA on mobile — here is the complete, current-best path.

### Use Serwist, not next-pwa
`next-pwa` is unmaintained; the current standard for Next.js App Router is **[Serwist](https://serwist.pages.dev/) (`@serwist/next`)** — a Workbox-based successor. ([Serwist for Next.js PWA, 2025/2026 guidance](https://serwist.pages.dev/docs/next).)

### Step 1 — Web App Manifest
Create `app/manifest.ts` (Next generates `manifest.webmanifest` from it):
```ts
import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "SettleX — Split & Settle On-Chain",
    short_name: "SettleX",
    description: "Split expenses and settle in seconds with USDC or XLM.",
    start_url: "/dashboard",
    display: "standalone",
    orientation: "portrait",
    background_color: "#0F0F14",
    theme_color: "#B9FF66",
    icons: [
      { src: "/brand/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/brand/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/brand/icon-192-maskable.png", sizes: "192x192", type: "image/png", purpose: "maskable" },
      { src: "/brand/icon-512-maskable.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
```

### Step 2 — Install & configure Serwist
```bash
npm i @serwist/next && npm i -D serwist
```
Wrap [next.config.mjs](../next.config.mjs) (keep your existing headers/compiler config):
```js
import withSerwistInit from "@serwist/next";
const withSerwist = withSerwistInit({
  swSrc: "app/sw.ts",
  swDest: "public/sw.js",
  disable: process.env.NODE_ENV === "development",
});
export default withSerwist(nextConfig);
```

### Step 3 — Service worker (`app/sw.ts`)
```ts
import { defaultCache } from "@serwist/next/worker";
import { Serwist } from "serwist";

const serwist = new Serwist({
  precacheEntries: self.__SW_MANIFEST,
  skipWaiting: true,
  clientsClaim: true,
  navigationPreload: true,
  runtimeCaching: defaultCache,
});
serwist.addEventListeners();
```

### Step 4 — Caching strategy (this is where money apps go wrong)
- **Never cache** Horizon `/accounts` balance calls, Soroban RPC, or Supabase writes — always network-first or network-only. A stale balance in a payments app is dangerous.
- **Cache-first**: static assets, fonts, the app shell, marketing pages.
- **Network-first with offline fallback**: trip/expense read views (show last-known data with a clear "offline — last synced …" banner).
- Add an **offline fallback page** (`app/~offline/page.tsx`).

### Step 5 — Install prompt & iOS
- Add a custom "Install SettleX" button that listens for `beforeinstallprompt` (Android/desktop Chrome).
- iOS Safari has no install prompt event — show a one-time "Add to Home Screen" hint sheet on iOS.
- Add `apple-mobile-web-app-capable` / status-bar meta and `viewport-fit=cover` (update the `viewport` export in [app/layout.tsx:62](../app/layout.tsx#L62)).

### Step 6 — Push notifications (phase 2)
"Alex paid you 12 USDC" / "You owe 8 USDC for Goa trip" are strong re-engagement hooks. Use the Web Push API (VAPID) via Serwist. Requires a backend to store subscriptions and send — fits with [§12](#12-backend--infrastructure-productionization).

### Acceptance criteria
- Lighthouse PWA audit passes (installable, offline, valid manifest, maskable icon).
- Installs cleanly on Android Chrome and iOS Safari; launches standalone with correct icon and splash.
- Balance/payment flows are **never** served stale from cache.

---

## 7. Global wallet support — the honest Stellar reality

You asked for "global wallets like Trust Wallet, MetaMask." Here is the truth, because building on a wrong mental model wastes weeks:

> **Stellar is NOT an EVM chain. MetaMask and Trust Wallet are built for Ethereum/EVM. You cannot connect them to a Stellar dApp the way an Ethereum dApp does `window.ethereum`.** There is no native Stellar support in stock MetaMask.

That doesn't mean you're stuck with 3 wallets. Here's how you actually get broad, "global" wallet coverage on Stellar:

### 7.1 Maintained Stellar Wallets Kit (implemented)
[lib/stellar/walletsKit.ts](../lib/stellar/walletsKit.ts) now delegates wallet discovery, connection UI, address access, and signing to `@creit.tech/stellar-wallets-kit`. The adapter keeps the existing application-facing API while `defaultModules()` provides the wallets that require no application-specific configuration.

```ts
import { StellarWalletsKit } from "@creit.tech/stellar-wallets-kit/sdk";
import { defaultModules } from "@creit.tech/stellar-wallets-kit/modules/utils";
import { Networks } from "@creit.tech/stellar-wallets-kit/types";

StellarWalletsKit.init({
  network: Networks.TESTNET,
  modules: defaultModules(),
});
```
The remaining wallet work is configuration rather than maintaining parallel wallet implementations.

### 7.2 WalletConnect = your "global mobile wallet" story
WalletConnect (bundled in the kit) is what lets **mobile wallets** connect by QR/deeplink. This is the real answer to "I want people to use their phone wallet." You'll need a free WalletConnect (Reown) project ID.

### 7.3 Trust Wallet & MetaMask — the accurate options
- **Trust Wallet** holds XLM as an asset, but dApp transaction signing for Stellar is not a first-class flow. Coverage comes **via WalletConnect** where supported — not via a Trust-specific SDK. Treat it as "supported through WalletConnect," and test it explicitly rather than promising it.
- **MetaMask** only touches Stellar through the community **[Stellar Snap](https://snaps.metamask.io/snap/npm/stellar-snap/)** (an installable MetaMask extension that adds Stellar + Soroban). It's real and usable, but it's third-party, adds an install step, and derives the Stellar key from the user's MetaMask entropy. **Recommendation:** don't put MetaMask front-and-center. If a segment demands it, integrate the Stellar Snap as a *secondary* option and label it clearly. Don't build your onboarding around it.

### 7.4 Passkey smart wallets — the real mainstream unlock
For non-crypto users (your later, bigger market), the game-changer is **passkey-based Soroban smart wallets**: sign transactions with Face ID / Touch ID / Windows Hello — **no seed phrase, no extension**. Soroban supports this natively (secp256r1 / Protocol 21), and there's a production SDK, **[passkey-kit](https://github.com/kalepail/passkey-kit)** (used in production by Meridian Pay). ([Stellar Smart Wallets](https://developers.stellar.org/docs/build/apps/smart-wallets).)

This is how you onboard someone who has never heard of a wallet: "Create account → Face ID → done." Put it on the roadmap as the **mainstream onboarding path** (Phase 2), while extension/WalletConnect wallets serve crypto-native users now.

### 7.5 Recommended wallet strategy
| Segment | Path | When |
|---|---|---|
| Crypto-native (now) | Stellar Wallets Kit: Freighter, xBull, Lobstr, Rabet, Albedo | Tier 0 |
| Mobile wallet users | WalletConnect via the kit | Tier 0/1 |
| Hardware security | Ledger/Trezor via the kit | Tier 1 |
| MetaMask holdouts | Stellar Snap (secondary, labeled) | Optional |
| **Mainstream / no-wallet** | **Passkey smart wallet (passkey-kit)** | Phase 2 (biggest growth lever) |

---

## 8. Stablecoins & USDC — how conversion actually works

You asked: *the app pays in XLM, but we want a stablecoin like USDC — how do we convert for paying a bill?* Here is the concrete mechanism on Stellar.

### 8.1 USDC exists natively on Stellar
Circle issues **native USDC on Stellar** (mainnet issuer `GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN`). It's not a wrapped/bridged token — it's a first-class Stellar asset. On Testnet you use the SDF test USDC issuer for development.

### 8.2 Prerequisite: a trustline
Before an account can hold USDC, it must establish a **trustline** to the USDC asset (a `changeTrust` operation, one-time, tiny XLM reserve). Your onboarding must offer "Enable USDC" which builds and has the user sign a `changeTrust` tx.
```ts
import { Operation, Asset } from "@stellar/stellar-sdk";
const USDC = new Asset("USDC", process.env.NEXT_PUBLIC_USDC_ISSUER!);
// add to a TransactionBuilder:
Operation.changeTrust({ asset: USDC });
```

### 8.3 Conversion: **path payments** (the key primitive)
Stellar has a built-in DEX, so conversion is atomic and needs no third party. Two modes:

- **`pathPaymentStrictReceive`** — *"recipient must receive exactly 20 USDC; spend as much of my XLM as needed (up to a max)."* **This is what you want for settling a bill of a known amount.**
- **`pathPaymentStrictSend`** — *"send exactly 100 XLM; recipient gets whatever USDC that converts to (above a min)."*

Example — payer holds XLM, payee receives USDC, one transaction, DEX does the FX:
```ts
Operation.pathPaymentStrictReceive({
  sendAsset: Asset.native(),      // payer pays XLM
  sendMax: "105.0",               // slippage cap in XLM
  destination: payeePublicKey,
  destAsset: USDC,                // payee receives USDC
  destAmount: "20.0",             // exact bill share
  path: [],                       // let Horizon find best path (see below)
});
```
Use Horizon's `/paths/strict-receive` endpoint to discover the best `path` and show the user the live rate + slippage before signing. This replaces the plain `Operation.payment` in [lib/stellar/buildTransaction.ts](../lib/stellar/buildTransaction.ts).

**Result:** friends can each *hold* whatever they have (XLM or USDC), but the *bill is denominated and settled in USDC*, so nobody eats volatility. That's the honest, real answer to your question — no custom oracle, no external swap, it's a native Stellar operation.

### 8.4 What "convert for paying a bill" can and cannot mean (honest scope)
There are two very different products hiding under "pay a bill." Be clear which you're building:

| Interpretation | What it needs | Difficulty |
|---|---|---|
| **A. Settle a shared expense between people, in USDC** (split dinner, trip, rent) | Trustlines + path payments (§8.3). **All on-chain, no licenses, buildable now.** | 🟢 Moderate — this is the real SettleX |
| **B. Pay a real-world biller** (electricity, phone, water) | Integration with a biller aggregator + fiat off-ramp + money-transmission licensing + KYC/AML | 🔴 A separate, regulated fintech product |

**Recommendation:** ship **A** — that's the honest, achievable, valuable product. Frame it as "settle expenses in USDC," not "pay your bills," until/unless you take on the compliance and biller-integration lift of **B** ([§13](#13-legal-compliance--regulatory-reality)).

### 8.5 Fiat in/out (the ramps) — when you need real dollars
When users want to **get** USDC or **cash out** to a bank, you don't build banking — you integrate **anchors** via Stellar Ecosystem Proposals:
- **SEP-24** — interactive, hosted deposit/withdraw (the wallet pops the anchor's KYC + payment UI). Easiest to integrate.
- **SEP-31** — cross-border payments between businesses.
- **SEP-6** — programmatic (you build the UI).
- **MoneyGram Access** is the flagship USDC↔cash off-ramp on Stellar (billions in volume as of 2026) and integrates via these SEPs. ([Stellar USDC FAQ](https://stellar.org/blog/ecosystem/usdc-stellar-faq), [MoneyGram Ramps](https://developer.moneygram.com/moneygram-developer/docs/integrate-moneygram-ramps).)

For v1, you likely **don't build ramps at all** — you serve users who already hold XLM/USDC and just need to *split and settle*. Add ramps only when your beachhead demands cash-in/out, and route KYC to the anchor so you don't hold that liability yourself.

### 8.6 Env additions
```env
# USDC asset
NEXT_PUBLIC_USDC_CODE=USDC
NEXT_PUBLIC_USDC_ISSUER=GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN  # mainnet; use SDF test issuer on testnet
NEXT_PUBLIC_DEFAULT_SETTLE_ASSET=USDC   # or XLM
```

---

## 9. The settlement-integrity problem

This is the deepest gap between "project" and "product," so it gets its own section.

### 9.1 What actually happens today
Per the code and your own [docs/ARCHITECTURE_AND_LIMITATIONS.md](./ARCHITECTURE_AND_LIMITATIONS.md#L27):

1. `buildPaymentTransaction` builds a **native XLM payment** on Horizon; the user signs; it's submitted → a real `tx_hash` results.
2. Separately, [contract/src/lib.rs `record_payment`](../contract/src/lib.rs#L154) is called with that `tx_hash`. It calls the pool contract's `withdraw` — but the docs state plainly: *"Pool balances are internal contract accounting credits, not native XLM/token custody transfers on-chain,"* and *"record_payment stores provided tx_hash metadata and relies on app flow integrity; it does not cryptographically verify Horizon payment details inside the contract."*

**Translation:** the contract is a **notary that believes whatever the client tells it.** The `tx_hash` it stores could be fabricated, reused from an unrelated transfer, or point to a payment of the wrong amount to the wrong person. The `is_paid` duplicate-guard and `AlreadyPaid` error protect against *double-recording*, not against *lying about the payment*. The "pool" adds an appearance of custody that isn't real.

For a demo, acceptable and even documented. For a product handling real USDC, **a settlement you can forge is not a settlement.**

### 9.2 Three honest ways to fix it (pick one)

**Option A — Contract *is* the payment (strongest; recommended).**
Move the value transfer **into** the contract. Instead of "pay on Horizon, then notarize," have `record_payment` (or a new `settle`) actually move USDC via the **Stellar Asset Contract (SAC)** using `token::Client::transfer(&payer, &payee, &amount)` with the payer's authorization. Now the payment and the record are the *same atomic on-chain event* — impossible to forge, and the "pool" fiction disappears because real tokens move. This is the correct architecture for on-chain settlement and pairs naturally with USDC ([§8](#8-stablecoins--usdc--how-conversion-actually-works)).

**Option B — Verify before recording (medium).**
Keep the Horizon payment, but have an off-chain **verifier service** (trusted backend) fetch the `tx_hash` from Horizon, confirm `{from, to, asset, amount, memo}` match the claimed expense, and only then co-sign/authorize the contract record. Removes client trust but introduces a trusted server (weaker than A, but a real improvement and easier than rewriting settlement).

**Option C — Drop the contract's custody pretense; position it honestly as a receipt log (cheapest).**
If you're not ready for A or B, **remove the pool contract** and stop implying custody. Relabel `record_payment` as an **audit/receipt anchor**: "an immutable, timestamped, on-chain log of settlement claims, each linked to a Horizon tx you can independently verify." Update all copy to say exactly that. This is honest and shippable immediately — it just doesn't claim more than it does.

> **Recommendation:** Ship **C now** (honesty, this week) and build toward **A** for real USDC settlement (the product). Avoid leaving the current pool illusion in place while marketing "on-chain settlement" — that's precisely the "not honest" outcome you said you want to avoid.

### 9.3 Get the contract audited
Before mainnet with real value, a Soroban security review (e.g., a reputable Soroban auditor) of the final settlement contract is non-negotiable. Budget for it. Ship the audit report link publicly — it's also great trust marketing.

---

## 10. Security hardening

### 10.1 Web / headers
[next.config.mjs](../next.config.mjs) sets good headers (HSTS, X-Frame-Options, nosniff, Referrer-Policy) but **has no Content-Security-Policy** — the highest-value missing header. Add a CSP (nonce-based ideally) allowing only your origins:
```
default-src 'self';
connect-src 'self' https://*.stellar.org https://horizon.stellar.org https://*.supabase.co wss://*.supabase.co https://*.walletconnect.com;
img-src 'self' data: https:;
script-src 'self' 'unsafe-inline';   # tighten to nonces
style-src 'self' 'unsafe-inline';
frame-ancestors 'none';
```
Also add `object-src 'none'`, `base-uri 'self'`. Test against wallet extension injection and WalletConnect.

### 10.2 Prove wallet ownership (Sign-In With Stellar)
Right now any wallet address can be typed/claimed. Before an address is trusted (added as a member who owes/receives, or bound to a user), require a **signed challenge** (SEP-10 style / "Sign in with Stellar"): server issues a nonce, wallet signs it, server verifies the signature matches the address. This prevents impersonation and is the foundation for authenticated Supabase access ([§10.3](#103-data-supabase-rls)).

### 10.3 Data (Supabase RLS)
The anon key is public by design — **RLS is your only wall.** [supabase-setup.sql](../supabase-setup.sql) exists but must be *proven*:
- Every table: RLS enabled, `USING`/`WITH CHECK` policies tied to the authenticated identity (from §10.2), not to a client-supplied field.
- Write a test that, using only the anon key, attempts to read/modify another user's trip/expense and **asserts it fails**. Put it in CI.
- Never trust `payer`/`member` addresses coming from the client without the ownership proof.

### 10.4 Contract
- Fix the `tx_hash` trust gap ([§9](#9-the-settlement-integrity-problem)).
- Keep the existing input validation (amount bounds, id lengths, `payer != member`, `require_auth`) — that part is good.
- Audit ([§9.3](#93-get-the-contract-audited)).

### 10.5 Operational
- **Error monitoring**: Sentry (client + any backend) — you currently strip `console.log` in prod ([next.config.mjs:45](../next.config.mjs#L45)) but capture nothing. You'll be blind to production failures in a money app.
- **Rate limiting** on any backend/API routes (payment building, challenge issuance) to stop abuse.
- **Dependency & secret scanning** in CI (`npm audit`, Dependabot/Renovate, secret scanning, `gitleaks`).
- **No secrets in `NEXT_PUBLIC_`**: everything public today is genuinely public-safe (RPC URLs, anon key, contract id) — keep it that way. Any real secret (server keys, anchor API keys, VAPID private key) must live server-side only.
- **Incident runbook**: extend the existing [docs/RUNBOOK.md](./RUNBOOK.md) with "contract paused," "key compromised," "anchor down," "rollback" procedures.

---

## 11. Testnet → Mainnet migration

This is the "no longer a rehearsal" milestone. Do it *after* [§9](#9-the-settlement-integrity-problem) and an audit.

### Migration checklist
1. **Redeploy the (audited) contract to Mainnet.** New contract ID → update env + docs (your [ARCHITECTURE_AND_LIMITATIONS.md](./ARCHITECTURE_AND_LIMITATIONS.md#L30) already flags this dependency).
2. **Flip env:**
   ```env
   NEXT_PUBLIC_STELLAR_NETWORK=PUBLIC
   NEXT_PUBLIC_HORIZON_URL=https://horizon.stellar.org
   NEXT_PUBLIC_SOROBAN_RPC_URL=https://mainnet.sorobanrpc.com   # or a paid provider
   NEXT_PUBLIC_STELLAR_EXPLORER=https://stellar.expert/explorer/public
   NEXT_PUBLIC_CONTRACT_ID=<mainnet-id>
   NEXT_PUBLIC_USDC_ISSUER=GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN
   ```
   Your `NETWORK_PASSPHRASE` already switches correctly in [constants.ts](../lib/utils/constants.ts).
3. **Use a production-grade RPC/Horizon provider** (public endpoints are rate-limited and not for production traffic).
4. **Reserves & fees are real now**: account minimum balance, trustline reserves, and (small but real) fees. Handle "insufficient XLM for reserve/fee" gracefully in the UI.
5. **Keep a Testnet toggle** for staging/QA — but make the current network *unmistakable* in the UI (banner + colored dot) so nobody thinks Testnet money is real or vice-versa.
6. **Staged rollout**: closed beta (allowlisted addresses, small caps) → open beta → GA. Cap per-tx and daily amounts initially.
7. **Monitoring live**: alerts on failed submissions, RPC errors, contract panics.

---

## 12. Backend & infrastructure productionization

Today it's Next.js on Vercel + Supabase + client-side chain calls. That's a fine *starting* stack; productionize it:

- **Introduce a thin backend** (Next.js Route Handlers or a small service) for the things that must not live in the client:
  - SEP-10 challenge issuance/verification ([§10.2](#102-prove-wallet-ownership-sign-in-with-stellar)),
  - the payment verifier if you choose [§9 Option B](#92-three-honest-ways-to-fix-it-pick-one),
  - push-notification sending, webhooks from anchors,
  - rate limiting.
- **Realtime**: Supabase Realtime is fine; your [hooks/useContractEvents.ts](../hooks/useContractEvents.ts) polls Soroban every 10s — consider server-side event indexing (a worker that ingests contract events into your DB) so clients read from one consistent source instead of each polling RPC.
- **CI/CD**: extend the existing `.github/workflows/ci.yml` to run lint + JS tests + `cargo test` + RLS tests + Lighthouse PWA budget + `npm audit`, and block merge on failure (your architecture doc notes branch protection must be enabled — do it).
- **Environments**: separate Testnet-staging and Mainnet-prod deployments with separate Supabase projects and env sets. Never share a database between them.
- **Backups & migrations**: version-control the Supabase schema (you have [supabase-setup.sql](../supabase-setup.sql) — move to a migrations tool), enable PITR/backups.
- **Observability**: Sentry (errors), a uptime monitor on Horizon/RPC/app, and product analytics ([§14](#14-analytics-growth--monetization)).

---

## 13. Legal, compliance & regulatory reality

Not legal advice — but you cannot ship a money product without confronting this, and pretending otherwise is the opposite of the "honest process" you asked for.

- **Non-custodial peer settlement (the §8-A product)** is the *lowest*-regulatory path: you never touch or hold user funds; value moves wallet-to-wallet. Keep it that way as long as possible — it's your biggest compliance advantage. Say it loudly.
- **The moment you touch fiat or custody** (ramps, holding balances, "pay my electricity bill"), you likely enter **money-transmission / VASP** territory: KYC/AML, licensing, sanctions screening, per-jurisdiction rules. **Do not build this yourself early** — route it to licensed **anchors** (SEP-24/31) so *they* hold the regulatory burden and the KYC.
- **Terms of Service, Privacy Policy, and clear risk disclosures** ("crypto is volatile, transactions are irreversible, you are responsible for your keys") are mandatory before real users. Irreversibility especially: unlike a bank, a wrong Stellar payment can't be clawed back — the UI must confirm destination + amount unmistakably.
- **Data protection** (GDPR/CCPA if applicable): wallet addresses + expense data are personal data. Minimize, disclose, allow deletion.
- **Jurisdiction**: decide where you launch and comply there first; geo-gate the rest.

---

## 14. Analytics, growth & monetization

### Measure (privacy-respecting)
Add product analytics (PostHog or Plausible — self-hostable, privacy-friendly). Track the funnel: land → connect wallet → create expense → **first settlement** (your activation metric) → repeat settlement (retention). Instrument drop-off at wallet-connect and at signing — those are where money apps bleed users.

### Growth loops (built into the product)
- **Every settlement is shareable** — the receipt "share" ([§5](#5-uiux--responsiveness--screen-by-screen)) pulls the payee in. The payee often isn't a user yet → invite loop.
- **Group invites**: adding members to a trip should send an invite link; unregistered members get a "claim your share" onboarding (passkey wallet makes this frictionless — [§7.4](#74-passkey-smart-wallets--the-real-mainstream-unlock)).
- **Cross-border wedge**: content/SEO around "split expenses with friends abroad without remittance fees."

### Honest monetization options (don't nickel-and-dime early)
| Model | Notes |
|---|---|
| Free core, **premium features** | Recurring/scheduled splits, unlimited trips, export/accounting, multi-currency reports. |
| **Ramp referral revenue** | Anchors/MoneyGram integrations can pay referral/spread — aligns with users cashing in/out. |
| **Small settlement fee** (opt-in, transparent) | A tiny fee on settlements, shown explicitly. Only once you deliver clear value; never hidden. |
| B2B: teams/DAOs | Shared treasuries, approvals, reporting. |

Do **not** monetize by taking custody or by obscuring fees — it torches the trust that is your entire moat.

---

## 15. Phased execution roadmap

Each phase has an **exit criterion** — don't advance until it's met.

### Phase 0 — Credibility & honesty pass (days, not weeks)
- Create `og-image.png`; fix/remove broken `docs/*` links; delete fabricated testimonials.
- Rewrite README + landing from "hackathon submission" to product ([§3](#3-product-positioning--honest-market-narrative)).
- Adopt honesty framing for the contract ([§9 Option C](#92-three-honest-ways-to-fix-it-pick-one)) until Option A lands.
- **Exit:** no broken references; no overstated claims anywhere in UI or docs.

### Phase 1 — Product foundations (Tier 0)
- Swap to real Stellar Wallets Kit + WalletConnect ([§7](#7-global-wallet-support--the-honest-stellar-reality)).
- Ship PWA (manifest, SW, icons, install) ([§6](#6-pwa-installable-mobile-app)).
- Full branding asset set ([§4](#4-branding--visual-identity-upgrade)); responsiveness pass ([§5](#5-uiux--responsiveness--screen-by-screen)).
- CSP + headers ([§10.1](#101-web--headers)).
- **Exit:** installable PWA, ≥6 wallets incl. mobile, Lighthouse PWA pass, no critical a11y/contrast failures.

### Phase 2 — Real settlement & stablecoin (Tier 1)
- USDC trustlines + path-payment settlement ([§8](#8-stablecoins--usdc--how-conversion-actually-works)).
- On-chain settlement redesign, Option A ([§9](#9-the-settlement-integrity-problem)); remove the pool illusion.
- Sign-In-With-Stellar + hardened, tested RLS ([§10.2](#102-prove-wallet-ownership-sign-in-with-stellar)–[10.3](#103-data-supabase-rls)).
- Passkey smart-wallet onboarding (beta) ([§7.4](#74-passkey-smart-wallets--the-real-mainstream-unlock)).
- Sentry + analytics.
- **Exit:** a settlement is a single verifiable on-chain event in USDC; no forgeable records; RLS breach test passes in CI.

### Phase 3 — Mainnet & go-to-market (Tier 2)
- Contract audit → Mainnet migration ([§11](#11-testnet--mainnet-migration)).
- ToS/Privacy/risk disclosures ([§13](#13-legal-compliance--regulatory-reality)).
- Staged rollout with caps; monitoring/alerting live.
- Growth loops (share receipt, invites) + first monetization experiment.
- **Exit:** real users settling real USDC on mainnet within amount caps, with monitoring and support in place.

### Phase 4 — Expand
- Anchors/ramps where the beachhead needs cash-in/out; push notifications; recurring splits; team/DAO features.

---

## 16. Concrete repo change checklist

Grounded in this repository's actual files:

**Assets & branding**
- [ ] Add `public/og-image.png` (1200×630) — currently referenced but missing ([app/layout.tsx:38](../app/layout.tsx#L38)).
- [ ] Generate full icon set into `public/brand/` (192/512/maskable/apple-touch/favicon).
- [ ] Add `docs/BRAND.md` with tokens, logo usage, contrast rules.

**PWA**
- [ ] Add `app/manifest.ts` ([§6](#6-pwa-installable-mobile-app)).
- [ ] Add `@serwist/next`, `app/sw.ts`, wrap [next.config.mjs](../next.config.mjs).
- [ ] Add `app/~offline/page.tsx`; add install-prompt component; update `viewport` in [app/layout.tsx:62](../app/layout.tsx#L62) with `viewport-fit=cover`.

**Wallets**
- [x] Replace the hand-rolled wallet implementation with `@creit.tech/stellar-wallets-kit`.
- [ ] Add WalletConnect project id env; test a mobile wallet + Trust Wallet via WC.
- [x] Use the maintained kit's connection modal instead of the bespoke `document.createElement` modal.

**Stablecoin**
- [ ] Add USDC asset + issuer env; "Enable USDC" (`changeTrust`) onboarding step.
- [ ] Add path-payment settlement path in [lib/stellar/buildTransaction.ts](../lib/stellar/buildTransaction.ts); show live rate/slippage.
- [ ] Show USDC balance on [app/dashboard/page.tsx](../app/dashboard/page.tsx).

**Settlement integrity**
- [ ] Decide §9 Option A / B / C; implement. If not A yet, relabel copy to receipt-log honesty and remove pool custody claims.
- [ ] Schedule a Soroban audit before mainnet.

**Security**
- [ ] Add CSP + `object-src/base-uri` to [next.config.mjs](../next.config.mjs).
- [ ] Implement Sign-In-With-Stellar challenge (needs a backend route).
- [ ] Prove & test Supabase RLS ([supabase-setup.sql](../supabase-setup.sql)); add breach test to CI.
- [ ] Add Sentry; add `npm audit`/Dependabot to CI.

**Docs & positioning**
- [ ] Rewrite [README.md](../README.md) as a product (remove "Submission Checklist"/"Phase 8 Proof" framing).
- [ ] Create the missing `docs/QUICKSTART.md`, `docs/SUPABASE_SETUP.md`, `docs/AUTHENTICATION_SETUP.md`, `docs/MANUAL_TESTING_GUIDE.md` or remove their links.
- [ ] Add ToS, Privacy Policy, risk disclosure pages.

---

## Sources / further reading

- Stellar Wallets Kit — https://github.com/Creit-Tech/Stellar-Wallets-Kit
- Stellar Smart Wallets (passkeys) — https://developers.stellar.org/docs/build/apps/smart-wallets
- passkey-kit — https://github.com/kalepail/passkey-kit
- Stellar MetaMask Snap — https://snaps.metamask.io/snap/npm/stellar-snap/
- Path payments — https://developers.stellar.org/docs/build/guides/transactions/path-payments
- USDC on Stellar FAQ — https://stellar.org/blog/ecosystem/usdc-stellar-faq
- MoneyGram Ramps (SEP on/off-ramp) — https://developer.moneygram.com/moneygram-developer/docs/integrate-moneygram-ramps
- Serwist (Next.js PWA) — https://serwist.pages.dev/docs/next

---

*This guide is intentionally blunt about current gaps because you asked to ship an honest product, not to decorate a demo. The bones of SettleX are genuinely good — the work is closing the trust gaps (§9), adding a stable unit of account (§8), broadening wallets (§7), and packaging it as an installable, well-branded PWA (§4–§6). Do the phases in order and every step ships something real.*
