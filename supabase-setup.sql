-- ============================================================================
-- SettleX - Supabase Database Setup
-- ============================================================================
-- ✅ SAFE TO RUN MULTIPLE TIMES - This script is fully idempotent
-- It will create new objects or update existing ones without errors
--
-- Instructions:
-- 1. Go to: Supabase Dashboard → SQL Editor → New Query
-- 2. Copy & paste this entire file
-- 3. Click "Run" or press Ctrl+Enter
-- ============================================================================

-- ============================================================================
-- 1. CREATE TABLES
-- ============================================================================

-- Create users table (for wallet-based authentication)
CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid (),
    wallet_address TEXT UNIQUE NOT NULL, -- Stellar wallet address (primary identifier)
    display_name TEXT NOT NULL, -- User's display name (required)
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    last_login_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- Create expenses table
CREATE TABLE IF NOT EXISTS expenses (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid (),
    title TEXT NOT NULL,
    description TEXT,
    total_amount TEXT NOT NULL,
    currency TEXT DEFAULT 'XLM' NOT NULL,
    split_mode TEXT NOT NULL CHECK (
        split_mode IN ('equal', 'custom')
    ),
    paid_by_member_id TEXT NOT NULL,
    members JSONB NOT NULL DEFAULT '[]',
    shares JSONB NOT NULL DEFAULT '[]',
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    settled BOOLEAN DEFAULT FALSE NOT NULL,
    version BIGINT NOT NULL DEFAULT 1,
    -- New: Track creator and member wallets for authentication
    created_by_wallet TEXT NOT NULL,  -- Stellar address of expense creator
    member_wallets TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[], -- Invited wallet addresses
    accepted_wallets TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[] -- Members who explicitly accepted
);

-- Create trips table
CREATE TABLE IF NOT EXISTS trips (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  description TEXT,
  members JSONB NOT NULL DEFAULT '[]',
  expense_ids TEXT[] DEFAULT ARRAY[]::TEXT[] NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  settled BOOLEAN DEFAULT FALSE NOT NULL,
  -- New: Track creator and member wallets for authentication
  created_by_wallet TEXT NOT NULL,  -- Stellar address of trip creator
  member_wallets TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[], -- Invited wallet addresses
  accepted_wallets TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[] -- Members who explicitly accepted
);

-- ============================================================================
-- 1.5. ADD WALLET COLUMNS (if tables already exist from previous setup)
-- ============================================================================
-- These statements safely add the wallet columns if they're missing
-- This allows upgrading existing databases without dropping tables

-- Add wallet columns to expenses table if they don't exist
DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'expenses' AND column_name = 'created_by_wallet'
    ) THEN
        ALTER TABLE expenses ADD COLUMN created_by_wallet TEXT NOT NULL DEFAULT '';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'expenses' AND column_name = 'member_wallets'
    ) THEN
        ALTER TABLE expenses ADD COLUMN member_wallets TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'expenses' AND column_name = 'version'
    ) THEN
        ALTER TABLE expenses ADD COLUMN version BIGINT NOT NULL DEFAULT 1;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'expenses' AND column_name = 'accepted_wallets'
    ) THEN
        ALTER TABLE expenses ADD COLUMN accepted_wallets TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
        -- Existing rows were created before consent existed. Keep them visible
        -- only to their creator until each invited wallet explicitly accepts.
        UPDATE expenses
        SET accepted_wallets = ARRAY[created_by_wallet]
        WHERE created_by_wallet <> '';
    END IF;
END $$;

-- Add wallet columns to trips table if they don't exist
DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'trips' AND column_name = 'created_by_wallet'
    ) THEN
        ALTER TABLE trips ADD COLUMN created_by_wallet TEXT NOT NULL DEFAULT '';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'trips' AND column_name = 'member_wallets'
    ) THEN
        ALTER TABLE trips ADD COLUMN member_wallets TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'trips' AND column_name = 'accepted_wallets'
    ) THEN
        ALTER TABLE trips ADD COLUMN accepted_wallets TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
        UPDATE trips
        SET accepted_wallets = ARRAY[created_by_wallet]
        WHERE created_by_wallet <> '';
    END IF;
END $$;

-- Update users table schema (make display_name required, remove email if exists)
DO $$ 
BEGIN
    -- Set default value for any existing NULL display_name values (only if rows exist)
    IF EXISTS (SELECT 1 FROM users LIMIT 1) THEN
        UPDATE users SET display_name = 'User' WHERE display_name IS NULL OR display_name = '';
    END IF;
    
    -- Make display_name NOT NULL if it's currently nullable
    IF EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'public' AND table_name = 'users' AND column_name = 'display_name' AND is_nullable = 'YES'
    ) THEN
        ALTER TABLE users ALTER COLUMN display_name SET NOT NULL;
    END IF;

    -- Drop email column only if it actually exists
    IF EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'public' AND table_name = 'users' AND column_name = 'email'
    ) THEN
        ALTER TABLE users DROP COLUMN email;
    END IF;
END $$;

-- ============================================================================
-- 2. CREATE INDEXES (for better query performance)
-- ============================================================================

-- Indexes for users
CREATE INDEX IF NOT EXISTS idx_users_wallet_address ON users (wallet_address);

CREATE INDEX IF NOT EXISTS idx_users_created_at ON users (created_at DESC);

-- Indexes for expenses

CREATE INDEX IF NOT EXISTS idx_expenses_created_by_wallet ON expenses (created_by_wallet);

CREATE INDEX IF NOT EXISTS idx_expenses_member_wallets ON expenses USING GIN (member_wallets);

CREATE INDEX IF NOT EXISTS idx_expenses_accepted_wallets ON expenses USING GIN (accepted_wallets);

