# Supabase Setup

SettleX uses Supabase Postgres to sync trips, expenses, and payments across
participants through an authenticated Next.js REST proxy. It's optional for local single-browser use but
required for multi-user sync.

## 1. Create a project
1. Sign up at [supabase.com](https://supabase.com) and create a new project.
2. Wait for it to finish provisioning.

## 2. Load the schema
1. Open **SQL Editor** in your project.
2. Paste the full contents of [`supabase-setup.sql`](../supabase-setup.sql) and run it.
3. This creates the tables and the **Row Level Security (RLS)** policies.

## 3. Get your keys
Project Settings → **API**:
- **Project URL** → `NEXT_PUBLIC_SUPABASE_URL`
- **anon public** key → `NEXT_PUBLIC_SUPABASE_ANON_KEY`

Add both to `.env.local`. The anon key is safe to expose **only** because RLS
governs every row — see the security note below.

## 4. Cross-user updates
Expense and trip changes are refreshed every five seconds while a page is
visible. Supabase Realtime is not used because its browser WebSocket requires
exposing the JWT to JavaScript, which would defeat the HttpOnly-cookie session
design. No Realtime publication setup is needed for these updates.

## ⚠️ Security: prove your RLS before going to production
The anon key is public, so RLS is your **only** access wall. Before real users:
1. Confirm RLS is **enabled** on every table.
2. Write a test that, using only the anon key, tries to read/modify a row that
   belongs to a different wallet and **asserts it fails**. Add it to CI.
3. Tie policies to a verified identity, not a client-supplied wallet field — see
   "Sign-In With Stellar" in
   [PRODUCT_CONVERSION_GUIDE.md](./PRODUCT_CONVERSION_GUIDE.md) §10.2–10.3.

Use **separate Supabase projects** for testnet-staging and mainnet-production —
never share a database between environments.
