# Quickstart

Get SettleX running locally in ~5 minutes.

## Prerequisites
- Node.js 18+ and npm 9+
- A Stellar wallet extension set to **Testnet** — [Freighter](https://freighter.app), xBull, Lobstr, or Rabet
- (Optional) A free [Supabase](https://supabase.com) project for cross-device sync

## 1. Install
```bash
git clone https://github.com/SnigdhaMandal/SettleX.git
cd SettleX
npm install
```

## 2. Configure environment
```bash
cp .env.local.example .env.local
```
The Stellar/Soroban testnet values are pre-filled. For live sync, add your
Supabase URL + anon key (see [SUPABASE_SETUP.md](./SUPABASE_SETUP.md)). Without
Supabase the app still runs, storing data locally in your browser.

## 3. Fund a testnet wallet
Copy your wallet's public key (starts with `G…`) and fund it:
```
https://horizon-testnet.stellar.org/friendbot?addr=YOUR_PUBLIC_KEY
```

## 4. Run
```bash
npm run dev
```
Open <http://localhost:3000>, connect your wallet, and create your first expense.

### Pool deployments
The optional pool contract in this repository is an **admin-managed accounting
ledger**, not an XLM or USDC vault. Deploy pool schema v2 only. Members cannot
fund or credit themselves; its administrator must explicitly allocate a credit.
The historical testnet v1 pool listed in the README is unsafe and must not be
reused.

## 5. Build for production
```bash
npm run build && npm run start
```

## Verify the changes in this branch
This branch adds a CSP, self-hosted fonts, a PWA layer, and more wallets. After
`npm install`, confirm everything compiles and passes:
```bash
npm run lint
npm run build      # also builds the Serwist service worker
npm test           # 45 unit tests
```
Then run a Lighthouse audit (Chrome DevTools → Lighthouse → PWA) — it should
report the app as installable.

## Troubleshooting
- **"remote fetch disabled" on install** — some sandboxes block the JSR-hosted
  wallet kit. Install in a normal environment.
- **Wallet won't connect** — make sure the extension is set to **Testnet**.
- **No balance** — fund the account with Friendbot (step 3).
- **Service worker not updating** — hard-reload, or unregister it in DevTools →
  Application → Service Workers. It's disabled in `npm run dev` by design.