CREATE INDEX IF NOT EXISTS idx_expenses_created_at ON expenses (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_expenses_settled ON expenses (settled);

CREATE INDEX IF NOT EXISTS idx_trips_created_by_wallet ON trips (created_by_wallet);

CREATE INDEX IF NOT EXISTS idx_trips_member_wallets ON trips USING GIN (member_wallets);

CREATE INDEX IF NOT EXISTS idx_trips_accepted_wallets ON trips USING GIN (accepted_wallets);
-- Indexes for trips
CREATE INDEX IF NOT EXISTS idx_trips_created_at ON trips (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_trips_settled ON trips (settled);

-- ============================================================================
-- 3. ENABLE ROW LEVEL SECURITY & CREATE ACCESS POLICIES
-- ============================================================================
-- Authorization is based on the `wallet_address` claim of the request's JWT.
--
-- That token is minted by /api/auth/verify only after the caller has signed a
-- server-issued challenge transaction with their Stellar private key, and it is
-- signed with the project's JWT secret — which never leaves the server. A
-- caller therefore cannot pick their own identity.
--
-- This replaces the earlier `x-wallet-address` request header, which was set
-- purely client-side and could be forged by anyone holding the (public) anon
-- key. Any deployment still running those policies has no access control at
-- all — re-run this script to replace them.
-- ============================================================================

-- Enable RLS on all tables (required before creating policies)
ALTER TABLE users ENABLE ROW LEVEL SECURITY;

ALTER TABLE expenses ENABLE ROW LEVEL SECURITY;

ALTER TABLE trips ENABLE ROW LEVEL SECURITY;

-- ── Identity helper ─────────────────────────────────────────────────────────
-- Returns the Stellar address the request proved control of, or NULL when the
-- request carries no verified wallet. NULL never equals anything, so every
-- policy below denies by default for unauthenticated callers.

-- Revoked token ids. A row here means the token was signed out (or revoked
-- for the whole wallet) before its `exp`, so it must stop working immediately.
-- Rows are purged once the token they deny would have expired anyway.
CREATE TABLE IF NOT EXISTS public.revoked_tokens (
    jti TEXT PRIMARY KEY,
    wallet_address TEXT NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    revoked_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_revoked_tokens_expires_at ON public.revoked_tokens (expires_at);

CREATE INDEX IF NOT EXISTS idx_revoked_tokens_wallet ON public.revoked_tokens (wallet_address);

-- "Sign out everywhere" tombstones. A token is denied when it was issued at or
-- before `revoked_before`, which covers tokens this server never saw the id of.
CREATE TABLE IF NOT EXISTS public.revoked_wallets (
    wallet_address TEXT PRIMARY KEY,
    revoked_before TIMESTAMPTZ NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_revoked_wallets_expires_at ON public.revoked_wallets (expires_at);

ALTER TABLE public.revoked_wallets ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.revoked_wallets FROM anon, authenticated;

-- Written only by the server (service role key). RLS on with no policies means
-- anon and authenticated match no rows, so a stolen token cannot un-revoke
-- itself by deleting its own row.
ALTER TABLE public.revoked_tokens ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.revoked_tokens FROM anon, authenticated;

-- Reading the denylist has to work for callers who cannot read the table, so
-- the lookup is wrapped in a SECURITY DEFINER function that exposes exactly one
-- boolean and nothing else.
CREATE OR REPLACE FUNCTION public.settlex_token_revoked (
    p_jti TEXT,
    p_wallet_address TEXT,
    p_issued_at BIGINT
) RETURNS BOOLEAN LANGUAGE SQL STABLE SECURITY DEFINER
SET
    search_path = public AS $$
  SELECT
    -- This exact token was signed out...
    EXISTS (SELECT 1 FROM public.revoked_tokens WHERE jti = p_jti)
    -- ...or it predates a "sign out everywhere" for the same wallet.
    OR EXISTS (
        SELECT 1 FROM public.revoked_wallets w
        WHERE w.wallet_address = p_wallet_address
          AND p_issued_at IS NOT NULL
          AND TO_TIMESTAMP(p_issued_at) <= w.revoked_before
    );
$$;

GRANT
EXECUTE ON FUNCTION public.settlex_token_revoked (TEXT, TEXT, BIGINT) TO anon,
authenticated;

CREATE OR REPLACE FUNCTION public.settlex_wallet()
RETURNS TEXT
LANGUAGE SQL
STABLE
SET search_path = ''
-- No longer PARALLEL SAFE: the revocation check reads a table through a
-- SECURITY DEFINER function.
AS $$
  -- Every RLS policy routes through this one function, so the revocation check
  -- lives here: a revoked token resolves to NULL, and NULL equals nothing, so
  -- it matches no row on any table. Tokens minted before `jti` existed have no
  -- id to deny and stay valid until they expire.
  SELECT NULLIF(
    COALESCE(
      CASE
        WHEN public.settlex_token_revoked(
          NULLIF(pg_catalog.current_setting('request.jwt.claims', true), '')::jsonb ->> 'jti',
          NULLIF(pg_catalog.current_setting('request.jwt.claims', true), '')::jsonb ->> 'wallet_address',
          (NULLIF(pg_catalog.current_setting('request.jwt.claims', true), '')::jsonb ->> 'iat')::BIGINT
        ) THEN ''
        ELSE NULLIF(pg_catalog.current_setting('request.jwt.claims', true), '')::jsonb ->> 'wallet_address'
      END,
      ''
    ),
    ''
  );
$$;

GRANT EXECUTE ON FUNCTION public.settlex_wallet() TO anon, authenticated;

-- Revokes one token id. Idempotent: signing out twice is not an error.
CREATE OR REPLACE FUNCTION public.settlex_revoke_token (
    p_jti TEXT,
    p_wallet_address TEXT,
    p_expires_at TIMESTAMPTZ
) RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER
SET
    search_path = public AS $$
BEGIN
    DELETE FROM public.revoked_tokens WHERE expires_at <= NOW();

    INSERT INTO public.revoked_tokens (jti, wallet_address, expires_at)
    VALUES (p_jti, p_wallet_address, p_expires_at)
    ON CONFLICT (jti) DO NOTHING;
END;
$$;

-- Revokes every currently-live token for a wallet ("sign out everywhere").
-- Tokens are stateless, so there is no list of outstanding ids to walk; instead
-- a wallet-wide tombstone is written and `settlex_wallet()` denies any token
-- issued at or before it.
CREATE OR REPLACE FUNCTION public.settlex_revoke_wallet (p_wallet_address TEXT) RETURNS INTEGER LANGUAGE plpgsql SECURITY DEFINER
SET
    search_path = public AS $$
DECLARE
    -- Must outlive the longest token AUTH_SESSION_TTL_SECONDS can mint (12h),
    -- or the tombstone would lapse while a denied token is still valid.
    v_max_ttl INTERVAL := INTERVAL '13 hours';
BEGIN
    INSERT INTO public.revoked_wallets (wallet_address, revoked_before, expires_at)
    VALUES (p_wallet_address, NOW(), NOW() + v_max_ttl)
    ON CONFLICT (wallet_address) DO UPDATE
    SET revoked_before = NOW(),
        expires_at = NOW() + v_max_ttl;

    DELETE FROM public.revoked_wallets WHERE expires_at <= NOW();
    RETURN 1;
END;
$$;

REVOKE ALL ON FUNCTION public.settlex_revoke_token (TEXT, TEXT, TIMESTAMPTZ)
FROM
    PUBLIC,
    anon,
    authenticated;

REVOKE ALL ON FUNCTION public.settlex_revoke_wallet (TEXT)
FROM
    PUBLIC,
    anon,
    authenticated;

GRANT
EXECUTE ON FUNCTION public.settlex_revoke_token (TEXT, TEXT, TIMESTAMPTZ) TO service_role;

GRANT
EXECUTE ON FUNCTION public.settlex_revoke_wallet (TEXT) TO service_role;

-- Purges denylist rows whose tokens have expired on their own. Called by the
-- server on sign-out; safe to also run from pg_cron.
CREATE OR REPLACE FUNCTION public.settlex_purge_revoked_tokens () RETURNS INTEGER LANGUAGE plpgsql SECURITY DEFINER
SET
    search_path = public AS $$
DECLARE
    v_deleted INTEGER;
BEGIN
    DELETE FROM public.revoked_tokens WHERE expires_at <= NOW();
    GET DIAGNOSTICS v_deleted = ROW_COUNT;
    RETURN v_deleted;
END;
$$;

REVOKE ALL ON FUNCTION public.settlex_purge_revoked_tokens ()
FROM
    PUBLIC,
    anon,
    authenticated;

GRANT
EXECUTE ON FUNCTION public.settlex_purge_revoked_tokens () TO service_role;

-- Drop existing policies if they exist
DROP POLICY IF EXISTS "Anyone can view users" ON users;

DROP POLICY IF EXISTS "Authenticated wallets can view users" ON users;

DROP POLICY IF EXISTS "Users can view their own profile or counterparties" ON users;

DROP POLICY IF EXISTS "Users can insert their own profile" ON users;

DROP POLICY IF EXISTS "Users can update their own profile" ON users;

DROP POLICY IF EXISTS "Allow all operations on users" ON users;

DROP POLICY IF EXISTS "Allow all operations on expenses" ON expenses;

DROP POLICY IF EXISTS "Allow all operations on trips" ON trips;

DROP POLICY IF EXISTS "Members can view their expenses" ON expenses;

DROP POLICY IF EXISTS "Members can create expenses" ON expenses;

DROP POLICY IF EXISTS "Members can update their expenses" ON expenses;

DROP POLICY IF EXISTS "Creator can delete expense" ON expenses;

DROP POLICY IF EXISTS "Members can view their trips" ON trips;

DROP POLICY IF EXISTS "Members can create trips" ON trips;

DROP POLICY IF EXISTS "Members can update their trips" ON trips;

DROP POLICY IF EXISTS "Creator can delete trip" ON trips;

-- ============================================================================
-- WALLET-BASED ACCESS CONTROL
-- ============================================================================
-- Only members can see/edit expenses/trips they're part of.
-- Each user can only access expenses/trips where their proven wallet address
-- is in member_wallets[] (or on one of the shares).
--
-- Do NOT replace these with `USING (true)` policies, not even temporarily:
-- the anon key is shipped in the browser bundle, so a permissive policy is
-- equivalent to publishing the table.
-- ============================================================================

-- USERS POLICIES --

-- A user can only view their own profile or the profiles of counterparties
-- with whom they share at least one expense or trip. This prevents directory
-- scraping and mass enumeration of user profiles and balances.
CREATE POLICY "Users can view their own profile or counterparties" ON users FOR
SELECT USING (
    -- 1. Caller viewing their own profile
    wallet_address = public.settlex_wallet()
    OR
    -- 2. Caller and counterparty both accepted the same expense
    EXISTS (
        SELECT 1 FROM public.expenses e
        WHERE public.settlex_wallet() = ANY(e.accepted_wallets)
          AND users.wallet_address = ANY(e.accepted_wallets)
          AND public.settlex_wallet() = ANY(e.member_wallets)
          AND users.wallet_address = ANY(e.member_wallets)
    )
    OR
    -- 3. Caller and counterparty both accepted the same trip
    EXISTS (
        SELECT 1 FROM public.trips t
        WHERE public.settlex_wallet() = ANY(t.accepted_wallets)
          AND users.wallet_address = ANY(t.accepted_wallets)
          AND public.settlex_wallet() = ANY(t.member_wallets)
          AND users.wallet_address = ANY(t.member_wallets)
    )
);

-- Users can insert their own profile during signup (wallet must match)
CREATE POLICY "Users can insert their own profile" ON users
FOR INSERT
WITH CHECK (
    wallet_address = public.settlex_wallet()
);

-- Users can only update their own profile
CREATE POLICY "Users can update their own profile" ON users
FOR UPDATE
USING (
    wallet_address = public.settlex_wallet()
)
WITH CHECK (
    wallet_address = public.settlex_wallet()
);

-- EXPENSES POLICIES --

-- Creators can always view their rows. Other invitees see an expense only
-- after explicitly accepting it; merely naming a public wallet is not consent.
CREATE POLICY "Members can view their expenses" ON expenses
FOR SELECT
USING (
    created_by_wallet = public.settlex_wallet()
    OR (
        public.settlex_wallet() = ANY(member_wallets)
        AND public.settlex_wallet() = ANY(accepted_wallets)
    )
);

-- Any authenticated wallet can create an expense (they become the creator)
CREATE POLICY "Members can create expenses" ON expenses
FOR INSERT
WITH CHECK (
    -- Creator wallet matches the proven wallet
    created_by_wallet = public.settlex_wallet()
    AND
    -- Creator must be in the members list
    created_by_wallet = ANY(member_wallets)
    AND accepted_wallets = ARRAY[created_by_wallet]
    AND settled = false
);

-- Accepted members may update only the narrow fields allowed by the validation
-- trigger. Pending invitees cannot read or update the row.
CREATE POLICY "Members can update their expenses" ON expenses
FOR UPDATE
USING (
    created_by_wallet = public.settlex_wallet()
    OR (
        public.settlex_wallet() = ANY(member_wallets)
        AND public.settlex_wallet() = ANY(accepted_wallets)
    )
)
WITH CHECK (
    created_by_wallet = public.settlex_wallet()
    OR (
        public.settlex_wallet() = ANY(member_wallets)
        AND public.settlex_wallet() = ANY(accepted_wallets)
    )
);

-- Only the creator can delete an expense
CREATE POLICY "Creator can delete expense" ON expenses
FOR DELETE
USING (
    created_by_wallet = public.settlex_wallet()
);

-- TRIPS POLICIES --

-- Pending trip invitations are exposed only through get_pending_invitations().
CREATE POLICY "Members can view their trips" ON trips
FOR SELECT
USING (
    created_by_wallet = public.settlex_wallet()
    OR (
        public.settlex_wallet() = ANY(member_wallets)
        AND public.settlex_wallet() = ANY(accepted_wallets)
    )
);

-- Any authenticated wallet can create a trip
CREATE POLICY "Members can create trips" ON trips
FOR INSERT
WITH CHECK (
    created_by_wallet = public.settlex_wallet()
    AND
    created_by_wallet = ANY(member_wallets)
    AND accepted_wallets = ARRAY[created_by_wallet]
    AND settled = false
);

-- Members can update trips they're part of
CREATE POLICY "Members can update their trips" ON trips
FOR UPDATE
USING (
    created_by_wallet = public.settlex_wallet()
    OR (
        public.settlex_wallet() = ANY(member_wallets)
        AND public.settlex_wallet() = ANY(accepted_wallets)
    )
)
WITH CHECK (
    created_by_wallet = public.settlex_wallet()
    OR (
        public.settlex_wallet() = ANY(member_wallets)
        AND public.settlex_wallet() = ANY(accepted_wallets)
    )
);

-- Only the creator can delete a trip
CREATE POLICY "Creator can delete trip" ON trips
FOR DELETE
USING (
    created_by_wallet = public.settlex_wallet()
);

-- ============================================================================
-- 4. ENABLE REALTIME (for live updates across browsers)
-- ============================================================================
-- Safely add tables to realtime publication (expenses and trips only).
-- The users table is deliberately excluded from realtime replication to prevent
-- malicious callers from streaming all new signups in real time.

DO $$
BEGIN
    -- Remove users table from realtime if previously added
    IF EXISTS (
        SELECT 1 FROM pg_publication_tables 
        WHERE pubname = 'supabase_realtime' 
        AND schemaname = 'public' 
        AND tablename = 'users'
    ) THEN
        ALTER PUBLICATION supabase_realtime DROP TABLE users;
    END IF;

    -- Add expenses table to realtime if not already added
    IF NOT EXISTS (
        SELECT 1
        FROM pg_publication_tables
        WHERE
            pubname = 'supabase_realtime'
            AND schemaname = 'public'
            AND tablename = 'expenses'
    ) THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE expenses;
    END IF;

    -- Add trips table to realtime if not already added
    IF NOT EXISTS (
        SELECT 1
        FROM pg_publication_tables
        WHERE
            pubname = 'supabase_realtime'
            AND schemaname = 'public'
            AND tablename = 'trips'
    ) THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE trips;
    END IF;

END $$;

-- ============================================================================
-- 5. CREATE UPDATED_AT TRIGGERS (Auto-update timestamps)
-- ============================================================================

-- Create function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  NEW.updated_at = pg_catalog.now();
  RETURN NEW;
END;
$$;

-- Drop existing triggers if they exist
DROP TRIGGER IF EXISTS update_users_updated_at ON users;

DROP TRIGGER IF EXISTS update_expenses_updated_at ON expenses;

DROP TRIGGER IF EXISTS update_trips_updated_at ON trips;

-- Create trigger for users
CREATE TRIGGER update_users_updated_at
BEFORE UPDATE ON users
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();

-- Create trigger for expenses
CREATE TRIGGER update_expenses_updated_at
BEFORE UPDATE ON expenses
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();

-- Optimistic concurrency: every update to an expense advances `version`.
--
-- Clients guard writes with `WHERE version = <the value they read>`, which only
-- detects a lost update if every writer actually moves the token. Enforcing the
-- bump here rather than trusting each call site means a writer that forgets --
-- or a hand-run SQL fix -- cannot silently defeat the guard for everyone else.
CREATE OR REPLACE FUNCTION bump_expense_version()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  -- Only when the row's contents actually changed, so a no-op write does not
  -- invalidate another editor's token for nothing.
  IF NEW IS DISTINCT FROM OLD THEN
    IF NEW.version IS NOT DISTINCT FROM OLD.version THEN
      NEW.version = COALESCE(OLD.version, 0) + 1;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS bump_expenses_version ON expenses;

CREATE TRIGGER bump_expenses_version
BEFORE UPDATE ON expenses
FOR EACH ROW
EXECUTE FUNCTION bump_expense_version();

-- Create trigger for trips
CREATE TRIGGER update_trips_updated_at
BEFORE UPDATE ON trips
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();

-- ============================================================================
-- 5.5. COLUMN-LEVEL INTEGRITY & ACCESS CONTROL TRIGGERS
-- ============================================================================
-- Postgres RLS is row-level, not column-level: an UPDATE policy grants write
-- access to every column once the row predicate passes.
-- These BEFORE UPDATE triggers enforce strict column-level authorization:
-- 1. Immutable identifiers (id, created_at, created_by_wallet, wallet_address)
--    can NEVER be altered by any caller.
-- 2. Non-creator members cannot tamper with ownership, member lists, total
--    amounts, currency, split configuration, or other members' shares.
-- 3. Non-creator share updates are strictly limited to marking their own share
--    as paid (paid: false -> true) with a valid transaction hash.
-- 4. Trips cannot be reopened, have expenses removed, or have metadata altered
--    by non-creators.
-- ============================================================================

-- Validate the complete expense payload at the database boundary. Shares store
-- debts owed by non-payers; the payer's allocation is intentionally implicit.
-- The weighted calculation below therefore verifies every stored share against
-- the same exact-stroop allocation used by the client, which also proves that
-- stored shares plus the payer's allocation reconcile to total_amount.
CREATE OR REPLACE FUNCTION public.assert_valid_expense_payload(
    p_total_amount TEXT,
    p_currency TEXT,
    p_split_mode TEXT,
    p_paid_by_member_id TEXT,
    p_members JSONB,
    p_shares JSONB,
    p_created_by_wallet TEXT,
    p_member_wallets TEXT[]
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
    v_total_stroops BIGINT;
    v_member_count INTEGER;
    v_expected_wallets TEXT[];
BEGIN
    IF p_currency <> 'XLM' OR p_split_mode NOT IN ('equal', 'custom') THEN
        RAISE EXCEPTION 'Invalid expense currency or split mode';
    END IF;

    IF p_total_amount IS NULL
       OR NOT (p_total_amount ~ '^(0|[1-9][0-9]*)(\.[0-9]{1,7})?$')
       OR p_total_amount::NUMERIC <= 0
       OR p_total_amount::NUMERIC > 100000000 THEN
        RAISE EXCEPTION 'total_amount must be a positive XLM amount with at most 7 decimals';
    END IF;
    v_total_stroops := (p_total_amount::NUMERIC * 10000000)::BIGINT;

    IF pg_catalog.jsonb_typeof(p_members) <> 'array'
       OR pg_catalog.jsonb_typeof(p_shares) <> 'array' THEN
        RAISE EXCEPTION 'members and shares must be JSON arrays';
    END IF;

    v_member_count := pg_catalog.jsonb_array_length(p_members);
    IF v_member_count < 2 THEN
        RAISE EXCEPTION 'An expense requires at least two members';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM pg_catalog.jsonb_array_elements(p_members) AS m
        WHERE COALESCE(m->>'id', '') = ''
           OR COALESCE(m->>'name', '') = ''
           OR COALESCE(m->>'walletAddress', '') !~ '^G[A-Z2-7]{55}$'
    ) OR (
        SELECT pg_catalog.count(*) <> pg_catalog.count(DISTINCT m->>'id')
        FROM pg_catalog.jsonb_array_elements(p_members) AS m
    ) OR (
        SELECT pg_catalog.count(*) <> pg_catalog.count(DISTINCT m->>'walletAddress')
        FROM pg_catalog.jsonb_array_elements(p_members) AS m
    ) THEN
        RAISE EXCEPTION 'Expense members require unique ids, names, and valid Stellar wallets';
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_catalog.jsonb_array_elements(p_members) AS m
        WHERE m->>'walletAddress' = p_created_by_wallet
    ) THEN
        RAISE EXCEPTION 'The authenticated creator must be an expense member';
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_catalog.jsonb_array_elements(p_members) AS m
        WHERE m->>'id' = p_paid_by_member_id
    ) THEN
        RAISE EXCEPTION 'The expense payer must be a member';
    END IF;

    SELECT COALESCE(
        pg_catalog.array_agg(wallet ORDER BY wallet),
        ARRAY[]::TEXT[]
    )
    INTO v_expected_wallets
    FROM (
        SELECT DISTINCT m->>'walletAddress' AS wallet
        FROM pg_catalog.jsonb_array_elements(p_members) AS m
    ) AS wallets;

    IF p_member_wallets IS NULL
       OR pg_catalog.cardinality(p_member_wallets) <> pg_catalog.cardinality(v_expected_wallets)
       OR NOT (p_member_wallets @> v_expected_wallets AND v_expected_wallets @> p_member_wallets) THEN
        RAISE EXCEPTION 'member_wallets must exactly match expense members';
    END IF;

    IF pg_catalog.jsonb_array_length(p_shares) <> v_member_count - 1 THEN
        RAISE EXCEPTION 'Every non-payer must have exactly one expense share';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM pg_catalog.jsonb_array_elements(p_shares) AS s
        WHERE COALESCE(s->>'memberId', '') = ''
           OR COALESCE(s->>'name', '') = ''
           OR s->>'memberId' = p_paid_by_member_id
           OR NOT (s ? 'paid')
           OR pg_catalog.jsonb_typeof(s->'paid') <> 'boolean'
           OR (s->>'paid')::BOOLEAN
           OR NULLIF(s->>'txHash', '') IS NOT NULL
           OR COALESCE(s->>'amount', '') !~ '^(0|[1-9][0-9]*)(\.[0-9]{1,7})?$'
           OR NOT EXISTS (
                SELECT 1
                FROM pg_catalog.jsonb_array_elements(p_members) AS m
                WHERE m->>'id' = s->>'memberId'
                  AND m->>'name' = s->>'name'
                  AND m->>'walletAddress' = s->>'walletAddress'
           )
    ) OR (
        SELECT pg_catalog.count(*) <> pg_catalog.count(DISTINCT s->>'memberId')
        FROM pg_catalog.jsonb_array_elements(p_shares) AS s
    ) THEN
        RAISE EXCEPTION 'Shares must be unique, unpaid, transaction-free, and match non-payer members';
    END IF;

    IF p_split_mode = 'custom' AND EXISTS (
        SELECT 1
        FROM pg_catalog.jsonb_array_elements(p_members) AS m
        WHERE COALESCE(m->>'weight', '') !~ '^[1-9][0-9]{0,2}$'
           OR (m->>'weight')::INTEGER > 1000
    ) THEN
        RAISE EXCEPTION 'Custom split weights must be integers from 1 to 1000';
    END IF;

    IF EXISTS (
        WITH member_weights AS (
            SELECT
                m,
                ordinality,
                CASE
                    WHEN p_split_mode = 'custom' THEN (m->>'weight')::BIGINT
                    ELSE 1::BIGINT
                END AS weight
            FROM pg_catalog.jsonb_array_elements(p_members) WITH ORDINALITY AS members(m, ordinality)
        ),
        allocations AS (
            SELECT
                m,
                ordinality,
                weight,
                pg_catalog.sum(weight) OVER () AS total_weight
            FROM member_weights
        ),
        bases AS (
            SELECT
                m,
                ordinality,
                (v_total_stroops * weight) / total_weight AS base_stroops,
                (v_total_stroops * weight) % total_weight AS remainder
            FROM allocations
        ),
        ranked AS (
            SELECT
                m,
                base_stroops,
                pg_catalog.row_number() OVER (ORDER BY remainder DESC, ordinality) AS remainder_rank,
                v_total_stroops - pg_catalog.sum(base_stroops) OVER () AS leftover
            FROM bases
        )
        SELECT 1
        FROM ranked AS expected
        JOIN LATERAL (
            SELECT s
            FROM pg_catalog.jsonb_array_elements(p_shares) AS s
            WHERE s->>'memberId' = expected.m->>'id'
        ) AS actual ON true
        WHERE expected.m->>'id' <> p_paid_by_member_id
          AND ((actual.s->>'amount')::NUMERIC * 10000000)::BIGINT
              <> expected.base_stroops
                 + CASE WHEN expected.remainder_rank <= expected.leftover THEN 1 ELSE 0 END
    ) THEN
        RAISE EXCEPTION 'Share amounts do not reconcile to total_amount';
    END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.validate_expense_insert()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_caller TEXT;
BEGIN
    v_caller := public.settlex_wallet();
    IF v_caller IS NULL THEN
        IF COALESCE(pg_catalog.current_setting('request.jwt.claims', true), '') <> '' THEN
            RAISE EXCEPTION 'Unauthorized: invalid or missing wallet session';
        END IF;
    ELSIF NEW.created_by_wallet <> v_caller THEN
        RAISE EXCEPTION 'created_by_wallet must match the authenticated wallet';
    END IF;

    IF NEW.settled OR NEW.version <> 1 THEN
        RAISE EXCEPTION 'New expenses must be unsettled at version 1';
    END IF;

    IF EXISTS (
        SELECT 1 FROM pg_catalog.unnest(NEW.accepted_wallets) AS wallet
        WHERE wallet <> NEW.created_by_wallet
    ) THEN
        RAISE EXCEPTION 'Invited wallets must accept the expense themselves';
    END IF;

    PERFORM public.assert_valid_expense_payload(
        NEW.total_amount,
        NEW.currency,
        NEW.split_mode,
        NEW.paid_by_member_id,
        NEW.members,
        NEW.shares,
        NEW.created_by_wallet,
        NEW.member_wallets
    );

    NEW.accepted_wallets := ARRAY[NEW.created_by_wallet];
    RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.validate_trip_insert()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_caller TEXT;
    v_expected_wallets TEXT[];
BEGIN
    v_caller := public.settlex_wallet();
    IF v_caller IS NULL THEN
        IF COALESCE(pg_catalog.current_setting('request.jwt.claims', true), '') <> '' THEN
            RAISE EXCEPTION 'Unauthorized: invalid or missing wallet session';
        END IF;
    ELSIF NEW.created_by_wallet <> v_caller THEN
        RAISE EXCEPTION 'created_by_wallet must match the authenticated wallet';
    END IF;

    IF NEW.settled OR pg_catalog.cardinality(NEW.expense_ids) <> 0 THEN
        RAISE EXCEPTION 'New trips must be unsettled and contain no expenses';
    END IF;
    IF pg_catalog.jsonb_typeof(NEW.members) <> 'array'
       OR pg_catalog.jsonb_array_length(NEW.members) < 2 THEN
        RAISE EXCEPTION 'A trip requires at least two members';
    END IF;
    IF EXISTS (
        SELECT 1
        FROM pg_catalog.jsonb_array_elements(NEW.members) AS m
        WHERE COALESCE(m->>'id', '') = ''
           OR COALESCE(m->>'name', '') = ''
           OR COALESCE(m->>'walletAddress', '') !~ '^G[A-Z2-7]{55}$'
    ) OR (
        SELECT pg_catalog.count(*) <> pg_catalog.count(DISTINCT m->>'id')
        FROM pg_catalog.jsonb_array_elements(NEW.members) AS m
    ) OR (
        SELECT pg_catalog.count(*) <> pg_catalog.count(DISTINCT m->>'walletAddress')
        FROM pg_catalog.jsonb_array_elements(NEW.members) AS m
    ) THEN
        RAISE EXCEPTION 'Trip members require unique ids, names, and valid Stellar wallets';
    END IF;
    IF NOT EXISTS (
        SELECT 1
        FROM pg_catalog.jsonb_array_elements(NEW.members) AS m
        WHERE m->>'walletAddress' = NEW.created_by_wallet
    ) THEN
        RAISE EXCEPTION 'Trip creator must be a trip member';
    END IF;

    SELECT COALESCE(
        pg_catalog.array_agg(wallet ORDER BY wallet),
        ARRAY[]::TEXT[]
    )
    INTO v_expected_wallets
    FROM (
        SELECT DISTINCT m->>'walletAddress' AS wallet
        FROM pg_catalog.jsonb_array_elements(NEW.members) AS m
    ) AS wallets;

    IF NEW.member_wallets IS NULL
       OR pg_catalog.cardinality(NEW.member_wallets) <> pg_catalog.cardinality(v_expected_wallets)
       OR NOT (NEW.member_wallets @> v_expected_wallets AND v_expected_wallets @> NEW.member_wallets) THEN
        RAISE EXCEPTION 'member_wallets must exactly match trip members';
    END IF;

    IF EXISTS (
        SELECT 1 FROM pg_catalog.unnest(NEW.accepted_wallets) AS wallet
        WHERE wallet <> NEW.created_by_wallet
    ) THEN
        RAISE EXCEPTION 'Invited wallets must accept the trip themselves';
    END IF;

    NEW.accepted_wallets := ARRAY[NEW.created_by_wallet];
    RETURN NEW;
END;
$$;

-- Trigger function for column-level validation and authorization on expenses
CREATE OR REPLACE FUNCTION public.validate_expense_update()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_caller TEXT;
    v_is_creator BOOLEAN;
    v_old_share JSONB;
    v_new_share JSONB;
    v_old_shares_count INTEGER;
    v_new_shares_count INTEGER;
    v_diff_count INTEGER := 0;
    v_idx INTEGER;
    v_all_paid BOOLEAN := true;
    v_share_elem JSONB;
BEGIN
    v_caller := public.settlex_wallet();
    
    -- If executed without a verified wallet in an authenticated PostgREST request, reject
    IF v_caller IS NULL THEN
        IF current_setting('request.jwt.claims', true) IS NOT NULL AND current_setting('request.jwt.claims', true) <> '' THEN
            RAISE EXCEPTION 'Unauthorized: invalid or missing wallet session';
        END IF;
        -- Allow internal DB maintenance / service role
        RETURN NEW;
    END IF;

    -- 1. Immutable fields for ALL callers (including creator)
    IF NEW.id <> OLD.id THEN
        RAISE EXCEPTION 'Cannot modify expense id';
    END IF;

    IF NEW.created_at <> OLD.created_at THEN
        RAISE EXCEPTION 'Cannot modify expense created_at';
    END IF;

    IF NEW.created_by_wallet <> OLD.created_by_wallet THEN
        RAISE EXCEPTION 'Cannot modify expense creator (created_by_wallet)';
    END IF;

    v_is_creator := (v_caller = OLD.created_by_wallet);

    -- Acceptance is an append-only, self-service transition. The RPC below is
    -- SECURITY DEFINER so a pending invitee can accept without first receiving
    -- SELECT/UPDATE access to the expense row.
    IF NEW.accepted_wallets IS DISTINCT FROM OLD.accepted_wallets THEN
        IF v_is_creator
           OR NOT (v_caller = ANY(OLD.member_wallets))
           OR v_caller = ANY(OLD.accepted_wallets)
           OR NOT (OLD.accepted_wallets <@ NEW.accepted_wallets)
           OR pg_catalog.cardinality(NEW.accepted_wallets) <> pg_catalog.cardinality(OLD.accepted_wallets) + 1
           OR NOT (v_caller = ANY(NEW.accepted_wallets)) THEN
            RAISE EXCEPTION 'A wallet may only accept its own pending expense invitation';
        END IF;

        IF NEW.title IS DISTINCT FROM OLD.title
           OR NEW.description IS DISTINCT FROM OLD.description
           OR NEW.total_amount IS DISTINCT FROM OLD.total_amount
           OR NEW.currency IS DISTINCT FROM OLD.currency
           OR NEW.split_mode IS DISTINCT FROM OLD.split_mode
           OR NEW.paid_by_member_id IS DISTINCT FROM OLD.paid_by_member_id
           OR NEW.members IS DISTINCT FROM OLD.members
           OR NEW.shares IS DISTINCT FROM OLD.shares
           OR NEW.created_at IS DISTINCT FROM OLD.created_at
           OR NEW.settled IS DISTINCT FROM OLD.settled
           OR NEW.created_by_wallet IS DISTINCT FROM OLD.created_by_wallet
           OR NEW.member_wallets IS DISTINCT FROM OLD.member_wallets THEN
            RAISE EXCEPTION 'Accepting an invitation cannot modify the expense';
        END IF;
        RETURN NEW;
    END IF;

    -- 2. Creator validations
    IF v_is_creator THEN
        -- Creator cannot drop themselves from member_wallets
        IF NOT (OLD.created_by_wallet = ANY(NEW.member_wallets)) THEN
            RAISE EXCEPTION 'Creator cannot be removed from member_wallets';
        END IF;
        RETURN NEW;
    END IF;

    -- 3. Non-creator member validations: protect sensitive columns from tampering
    IF NEW.title <> OLD.title THEN
        RAISE EXCEPTION 'Only the expense creator can modify title';
    END IF;

    IF NEW.description IS DISTINCT FROM OLD.description THEN
        RAISE EXCEPTION 'Only the expense creator can modify description';
    END IF;

    IF NEW.total_amount <> OLD.total_amount THEN
        RAISE EXCEPTION 'Only the expense creator can modify total_amount';
    END IF;

    IF NEW.currency <> OLD.currency THEN
        RAISE EXCEPTION 'Only the expense creator can modify currency';
    END IF;

    IF NEW.split_mode <> OLD.split_mode THEN
        RAISE EXCEPTION 'Only the expense creator can modify split_mode';
    END IF;

    IF NEW.paid_by_member_id <> OLD.paid_by_member_id THEN
        RAISE EXCEPTION 'Only the expense creator can modify paid_by_member_id';
    END IF;

    IF NEW.members IS DISTINCT FROM OLD.members THEN
        RAISE EXCEPTION 'Only the expense creator can modify members';
    END IF;

    IF NEW.member_wallets IS DISTINCT FROM OLD.member_wallets THEN
        RAISE EXCEPTION 'Only the expense creator can modify member_wallets';
    END IF;

    -- Non-creators modifying shares: can ONLY mark their own share as paid (paid: false -> true) with valid txHash
    IF NEW.shares IS DISTINCT FROM OLD.shares THEN
        v_old_shares_count := jsonb_array_length(OLD.shares);
        v_new_shares_count := jsonb_array_length(NEW.shares);

        IF v_old_shares_count <> v_new_shares_count THEN
            RAISE EXCEPTION 'Cannot add or remove shares';
        END IF;

        FOR v_idx IN 0 .. (v_old_shares_count - 1) LOOP
            v_old_share := OLD.shares->v_idx;
            v_new_share := NEW.shares->v_idx;

            IF v_old_share IS DISTINCT FROM v_new_share THEN
                v_diff_count := v_diff_count + 1;

                -- Must be caller's own share (matches walletAddress on share or in members array)
                IF COALESCE(v_old_share->>'walletAddress', '') <> v_caller THEN
                    IF NOT EXISTS (
                        SELECT 1 FROM jsonb_array_elements(OLD.members) AS m
                        WHERE m->>'id' = v_old_share->>'memberId'
                          AND m->>'walletAddress' = v_caller
                    ) THEN
                        RAISE EXCEPTION 'Cannot modify shares belonging to other members';
                    END IF;
                END IF;

                -- Immutable fields within the share: memberId, amount, currency, shareType, weight, percentage
                IF (v_old_share->>'memberId') IS DISTINCT FROM (v_new_share->>'memberId') OR
                   (v_old_share->>'amount') IS DISTINCT FROM (v_new_share->>'amount') OR
                   (v_old_share->>'currency') IS DISTINCT FROM (v_new_share->>'currency') OR
                   (v_old_share->>'shareType') IS DISTINCT FROM (v_new_share->>'shareType') OR
                   (v_old_share->>'weight') IS DISTINCT FROM (v_new_share->>'weight') OR
                   (v_old_share->>'percentage') IS DISTINCT FROM (v_new_share->>'percentage') THEN
                    RAISE EXCEPTION 'Cannot modify share amounts or split allocation';
                END IF;

                -- Valid status transition: paid false -> true only
                IF COALESCE((v_old_share->>'paid')::boolean, false) = true AND
                   COALESCE((v_new_share->>'paid')::boolean, false) = false THEN
                    RAISE EXCEPTION 'Cannot unmark a paid share';
                END IF;

                IF COALESCE((v_new_share->>'paid')::boolean, false) = true THEN
                    IF v_new_share->>'txHash' IS NULL OR NOT (v_new_share->>'txHash' ~ '^[0-9a-f]{64}$') THEN
                        RAISE EXCEPTION 'Valid transaction hash is required when marking share as paid';
                    END IF;
                    IF EXISTS (
                        SELECT 1 FROM jsonb_array_elements(NEW.shares) AS s
                        WHERE s->>'memberId' != v_new_share->>'memberId'
                        AND s->>'txHash' = v_new_share->>'txHash'
                    ) THEN
                        RAISE EXCEPTION 'Transaction hash already used on another share';
                    END IF;
                END IF;
            END IF;
        END LOOP;

        IF v_diff_count > 1 THEN
            RAISE EXCEPTION 'Cannot modify multiple shares at once';
        END IF;
    END IF;

    -- Validate settled consistency
    IF NEW.settled IS DISTINCT FROM OLD.settled THEN
        FOR v_share_elem IN SELECT * FROM jsonb_array_elements(NEW.shares) LOOP
            IF COALESCE((v_share_elem->>'paid')::boolean, false) = false THEN
                v_all_paid := false;
                EXIT;
            END IF;
        END LOOP;

        IF NEW.settled = true AND NOT v_all_paid THEN
            RAISE EXCEPTION 'Cannot mark expense as settled while unpaid shares remain';
        END IF;

        IF OLD.settled = true AND NEW.settled = false THEN
            RAISE EXCEPTION 'Cannot reopen a settled expense';
        END IF;
    END IF;

    RETURN NEW;
END;
$$;

-- Trigger function for column-level validation and authorization on trips
CREATE OR REPLACE FUNCTION public.validate_trip_update()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_caller TEXT;
    v_is_creator BOOLEAN;
    v_unsettled_count INTEGER;
BEGIN
    v_caller := public.settlex_wallet();

    IF v_caller IS NULL THEN
        IF current_setting('request.jwt.claims', true) IS NOT NULL AND current_setting('request.jwt.claims', true) <> '' THEN
            RAISE EXCEPTION 'Unauthorized: invalid or missing wallet session';
        END IF;
        RETURN NEW;
    END IF;

    -- 1. Immutable fields for ALL callers
    IF NEW.id <> OLD.id THEN
        RAISE EXCEPTION 'Cannot modify trip id';
    END IF;

    IF NEW.created_at <> OLD.created_at THEN
        RAISE EXCEPTION 'Cannot modify trip created_at';
    END IF;

    IF NEW.created_by_wallet <> OLD.created_by_wallet THEN
        RAISE EXCEPTION 'Cannot modify trip creator (created_by_wallet)';
    END IF;

    v_is_creator := (v_caller = OLD.created_by_wallet);

    IF NEW.accepted_wallets IS DISTINCT FROM OLD.accepted_wallets THEN
        IF v_is_creator
           OR NOT (v_caller = ANY(OLD.member_wallets))
           OR v_caller = ANY(OLD.accepted_wallets)
           OR NOT (OLD.accepted_wallets <@ NEW.accepted_wallets)
           OR pg_catalog.cardinality(NEW.accepted_wallets) <> pg_catalog.cardinality(OLD.accepted_wallets) + 1
           OR NOT (v_caller = ANY(NEW.accepted_wallets)) THEN
            RAISE EXCEPTION 'A wallet may only accept its own pending trip invitation';
        END IF;

        IF NEW.name IS DISTINCT FROM OLD.name
           OR NEW.description IS DISTINCT FROM OLD.description
           OR NEW.members IS DISTINCT FROM OLD.members
           OR NEW.expense_ids IS DISTINCT FROM OLD.expense_ids
           OR NEW.created_at IS DISTINCT FROM OLD.created_at
           OR NEW.settled IS DISTINCT FROM OLD.settled
           OR NEW.created_by_wallet IS DISTINCT FROM OLD.created_by_wallet
           OR NEW.member_wallets IS DISTINCT FROM OLD.member_wallets THEN
            RAISE EXCEPTION 'Accepting an invitation cannot modify the trip';
        END IF;
        RETURN NEW;
    END IF;

    -- 2. Creator validations
    IF v_is_creator THEN
        IF NOT (OLD.created_by_wallet = ANY(NEW.member_wallets)) THEN
            RAISE EXCEPTION 'Creator cannot be removed from member_wallets';
        END IF;
        RETURN NEW;
    END IF;

    -- 3. Non-creator member validations
    IF NEW.name <> OLD.name THEN
        RAISE EXCEPTION 'Only trip creator can modify trip name';
    END IF;

    IF NEW.description IS DISTINCT FROM OLD.description THEN
        RAISE EXCEPTION 'Only trip creator can modify trip description';
    END IF;

    IF NEW.members IS DISTINCT FROM OLD.members THEN
        RAISE EXCEPTION 'Only trip creator can modify trip members';
    END IF;

    IF NEW.member_wallets IS DISTINCT FROM OLD.member_wallets THEN
        RAISE EXCEPTION 'Only trip creator can modify member_wallets';
    END IF;

    -- Non-creators cannot remove existing expense ids
    IF NOT (OLD.expense_ids <@ NEW.expense_ids) THEN
        RAISE EXCEPTION 'Cannot remove existing expenses from trip';
    END IF;

    -- Settled status transition check
    IF NEW.settled IS DISTINCT FROM OLD.settled THEN
        IF OLD.settled = true AND NEW.settled = false THEN
            RAISE EXCEPTION 'Cannot reopen a settled trip';
        END IF;

        IF NEW.settled = true THEN
            IF array_length(OLD.expense_ids, 1) > 0 THEN
                SELECT COUNT(*) INTO v_unsettled_count
                FROM public.expenses
                WHERE id = ANY(OLD.expense_ids::UUID[]) AND settled = false;

                IF v_unsettled_count > 0 THEN
                    RAISE EXCEPTION 'Cannot mark trip as settled when linked expenses are still unpaid';
                END IF;
            END IF;
        END IF;
    END IF;

    RETURN NEW;
END;
$$;

-- Trigger function for column-level validation on users
CREATE OR REPLACE FUNCTION public.validate_user_update()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_caller TEXT;
BEGIN
    v_caller := public.settlex_wallet();

    IF v_caller IS NULL THEN
        IF current_setting('request.jwt.claims', true) IS NOT NULL AND current_setting('request.jwt.claims', true) <> '' THEN
            RAISE EXCEPTION 'Unauthorized: invalid or missing wallet session';
        END IF;
        RETURN NEW;
    END IF;

    IF NEW.id <> OLD.id THEN
        RAISE EXCEPTION 'Cannot modify user id';
    END IF;

    IF NEW.created_at <> OLD.created_at THEN
        RAISE EXCEPTION 'Cannot modify user created_at';
    END IF;

    IF NEW.wallet_address <> OLD.wallet_address THEN
        RAISE EXCEPTION 'Cannot modify user wallet_address';
    END IF;

    RETURN NEW;
END;
$$;

-- Drop existing validation triggers if they exist
DROP TRIGGER IF EXISTS validate_users_update ON users;
DROP TRIGGER IF EXISTS validate_expenses_insert ON expenses;
DROP TRIGGER IF EXISTS validate_expenses_update ON expenses;
DROP TRIGGER IF EXISTS validate_trips_insert ON trips;
DROP TRIGGER IF EXISTS validate_trips_update ON trips;

-- Create validation triggers
CREATE TRIGGER validate_users_update
BEFORE UPDATE ON users
FOR EACH ROW
EXECUTE FUNCTION validate_user_update();

CREATE TRIGGER validate_expenses_update
BEFORE UPDATE ON expenses
FOR EACH ROW
EXECUTE FUNCTION validate_expense_update();

CREATE TRIGGER validate_expenses_insert
BEFORE INSERT ON expenses
FOR EACH ROW
EXECUTE FUNCTION validate_expense_insert();

CREATE TRIGGER validate_trips_update
BEFORE UPDATE ON trips
FOR EACH ROW
EXECUTE FUNCTION validate_trip_update();

CREATE TRIGGER validate_trips_insert
BEFORE INSERT ON trips
FOR EACH ROW
EXECUTE FUNCTION validate_trip_insert();

-- Pending invitees cannot SELECT the underlying row. This deliberately narrow
-- RPC exposes only the information needed to make an informed consent choice.
CREATE OR REPLACE FUNCTION public.get_pending_invitations()
RETURNS TABLE (
    entity_type TEXT,
    entity_id UUID,
    title TEXT,
    created_by_wallet TEXT,
    created_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_caller TEXT;
BEGIN
    v_caller := public.settlex_wallet();
    IF v_caller IS NULL THEN
        RAISE EXCEPTION 'Not authenticated';
    END IF;

    RETURN QUERY
    SELECT
        'expense'::TEXT,
        e.id,
        e.title,
        e.created_by_wallet,
        e.created_at
    FROM public.expenses AS e
    WHERE v_caller = ANY(e.member_wallets)
      AND NOT (v_caller = ANY(e.accepted_wallets))
      AND v_caller <> e.created_by_wallet
    UNION ALL
    SELECT
        'trip'::TEXT,
        t.id,
        t.name,
        t.created_by_wallet,
        t.created_at
    FROM public.trips AS t
    WHERE v_caller = ANY(t.member_wallets)
      AND NOT (v_caller = ANY(t.accepted_wallets))
      AND v_caller <> t.created_by_wallet
    ORDER BY created_at DESC;
END;
$$;

CREATE OR REPLACE FUNCTION public.accept_invitation(
    p_entity_type TEXT,
    p_entity_id UUID
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_caller TEXT;
    v_updated_id UUID;
BEGIN
    v_caller := public.settlex_wallet();
    IF v_caller IS NULL THEN
        RAISE EXCEPTION 'Not authenticated';
    END IF;

    IF p_entity_type = 'expense' THEN
        UPDATE public.expenses
        SET accepted_wallets = pg_catalog.array_append(accepted_wallets, v_caller)
        WHERE id = p_entity_id
          AND v_caller = ANY(member_wallets)
          AND NOT (v_caller = ANY(accepted_wallets))
          AND v_caller <> created_by_wallet
        RETURNING id INTO v_updated_id;
    ELSIF p_entity_type = 'trip' THEN
        UPDATE public.trips
        SET accepted_wallets = pg_catalog.array_append(accepted_wallets, v_caller)
        WHERE id = p_entity_id
          AND v_caller = ANY(member_wallets)
          AND NOT (v_caller = ANY(accepted_wallets))
          AND v_caller <> created_by_wallet
        RETURNING id INTO v_updated_id;
    ELSE
        RAISE EXCEPTION 'Unknown invitation type';
    END IF;

    IF v_updated_id IS NULL THEN
        RAISE EXCEPTION 'Pending invitation not found';
    END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.get_pending_invitations() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.accept_invitation(TEXT, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_pending_invitations() TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.accept_invitation(TEXT, UUID) TO authenticated, anon;

-- ============================================================================
-- 5.6. ATOMIC RPC FUNCTION FOR MARKING SHARES PAID (Concurrency-Safe & Authenticated)
-- ============================================================================
-- Safely patches a single element in the shares JSONB array using row-level locking
-- (FOR UPDATE), preventing concurrent payments from overwriting each other, and
-- cryptographically authenticating that only the share owner or creator can mark paid.
CREATE OR REPLACE FUNCTION public.mark_share_paid(
    p_expense_id UUID,
    p_member_id TEXT,
    p_tx_hash TEXT
)
RETURNS SETOF public.expenses
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_caller_wallet TEXT;
    v_creator_wallet TEXT;
    v_current_shares JSONB;
    v_current_members JSONB;
    v_accepted_wallets TEXT[];
    v_updated_shares JSONB;
    v_settled BOOLEAN;
    v_target_wallet TEXT;
    v_is_authorized BOOLEAN := false;
    v_target_found BOOLEAN := false;
    v_share_elem JSONB;
BEGIN
    v_caller_wallet := public.settlex_wallet();
    IF v_caller_wallet IS NULL THEN
        RAISE EXCEPTION 'Not authenticated';
    END IF;

    IF p_tx_hash IS NULL OR NOT (p_tx_hash ~ '^[0-9a-f]{64}$') THEN
        RAISE EXCEPTION 'Valid transaction hash is required to mark a share as paid';
    END IF;

    -- Lock the expense row for update to eliminate race conditions
    SELECT shares, members, created_by_wallet, accepted_wallets
    INTO v_current_shares, v_current_members, v_creator_wallet, v_accepted_wallets
    FROM public.expenses
    WHERE id = p_expense_id
    FOR UPDATE;

    IF v_current_shares IS NULL THEN
        RAISE EXCEPTION 'Expense not found';
    END IF;

    IF v_caller_wallet <> v_creator_wallet
       AND NOT (v_caller_wallet = ANY(v_accepted_wallets)) THEN
        RAISE EXCEPTION 'Accept the expense invitation before recording a payment';
    END IF;

    IF EXISTS (
        SELECT 1 FROM jsonb_array_elements(v_current_shares) AS s
        WHERE s->>'memberId' != p_member_id
        AND s->>'txHash' = p_tx_hash
    ) THEN
        RAISE EXCEPTION 'Transaction hash already used on another share';
    END IF;

    -- Caller must be either the expense creator OR the owner of this share
    IF v_caller_wallet = v_creator_wallet THEN
        v_is_authorized := true;
    END IF;

    FOR v_share_elem IN SELECT * FROM jsonb_array_elements(v_current_shares) LOOP
        IF v_share_elem->>'memberId' = p_member_id THEN
            v_target_found := true;
            v_target_wallet := v_share_elem->>'walletAddress';
            
            -- If share doesn't have walletAddress directly, look up from members array
            IF v_target_wallet IS NULL OR v_target_wallet = '' THEN
                SELECT m->>'walletAddress' INTO v_target_wallet
                FROM jsonb_array_elements(v_current_members) AS m
                WHERE m->>'id' = p_member_id;
            END IF;

            IF v_target_wallet = v_caller_wallet THEN
                v_is_authorized := true;
            END IF;
        END IF;
    END LOOP;

    IF NOT v_target_found THEN
        RAISE EXCEPTION 'Member share not found in expense';
    END IF;

    IF NOT v_is_authorized THEN
        RAISE EXCEPTION 'Not authorized to mark this share as paid';
    END IF;

    -- Atomically transform the specific member share inside the JSONB array
    SELECT 
        pg_catalog.jsonb_agg(
            CASE 
                WHEN elem->>'memberId' = p_member_id THEN 
                    pg_catalog.jsonb_set(
                        pg_catalog.jsonb_set(
                            pg_catalog.jsonb_set(
                                pg_catalog.jsonb_set(elem, '{paid}', 'true'::jsonb),
                                '{txHash}', 
                                pg_catalog.to_jsonb(p_tx_hash)
                            ),
                            '{paidBy}',
                            pg_catalog.to_jsonb(v_caller_wallet)
                        ),
                        '{markedAt}',
                        pg_catalog.to_jsonb(pg_catalog.to_char(pg_catalog.now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'))
                    )
                ELSE elem 
            END
        ),
        pg_catalog.bool_and(
            CASE 
                WHEN elem->>'memberId' = p_member_id THEN true
                ELSE COALESCE((elem->>'paid')::boolean, false)
            END
        )
    INTO v_updated_shares, v_settled
    FROM pg_catalog.jsonb_array_elements(v_current_shares) AS elem;

    RETURN QUERY
    UPDATE public.expenses
    SET 
        shares = v_updated_shares,
        settled = COALESCE(v_settled, false),
        version = COALESCE(version, 0) + 1,
        updated_at = pg_catalog.now()
    WHERE id = p_expense_id
    RETURNING *;
END;
$$;

GRANT EXECUTE ON FUNCTION public.mark_share_paid(UUID, TEXT, TEXT) TO authenticated, anon;

-- Resolve only the caller's own profile or a counterparty profile from a shared,
-- accepted expense/trip. Stellar addresses are public, so requiring a "known"
-- address alone does not prevent directory enumeration. Also cap lookups per
-- authenticated wallet; this quota is a secondary guard, not the authorization boundary.
CREATE OR REPLACE FUNCTION public.resolve_user_profile(p_wallet_address TEXT)
RETURNS TABLE (
    wallet_address TEXT,
    display_name TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_caller_wallet TEXT;
    v_allowed BOOLEAN;
    v_retry_after INTEGER;
BEGIN
    v_caller_wallet := public.settlex_wallet();
    IF v_caller_wallet IS NULL THEN
        RAISE EXCEPTION 'Not authenticated';
    END IF;

    IF p_wallet_address IS NULL OR trim(p_wallet_address) = '' THEN
        RETURN;
    END IF;

    SELECT limit_result.allowed, limit_result.retry_after
    INTO v_allowed, v_retry_after
    FROM public.auth_rate_limit(
        'profile_lookup:' || v_caller_wallet,
        60,
        60000
    ) AS limit_result;

    IF NOT v_allowed THEN
        RAISE EXCEPTION 'Profile lookup rate limit exceeded; retry after % seconds', v_retry_after;
    END IF;

    RETURN QUERY
    SELECT u.wallet_address, u.display_name
    FROM public.users u
    WHERE u.wallet_address = p_wallet_address
      AND (
          u.wallet_address = v_caller_wallet
          OR EXISTS (
              SELECT 1
              FROM public.expenses e
              WHERE v_caller_wallet = ANY(e.accepted_wallets)
                AND u.wallet_address = ANY(e.accepted_wallets)
                AND v_caller_wallet = ANY(e.member_wallets)
                AND u.wallet_address = ANY(e.member_wallets)
          )
          OR EXISTS (
              SELECT 1
              FROM public.trips t
              WHERE v_caller_wallet = ANY(t.accepted_wallets)
                AND u.wallet_address = ANY(t.accepted_wallets)
                AND v_caller_wallet = ANY(t.member_wallets)
                AND u.wallet_address = ANY(t.member_wallets)
          )
      )
    LIMIT 1;
END;
$$;

REVOKE ALL ON FUNCTION public.resolve_user_profile(TEXT) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.resolve_user_profile(TEXT) TO authenticated;

-- ============================================================================
-- 5.7. AUTH SHARED STATE (Replay Guard + Rate Limiting Across Instances)
-- ============================================================================
-- The auth routes run on serverless instances that do not share memory, so a
-- challenge nonce burned in one process means nothing to its siblings and a
-- per-process rate limiter multiplies the real limit by the instance count.
-- Both tables below are written only by the server, using the service role key
-- (SUPABASE_SERVICE_ROLE_KEY) — never the anon key.

CREATE TABLE IF NOT EXISTS public.auth_nonces (
    nonce TEXT PRIMARY KEY,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_auth_nonces_expires_at ON public.auth_nonces (expires_at);

CREATE TABLE IF NOT EXISTS public.auth_rate_limits (
    key TEXT PRIMARY KEY,
    hits INTEGER NOT NULL,
    reset_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_auth_rate_limits_reset_at ON public.auth_rate_limits (reset_at);

-- RLS on with no policies: anon and authenticated match no rows at all. The
-- service role bypasses RLS, which is exactly the access the auth routes need.
ALTER TABLE public.auth_nonces ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.auth_rate_limits ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.auth_nonces FROM anon, authenticated;

REVOKE ALL ON public.auth_rate_limits FROM anon, authenticated;

-- Burns a nonce for every instance at once. Returns TRUE the first time a nonce
-- is seen and FALSE on every replay; the insert is the atomic check, so two
-- concurrent verifies of the same challenge cannot both win.
CREATE OR REPLACE FUNCTION public.auth_consume_nonce (p_nonce TEXT, p_expires_at TIMESTAMPTZ) RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER
SET
    search_path = public AS $$
DECLARE
    v_inserted INTEGER;
BEGIN
    DELETE FROM public.auth_nonces WHERE expires_at <= NOW();

    INSERT INTO public.auth_nonces (nonce, expires_at)
    VALUES (p_nonce, p_expires_at)
    ON CONFLICT (nonce) DO NOTHING;

    GET DIAGNOSTICS v_inserted = ROW_COUNT;
    RETURN v_inserted > 0;
END;
$$;

-- Fixed-window counter shared by every instance. One statement does the read,
-- the increment and the window roll-over, so concurrent callers cannot both
-- read a stale count.
CREATE OR REPLACE FUNCTION public.auth_rate_limit (
    p_key TEXT,
    p_limit INTEGER,
    p_window_ms INTEGER
) RETURNS TABLE (allowed BOOLEAN, retry_after INTEGER) LANGUAGE plpgsql SECURITY DEFINER
SET
    search_path = public AS $$
DECLARE
    v_window INTERVAL := (p_window_ms || ' milliseconds')::INTERVAL;
    v_hits INTEGER;
    v_reset TIMESTAMPTZ;
BEGIN
    DELETE FROM public.auth_rate_limits WHERE reset_at <= NOW();

    INSERT INTO public.auth_rate_limits AS r (key, hits, reset_at)
    VALUES (p_key, 1, NOW() + v_window)
    ON CONFLICT (key) DO UPDATE
    SET hits = CASE WHEN r.reset_at <= NOW() THEN 1 ELSE r.hits + 1 END,
        reset_at = CASE WHEN r.reset_at <= NOW() THEN NOW() + v_window ELSE r.reset_at END
    RETURNING r.hits, r.reset_at INTO v_hits, v_reset;

    IF v_hits > p_limit THEN
        RETURN QUERY SELECT FALSE, GREATEST(1, CEIL(EXTRACT(EPOCH FROM (v_reset - NOW())))::INTEGER);
    ELSE
        RETURN QUERY SELECT TRUE, 0;
    END IF;
END;
$$;

-- Only the server (service role) may call these.
REVOKE ALL ON FUNCTION public.auth_consume_nonce (TEXT, TIMESTAMPTZ)
FROM
    PUBLIC,
    anon,
    authenticated;

REVOKE ALL ON FUNCTION public.auth_rate_limit (TEXT, INTEGER, INTEGER)
FROM
    PUBLIC,
    anon,
    authenticated;

GRANT
EXECUTE ON FUNCTION public.auth_consume_nonce (TEXT, TIMESTAMPTZ) TO service_role;

GRANT
EXECUTE ON FUNCTION public.auth_rate_limit (TEXT, INTEGER, INTEGER) TO service_role;

-- ============================================================================
-- 6. VERIFICATION QUERIES (Optional - Run to verify setup)
-- ============================================================================

-- Check tables exist
SELECT table_name
FROM information_schema.tables
WHERE
    table_schema = 'public'
    AND table_name IN (
        'users',
        'expenses',
        'trips',
        'auth_nonces',
        'auth_rate_limits'
    );

-- Check indexes exist
SELECT indexname
FROM pg_indexes
WHERE
    tablename IN ('users', 'expenses', 'trips');

-- Check RLS is enabled
SELECT tablename, rowsecurity
FROM pg_tables
WHERE
    tablename IN ('users', 'expenses', 'trips');

-- Check policies exist
SELECT tablename, policyname
FROM pg_policies
WHERE
    tablename IN ('users', 'expenses', 'trips');
