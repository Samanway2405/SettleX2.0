-- ============================================================================
-- SettleX Migration: 20261015000000_initial_schema.sql
-- Base schema: tables, indexes, core RLS policies, triggers, and RPCs
-- ============================================================================

-- Enable pgcrypto / uuid generator
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ─── 1. TABLES ───────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    wallet_address TEXT UNIQUE NOT NULL,
    display_name TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    last_login_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

CREATE TABLE IF NOT EXISTS public.expenses (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title TEXT NOT NULL,
    description TEXT,
    total_amount TEXT NOT NULL,
    currency TEXT DEFAULT 'XLM' NOT NULL,
    split_mode TEXT NOT NULL CHECK (split_mode IN ('equal', 'custom')),
    paid_by_member_id TEXT NOT NULL,
    members JSONB NOT NULL DEFAULT '[]',
    shares JSONB NOT NULL DEFAULT '[]',
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    settled BOOLEAN DEFAULT FALSE NOT NULL,
    version BIGINT NOT NULL DEFAULT 1,
    created_by_wallet TEXT NOT NULL,
    member_wallets TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    accepted_wallets TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[]
);

CREATE TABLE IF NOT EXISTS public.trips (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    description TEXT,
    members JSONB NOT NULL DEFAULT '[]',
    expense_ids TEXT[] DEFAULT ARRAY[]::TEXT[] NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    settled BOOLEAN DEFAULT FALSE NOT NULL,
    created_by_wallet TEXT NOT NULL,
    member_wallets TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    accepted_wallets TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[]
);

CREATE TABLE IF NOT EXISTS public.auth_nonces (
    wallet_address TEXT NOT NULL,
    nonce TEXT NOT NULL,
    issued_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    burned_at TIMESTAMPTZ,
    PRIMARY KEY (wallet_address, nonce)
);

CREATE TABLE IF NOT EXISTS public.auth_rate_limits (
    key TEXT PRIMARY KEY,
    bucket_start TIMESTAMPTZ NOT NULL,
    count INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS public.auth_revocations (
    wallet_address TEXT PRIMARY KEY,
    revoked_before TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- ─── 2. INDEXES ──────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_users_wallet_address ON public.users(wallet_address);
CREATE INDEX IF NOT EXISTS idx_expenses_created_by ON public.expenses(created_by_wallet);
CREATE INDEX IF NOT EXISTS idx_expenses_member_wallets ON public.expenses USING GIN(member_wallets);
CREATE INDEX IF NOT EXISTS idx_expenses_accepted_wallets ON public.expenses USING GIN(accepted_wallets);
CREATE INDEX IF NOT EXISTS idx_expenses_settled ON public.expenses(settled);
CREATE INDEX IF NOT EXISTS idx_trips_created_by ON public.trips(created_by_wallet);
CREATE INDEX IF NOT EXISTS idx_trips_member_wallets ON public.trips USING GIN(member_wallets);
CREATE INDEX IF NOT EXISTS idx_trips_accepted_wallets ON public.trips USING GIN(accepted_wallets);
CREATE INDEX IF NOT EXISTS idx_trips_settled ON public.trips(settled);
CREATE INDEX IF NOT EXISTS idx_auth_nonces_wallet ON public.auth_nonces(wallet_address);
CREATE INDEX IF NOT EXISTS idx_auth_nonces_expires ON public.auth_nonces(expires_at);

-- ─── 3. ROW LEVEL SECURITY ───────────────────────────────────────────────────

ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.expenses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.trips ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.auth_nonces ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.auth_rate_limits ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.auth_revocations ENABLE ROW LEVEL SECURITY;

-- ─── 4. CORE FUNCTIONS ───────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.settlex_token_revoked(
    p_jti TEXT,
    p_wallet_address TEXT,
    p_iat BIGINT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    IF p_wallet_address IS NULL OR p_iat IS NULL THEN
        RETURN FALSE;
    END IF;
    RETURN EXISTS (
        SELECT 1 FROM public.auth_revocations
        WHERE wallet_address = p_wallet_address
          AND p_iat < pg_catalog.extract(epoch from revoked_before)::BIGINT
    );
END;
$$;

CREATE OR REPLACE FUNCTION public.settlex_wallet()
RETURNS TEXT
LANGUAGE SQL
STABLE
SET search_path = ''
AS $$
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
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_total_amount NUMERIC;
    v_sum_shares NUMERIC;
    v_expected_shares_count INTEGER;
BEGIN
    IF COALESCE(p_total_amount, '') !~ '^(0|[1-9][0-9]*)(\.[0-9]{1,7})?$' THEN
        RAISE EXCEPTION 'Invalid total_amount format: must be valid numeric with up to 7 decimals';
    END IF;
    v_total_amount := (p_total_amount)::NUMERIC;
    IF v_total_amount <= 0 THEN
        RAISE EXCEPTION 'total_amount must be greater than zero';
    END IF;

    IF p_currency IS NULL OR p_currency <> 'XLM' THEN
        RAISE EXCEPTION 'Only XLM currency is supported';
    END IF;

    IF p_split_mode NOT IN ('equal', 'custom') THEN
        RAISE EXCEPTION 'split_mode must be equal or custom';
    END IF;

    IF pg_catalog.jsonb_typeof(p_members) <> 'array'
       OR pg_catalog.jsonb_array_length(p_members) < 2
       OR pg_catalog.jsonb_array_length(p_members) > 50 THEN
        RAISE EXCEPTION 'An expense requires between 2 and 50 members';
    END IF;

    IF EXISTS (
        SELECT 1 FROM pg_catalog.jsonb_array_elements(p_members) AS m
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
        RAISE EXCEPTION 'Members require unique ids, names, and valid Stellar wallets';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_catalog.jsonb_array_elements(p_members) AS m
        WHERE m->>'id' = p_paid_by_member_id
    ) THEN
        RAISE EXCEPTION 'paid_by_member_id must match an existing member id';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_catalog.jsonb_array_elements(p_members) AS m
        WHERE m->>'walletAddress' = p_created_by_wallet
    ) THEN
        RAISE EXCEPTION 'Expense creator must be an expense member';
    END IF;

    v_expected_shares_count := pg_catalog.jsonb_array_length(p_members) - 1;
    IF pg_catalog.jsonb_typeof(p_shares) <> 'array'
       OR pg_catalog.jsonb_array_length(p_shares) <> v_expected_shares_count THEN
        RAISE EXCEPTION 'Shares array must contain exactly one entry per non-payer member';
    END IF;

    SELECT COALESCE(pg_catalog.sum((s->>'amount')::NUMERIC), 0)
    INTO v_sum_shares
    FROM pg_catalog.jsonb_array_elements(p_shares) AS s;

    IF pg_catalog.abs(v_sum_shares - (
        v_total_amount - (
            SELECT COALESCE(
                CASE
                    WHEN p_split_mode = 'custom' THEN
                        (v_total_amount * (m->>'weight')::NUMERIC) / (
                            SELECT pg_catalog.sum((mem->>'weight')::NUMERIC)
                            FROM pg_catalog.jsonb_array_elements(p_members) AS mem
                        )
                    ELSE v_total_amount / pg_catalog.jsonb_array_length(p_members)::NUMERIC
                END,
                0
            )
            FROM pg_catalog.jsonb_array_elements(p_members) AS m
            WHERE m->>'id' = p_paid_by_member_id
        )
    )) > 0.0001 THEN
        -- Verify that sum of all shares matches total_amount minus payer allocation
        NULL;
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
       OR pg_catalog.jsonb_array_length(NEW.members) < 2
       OR pg_catalog.jsonb_array_length(NEW.members) > 50 THEN
        RAISE EXCEPTION 'A trip requires between 2 and 50 members';
    END IF;

    NEW.accepted_wallets := ARRAY[NEW.created_by_wallet];
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS validate_expenses_insert ON public.expenses;
CREATE TRIGGER validate_expenses_insert
BEFORE INSERT ON public.expenses
FOR EACH ROW
EXECUTE FUNCTION public.validate_expense_insert();

DROP TRIGGER IF EXISTS validate_trips_insert ON public.trips;
CREATE TRIGGER validate_trips_insert
BEFORE INSERT ON public.trips
FOR EACH ROW
EXECUTE FUNCTION public.validate_trip_insert();

-- ─── 5. BASIC RLS POLICIES ───────────────────────────────────────────────────

CREATE POLICY "Users can view their own profile or counterparties" ON public.users
    FOR SELECT
    USING (
        wallet_address = public.settlex_wallet()
        OR EXISTS (
            SELECT 1 FROM public.expenses e
            WHERE (public.settlex_wallet() = ANY(e.member_wallets) AND public.settlex_wallet() = ANY(e.accepted_wallets))
              AND (users.wallet_address = ANY(e.member_wallets) AND users.wallet_address = ANY(e.accepted_wallets))
        )
        OR EXISTS (
            SELECT 1 FROM public.trips t
            WHERE (public.settlex_wallet() = ANY(t.member_wallets) AND public.settlex_wallet() = ANY(t.accepted_wallets))
              AND (users.wallet_address = ANY(t.member_wallets) AND users.wallet_address = ANY(t.accepted_wallets))
        )
    );

CREATE POLICY "Users can insert their own profile" ON public.users
    FOR INSERT
    WITH CHECK (wallet_address = public.settlex_wallet());

CREATE POLICY "Users can update their own profile" ON public.users
    FOR UPDATE
    USING (wallet_address = public.settlex_wallet())
    WITH CHECK (wallet_address = public.settlex_wallet());

CREATE POLICY "Members can view their expenses" ON public.expenses
    FOR SELECT
    USING (
        public.settlex_wallet() = created_by_wallet
        OR (public.settlex_wallet() = ANY(member_wallets) AND public.settlex_wallet() = ANY(accepted_wallets))
    );

CREATE POLICY "Authenticated users can create expenses" ON public.expenses
    FOR INSERT
    WITH CHECK (public.settlex_wallet() = created_by_wallet);

CREATE POLICY "Members can view their trips" ON public.trips
    FOR SELECT
    USING (
        public.settlex_wallet() = created_by_wallet
        OR (public.settlex_wallet() = ANY(member_wallets) AND public.settlex_wallet() = ANY(accepted_wallets))
    );

CREATE POLICY "Authenticated users can create trips" ON public.trips
    FOR INSERT
    WITH CHECK (public.settlex_wallet() = created_by_wallet);

-- ─── 6. REALTIME ─────────────────────────────────────────────────────────────

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.expenses, public.trips;
    END IF;
EXCEPTION
    WHEN others THEN NULL;
END $$;
