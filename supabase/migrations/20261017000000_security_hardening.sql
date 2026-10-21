-- ============================================================================
-- SettleX Migration: 20261017000000_security_hardening.sql
-- Security Hardening: Fixes for Creator & Member Bypasses (SX-026 to SX-030)
-- ============================================================================

-- ─── 1. GLOBAL PAYMENTS TABLE (SX-028) ────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.payments (
    tx_hash TEXT PRIMARY KEY,
    expense_id UUID NOT NULL REFERENCES public.expenses(id) ON DELETE CASCADE,
    member_id TEXT NOT NULL,
    paid_by_wallet TEXT NOT NULL,
    manual BOOLEAN DEFAULT false NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'public' AND table_name = 'payments' AND column_name = 'manual'
    ) THEN
        ALTER TABLE public.payments ADD COLUMN manual BOOLEAN DEFAULT false NOT NULL;
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_payments_expense_id ON public.payments(expense_id);
ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Members can view payments for their expenses" ON public.payments;
CREATE POLICY "Members can view payments for their expenses" ON public.payments
    FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM public.expenses e
            WHERE e.id = payments.expense_id
              AND (
                  public.settlex_wallet() = e.created_by_wallet
                  OR (
                      public.settlex_wallet() = ANY(e.member_wallets)
                      AND public.settlex_wallet() = ANY(e.accepted_wallets)
                  )
                  OR EXISTS (
                      SELECT 1 FROM public.trips t
                      WHERE e.id::TEXT = ANY(t.expense_ids)
                        AND (
                            public.settlex_wallet() = t.created_by_wallet
                            OR (
                                public.settlex_wallet() = ANY(t.member_wallets)
                                AND public.settlex_wallet() = ANY(t.accepted_wallets)
                            )
                        )
                  )
              )
        )
    );

-- ─── 1.1. TRIP_EXPENSES JOIN TABLE (SX-029) ──────────────────────────────────

CREATE TABLE IF NOT EXISTS public.trip_expenses (
    trip_id UUID NOT NULL REFERENCES public.trips(id) ON DELETE CASCADE,
    expense_id UUID NOT NULL REFERENCES public.expenses(id) ON DELETE CASCADE,
    added_by_wallet TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    PRIMARY KEY (trip_id, expense_id)
);

CREATE INDEX IF NOT EXISTS idx_trip_expenses_trip_id ON public.trip_expenses(trip_id);
CREATE INDEX IF NOT EXISTS idx_trip_expenses_expense_id ON public.trip_expenses(expense_id);
ALTER TABLE public.trip_expenses ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Members can view trip_expenses" ON public.trip_expenses;
CREATE POLICY "Members can view trip_expenses" ON public.trip_expenses
    FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM public.trips t
            WHERE t.id = trip_expenses.trip_id
              AND (
                  public.settlex_wallet() = t.created_by_wallet
                  OR (
                      public.settlex_wallet() = ANY(t.member_wallets)
                      AND public.settlex_wallet() = ANY(t.accepted_wallets)
                  )
              )
        )
    );

-- ─── 2. HARDENED MARK_SHARE_PAID (SX-028) ───────────────────────────────────

CREATE OR REPLACE FUNCTION public.mark_share_paid(
    p_expense_id UUID,
    p_member_id TEXT,
    p_tx_hash TEXT
)
RETURNS SETOF public.expenses
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
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
    v_is_manual BOOLEAN := false;
    v_target_found BOOLEAN := false;
    v_share_elem JSONB;
    v_share_is_paid BOOLEAN := false;
BEGIN
    v_caller_wallet := public.settlex_wallet();
    IF v_caller_wallet IS NULL THEN
        RAISE EXCEPTION 'Not authenticated';
    END IF;

    IF p_tx_hash IS NULL OR NOT (p_tx_hash ~ '^[0-9a-f]{64}$') THEN
        RAISE EXCEPTION 'Valid transaction hash is required to mark a share as paid';
    END IF;

    -- Global uniqueness check across all expenses (SX-028)
    IF EXISTS (
        SELECT 1 FROM public.payments WHERE tx_hash = p_tx_hash
    ) THEN
        RAISE EXCEPTION 'Transaction hash already used on another payment';
    END IF;

    IF EXISTS (
        SELECT 1 FROM public.expenses e, pg_catalog.jsonb_array_elements(e.shares) AS s
        WHERE (e.id <> p_expense_id OR s->>'memberId' <> p_member_id)
        AND s->>'txHash' = p_tx_hash
    ) THEN
        RAISE EXCEPTION 'Transaction hash already used on another payment';
    END IF;

    -- Lock the expense row for update
    SELECT shares, members, created_by_wallet, accepted_wallets
    INTO v_current_shares, v_current_members, v_creator_wallet, v_accepted_wallets
    FROM public.expenses
    WHERE id = p_expense_id
    FOR UPDATE;

    IF v_current_shares IS NULL THEN
        RAISE EXCEPTION 'Expense not found';
    END IF;

    IF v_caller_wallet <> v_creator_wallet
       AND NOT (v_caller_wallet = ANY(v_accepted_wallets))
       AND NOT EXISTS (
           SELECT 1 FROM public.trips t
           WHERE p_expense_id::TEXT = ANY(t.expense_ids)
             AND (
                 v_caller_wallet = t.created_by_wallet
                 OR (
                     v_caller_wallet = ANY(t.member_wallets)
                     AND v_caller_wallet = ANY(t.accepted_wallets)
                 )
             )
       ) THEN
        RAISE EXCEPTION 'Accept the expense invitation before recording a payment';
    END IF;

    IF EXISTS (
        SELECT 1 FROM pg_catalog.jsonb_array_elements(v_current_shares) AS s
        WHERE s->>'memberId' != p_member_id
        AND s->>'txHash' = p_tx_hash
    ) THEN
        RAISE EXCEPTION 'Transaction hash already used on another share';
    END IF;

    FOR v_share_elem IN SELECT * FROM pg_catalog.jsonb_array_elements(v_current_shares) LOOP
        IF v_share_elem->>'memberId' = p_member_id THEN
            v_target_found := true;
            v_share_is_paid := COALESCE((v_share_elem->>'paid')::boolean, false);
            v_target_wallet := v_share_elem->>'walletAddress';
            
            -- Prevent re-marking an already-paid share (SX-028)
            IF v_share_is_paid OR ((v_share_elem->>'txHash') IS NOT NULL AND (v_share_elem->>'txHash') <> '') THEN
                RAISE EXCEPTION 'Share is already marked as paid';
            END IF;

            IF v_target_wallet IS NULL OR v_target_wallet = '' THEN
                SELECT m->>'walletAddress' INTO v_target_wallet
                FROM pg_catalog.jsonb_array_elements(v_current_members) AS m
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

    -- Caller must be either the expense creator OR the owner of this share
    IF v_caller_wallet = v_creator_wallet THEN
        v_is_authorized := true;
        -- Flag creator manual override if creator is not the owner of this share
        IF v_target_wallet IS NULL OR v_caller_wallet <> v_target_wallet THEN
            v_is_manual := true;
        END IF;
    END IF;

    IF NOT v_is_authorized THEN
        RAISE EXCEPTION 'Not authorized to mark this share as paid';
    END IF;

    -- Record payment globally (SX-028)
    INSERT INTO public.payments (tx_hash, expense_id, member_id, paid_by_wallet, manual)
    VALUES (p_tx_hash, p_expense_id, p_member_id, v_caller_wallet, v_is_manual);

    -- Set transaction-level GUC to allow trigger to permit share update via RPC (SX-026)
    PERFORM pg_catalog.set_config('settlex.via_rpc', 'on', true);

    -- Transform the specific member share inside the JSONB array
    SELECT 
        pg_catalog.jsonb_agg(
            CASE 
                WHEN elem->>'memberId' = p_member_id THEN 
                    pg_catalog.jsonb_set(
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
                        ),
                        '{manual}',
                        pg_catalog.to_jsonb(v_is_manual)
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
        version = version + 1,
        updated_at = pg_catalog.now()
    WHERE id = p_expense_id
    RETURNING *;
END;
$$;

-- ─── 3. HARDENED VALIDATE_EXPENSE_UPDATE (SX-026 & SX-030) ───────────────────

DROP FUNCTION IF EXISTS public.assert_valid_expense_payload(TEXT, TEXT, TEXT, TEXT, JSONB, JSONB, TEXT, TEXT[]);

CREATE OR REPLACE FUNCTION public.assert_valid_expense_payload(
    p_total_amount TEXT,
    p_currency TEXT,
    p_split_mode TEXT,
    p_paid_by_member_id TEXT,
    p_members JSONB,
    p_shares JSONB,
    p_created_by_wallet TEXT,
    p_member_wallets TEXT[],
    p_allow_paid BOOLEAN DEFAULT false
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
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
    IF v_member_count > 50 THEN
        RAISE EXCEPTION 'An expense supports at most 50 members';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM pg_catalog.jsonb_array_elements(p_members) AS m
        WHERE COALESCE(m->>'id', '') = ''
           OR COALESCE(m->>'name', '') = ''
           OR pg_catalog.char_length(m->>'name') > 50
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

    IF p_allow_paid THEN
        IF EXISTS (
            SELECT 1
            FROM pg_catalog.jsonb_array_elements(p_shares) AS s
            WHERE (COALESCE((s->>'paid')::boolean, false) = true)
              AND (s->>'txHash' IS NULL OR s->>'txHash' !~ '^[0-9a-f]{64}$')
        ) THEN
            RAISE EXCEPTION 'Valid transaction hash is required when marking share as paid';
        END IF;

        IF EXISTS (
            SELECT 1
            FROM pg_catalog.jsonb_array_elements(p_shares) AS s
            WHERE (COALESCE((s->>'paid')::boolean, false) = false)
              AND NULLIF(s->>'txHash', '') IS NOT NULL
        ) THEN
            RAISE EXCEPTION 'Shares must be unique, unpaid, transaction-free, and match non-payer members';
        END IF;
    END IF;

    IF EXISTS (
        SELECT 1
        FROM pg_catalog.jsonb_array_elements(p_shares) AS s
        WHERE COALESCE(s->>'memberId', '') = ''
           OR COALESCE(s->>'name', '') = ''
           OR pg_catalog.char_length(s->>'name') > 50
           OR s->>'memberId' = p_paid_by_member_id
           OR NOT (s ? 'paid')
           OR pg_catalog.jsonb_typeof(s->'paid') <> 'boolean'
           OR (NOT p_allow_paid AND ((s->>'paid')::BOOLEAN OR NULLIF(s->>'txHash', '') IS NOT NULL))
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
        WHERE COALESCE(m->>'weight', '') !~ '^[1-9][0-9]{0,3}$'
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

CREATE OR REPLACE FUNCTION public.validate_expense_update()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
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
    v_has_paid_share BOOLEAN := false;
    v_via_rpc BOOLEAN := false;
BEGIN
    v_caller := public.settlex_wallet();
    
    IF v_caller IS NULL THEN
        IF pg_catalog.current_setting('request.jwt.claims', true) IS NOT NULL AND pg_catalog.current_setting('request.jwt.claims', true) <> '' THEN
            RAISE EXCEPTION 'Unauthorized: invalid or missing wallet session';
        END IF;
        RETURN NEW;
    END IF;

    -- 1. Immutable fields for ALL callers
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
    v_via_rpc := (COALESCE(pg_catalog.current_setting('settlex.via_rpc', true), 'off') = 'on');

    -- Acceptance is an append-only, self-service transition
    IF NEW.accepted_wallets IS DISTINCT FROM OLD.accepted_wallets THEN
        IF (
            v_is_creator
            OR NOT (v_caller = ANY(OLD.member_wallets))
            OR v_caller = ANY(OLD.accepted_wallets)
            OR NOT (OLD.accepted_wallets <@ NEW.accepted_wallets)
            OR pg_catalog.cardinality(NEW.accepted_wallets) <> pg_catalog.cardinality(OLD.accepted_wallets) + 1
            OR NOT (v_caller = ANY(NEW.accepted_wallets))
        ) AND NOT EXISTS (
            SELECT 1 FROM public.trips t
            WHERE NEW.id::TEXT = ANY(t.expense_ids)
              AND (
                  v_caller = t.created_by_wallet
                  OR (v_caller = ANY(t.member_wallets) AND v_caller = ANY(t.accepted_wallets))
              )
        ) THEN
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

    -- Declining / leaving an expense
    IF NEW.declined_wallets IS DISTINCT FROM OLD.declined_wallets THEN
        IF v_is_creator
           OR NOT (v_caller = ANY(OLD.member_wallets))
           OR v_caller = ANY(OLD.declined_wallets)
           OR NOT (OLD.declined_wallets <@ NEW.declined_wallets)
           OR pg_catalog.cardinality(NEW.declined_wallets) <> pg_catalog.cardinality(OLD.declined_wallets) + 1
           OR NOT (v_caller = ANY(NEW.declined_wallets)) THEN
            RAISE EXCEPTION 'A wallet may only decline its own invitation';
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
            RAISE EXCEPTION 'Declining an invitation cannot modify the expense';
        END IF;
        RETURN NEW;
    END IF;

    -- 2. Creator validations (SX-026: No early return)
    IF v_is_creator THEN
        IF NOT (OLD.created_by_wallet = ANY(NEW.member_wallets)) THEN
            RAISE EXCEPTION 'Creator cannot be removed from member_wallets';
        END IF;

        SELECT EXISTS (
            SELECT 1 FROM pg_catalog.jsonb_array_elements(OLD.shares) AS s
            WHERE COALESCE((s->>'paid')::boolean, false) = true
        ) INTO v_has_paid_share;

        -- Freeze amounts, currency, split_mode, paid_by_member_id, members once any share is paid (SX-026)
        IF v_has_paid_share THEN
            IF NEW.total_amount IS DISTINCT FROM OLD.total_amount
               OR NEW.currency IS DISTINCT FROM OLD.currency
               OR NEW.split_mode IS DISTINCT FROM OLD.split_mode
               OR NEW.paid_by_member_id IS DISTINCT FROM OLD.paid_by_member_id
               OR NEW.members IS DISTINCT FROM OLD.members
               OR NEW.member_wallets IS DISTINCT FROM OLD.member_wallets THEN
                RAISE EXCEPTION 'Cannot modify financial terms or members once shares have been paid';
            END IF;
        END IF;

        -- Creator cannot unmark a paid share (SX-034)
        IF EXISTS (
            SELECT 1
            FROM jsonb_array_elements(OLD.shares) AS os
            JOIN jsonb_array_elements(NEW.shares) AS ns
              ON os->>'memberId' = ns->>'memberId'
            WHERE COALESCE((os->>'paid')::boolean, false) = true
              AND COALESCE((ns->>'paid')::boolean, false) = false
        ) THEN
            RAISE EXCEPTION 'Cannot unmark a paid share';
        END IF;

        -- Creator cannot directly modify shares unless through mark_share_paid RPC (SX-026 & SX-034)
        IF NEW.shares IS DISTINCT FROM OLD.shares AND NOT v_via_rpc THEN
            RAISE EXCEPTION 'Expense creator cannot directly modify shares; use mark_share_paid';
        END IF;

        -- For creator edits, run assert_valid_expense_payload against NEW (allowing already-paid shares to keep paid/txHash) (SX-034)
        PERFORM public.assert_valid_expense_payload(
            NEW.total_amount,
            NEW.currency,
            NEW.split_mode,
            NEW.paid_by_member_id,
            NEW.members,
            NEW.shares,
            NEW.created_by_wallet,
            NEW.member_wallets,
            true
        );
    ELSE
        -- 3. Non-creator member validations (SX-030)
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

        -- Non-creator version check: must be OLD.version + 1 (SX-030)
        IF NEW.version IS DISTINCT FROM OLD.version THEN
            IF NEW.version <> OLD.version + 1 THEN
                RAISE EXCEPTION 'Version must increment by exactly 1';
            END IF;
        END IF;

        -- Non-creators modifying shares: can ONLY mark their own share as paid (SX-030)
        IF NEW.shares IS DISTINCT FROM OLD.shares THEN
            v_old_shares_count := pg_catalog.jsonb_array_length(OLD.shares);
            v_new_shares_count := pg_catalog.jsonb_array_length(NEW.shares);

            IF v_old_shares_count <> v_new_shares_count THEN
                RAISE EXCEPTION 'Cannot add or remove shares';
            END IF;

            FOR v_idx IN 0 .. (v_old_shares_count - 1) LOOP
                v_old_share := OLD.shares->v_idx;
                v_new_share := NEW.shares->v_idx;

                IF v_old_share IS DISTINCT FROM v_new_share THEN
                    v_diff_count := v_diff_count + 1;

                    IF COALESCE(v_old_share->>'walletAddress', '') <> v_caller THEN
                        IF NOT EXISTS (
                            SELECT 1 FROM pg_catalog.jsonb_array_elements(OLD.members) AS m
                            WHERE m->>'id' = v_old_share->>'memberId'
                              AND m->>'walletAddress' = v_caller
                        ) THEN
                            RAISE EXCEPTION 'Cannot modify shares belonging to other members';
                        END IF;
                    END IF;

                    -- Frozen fields within the share (SX-030)
                    IF (v_old_share->>'memberId') IS DISTINCT FROM (v_new_share->>'memberId') OR
                       (v_old_share->>'walletAddress') IS DISTINCT FROM (v_new_share->>'walletAddress') OR
                       (v_old_share->>'name') IS DISTINCT FROM (v_new_share->>'name') OR
                       (v_old_share->>'amount') IS DISTINCT FROM (v_new_share->>'amount') OR
                       (v_old_share->>'currency') IS DISTINCT FROM (v_new_share->>'currency') OR
                       (v_old_share->>'shareType') IS DISTINCT FROM (v_new_share->>'shareType') OR
                       (v_old_share->>'weight') IS DISTINCT FROM (v_new_share->>'weight') OR
                       (v_old_share->>'percentage') IS DISTINCT FROM (v_new_share->>'percentage') THEN
                        RAISE EXCEPTION 'Cannot modify share attributes or allocation';
                    END IF;

                    -- PaidBy check: cannot forge paidBy (SX-030)
                    IF (v_new_share->>'paidBy') IS NOT NULL AND (v_new_share->>'paidBy') <> v_caller THEN
                        RAISE EXCEPTION 'Cannot forge paidBy address';
                    END IF;

                    IF COALESCE((v_old_share->>'paid')::boolean, false) = true AND
                       COALESCE((v_new_share->>'paid')::boolean, false) = false THEN
                        RAISE EXCEPTION 'Cannot unmark a paid share';
                    END IF;

                    IF COALESCE((v_new_share->>'paid')::boolean, false) = true THEN
                        IF v_new_share->>'txHash' IS NULL OR NOT (v_new_share->>'txHash' ~ '^[0-9a-f]{64}$') THEN
                            RAISE EXCEPTION 'Valid transaction hash is required when marking share as paid';
                        END IF;
                        IF EXISTS (
                            SELECT 1 FROM public.payments WHERE tx_hash = v_new_share->>'txHash'
                        ) THEN
                            RAISE EXCEPTION 'Transaction hash already used on another payment';
                        END IF;
                        IF EXISTS (
                            SELECT 1 FROM pg_catalog.jsonb_array_elements(NEW.shares) AS s
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
    END IF;

    -- Validate settled consistency for ALL callers (SX-026)
    IF NEW.settled IS DISTINCT FROM OLD.settled THEN
        FOR v_share_elem IN SELECT * FROM pg_catalog.jsonb_array_elements(NEW.shares) LOOP
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

DROP TRIGGER IF EXISTS validate_expenses_update ON public.expenses;
CREATE TRIGGER validate_expenses_update
BEFORE UPDATE ON public.expenses
FOR EACH ROW
EXECUTE FUNCTION public.validate_expense_update();

-- ─── 4. HARDENED VALIDATE_TRIP_UPDATE (SX-027 & SX-029) ──────────────────────

CREATE OR REPLACE FUNCTION public.validate_trip_update()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_caller TEXT;
    v_is_creator BOOLEAN;
    v_unsettled_count INTEGER;
    v_expected_wallets TEXT[];
BEGIN
    v_caller := public.settlex_wallet();

    IF v_caller IS NULL THEN
        IF pg_catalog.current_setting('request.jwt.claims', true) IS NOT NULL AND pg_catalog.current_setting('request.jwt.claims', true) <> '' THEN
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

    -- Acceptance is an append-only, self-service transition
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

    -- Declining / leaving a trip
    IF NEW.declined_wallets IS DISTINCT FROM OLD.declined_wallets THEN
        IF v_is_creator
           OR NOT (v_caller = ANY(OLD.member_wallets))
           OR v_caller = ANY(OLD.declined_wallets)
           OR NOT (OLD.declined_wallets <@ NEW.declined_wallets)
           OR pg_catalog.cardinality(NEW.declined_wallets) <> pg_catalog.cardinality(OLD.declined_wallets) + 1
           OR NOT (v_caller = ANY(NEW.declined_wallets)) THEN
            RAISE EXCEPTION 'A wallet may only decline or leave its own trip invitation';
        END IF;

        IF NEW.name IS DISTINCT FROM OLD.name
           OR NEW.description IS DISTINCT FROM OLD.description
           OR NEW.members IS DISTINCT FROM OLD.members
           OR NEW.expense_ids IS DISTINCT FROM OLD.expense_ids
           OR NEW.created_at IS DISTINCT FROM OLD.created_at
           OR NEW.settled IS DISTINCT FROM OLD.settled
           OR NEW.created_by_wallet IS DISTINCT FROM OLD.created_by_wallet
           OR NEW.member_wallets IS DISTINCT FROM OLD.member_wallets THEN
            RAISE EXCEPTION 'Declining an invitation cannot modify the trip';
        END IF;
        RETURN NEW;
    END IF;

    -- 2. Creator validations (SX-027: No early return)
    IF v_is_creator THEN
        IF NOT (OLD.created_by_wallet = ANY(NEW.member_wallets)) THEN
            RAISE EXCEPTION 'Creator cannot be removed from member_wallets';
        END IF;

        IF NEW.members IS DISTINCT FROM OLD.members OR NEW.member_wallets IS DISTINCT FROM OLD.member_wallets THEN
            IF pg_catalog.jsonb_typeof(NEW.members) <> 'array'
               OR pg_catalog.jsonb_array_length(NEW.members) < 2 THEN
                RAISE EXCEPTION 'A trip requires at least two members';
            END IF;
            IF pg_catalog.jsonb_array_length(NEW.members) > 50 THEN
                RAISE EXCEPTION 'A trip supports at most 50 members';
            END IF;
            IF EXISTS (
                SELECT 1
                FROM pg_catalog.jsonb_array_elements(NEW.members) AS m
                WHERE COALESCE(m->>'id', '') = ''
                   OR COALESCE(m->>'name', '') = ''
                   OR pg_catalog.char_length(m->>'name') > 50
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
                WHERE m->>'walletAddress' = OLD.created_by_wallet
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
        END IF;
    ELSE
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
    END IF;

    -- Check expense_ids modifications for ALL callers (SX-027 & SX-029)
    IF NEW.expense_ids IS DISTINCT FROM OLD.expense_ids THEN
        IF OLD.settled = true THEN
            RAISE EXCEPTION 'Cannot add expenses to a settled trip';
        END IF;

        IF NOT (OLD.expense_ids <@ NEW.expense_ids) THEN
            RAISE EXCEPTION 'Cannot remove existing expenses from trip';
        END IF;

        -- Must be valid UUID format (SX-029)
        IF EXISTS (
            SELECT 1 FROM pg_catalog.unnest(NEW.expense_ids) AS eid
            WHERE eid !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        ) THEN
            RAISE EXCEPTION 'Invalid expense ID in trip: must be a valid UUID';
        END IF;

        -- Newly appended expense ids must exist, caller must belong to them, and all expense members must be trip members (SX-029)
        IF EXISTS (
            SELECT 1 FROM pg_catalog.unnest(NEW.expense_ids) AS eid
            WHERE NOT (eid = ANY(OLD.expense_ids))
              AND NOT EXISTS (
                  SELECT 1 FROM public.expenses e
                  WHERE e.id::TEXT = eid
                    AND (
                        v_caller = e.created_by_wallet
                        OR (v_caller = ANY(e.member_wallets) AND v_caller = ANY(e.accepted_wallets))
                    )
                    AND e.member_wallets <@ NEW.member_wallets
              )
        ) THEN
            RAISE EXCEPTION 'Cannot link foreign expense or expense caller does not belong to';
        END IF;

        -- Keep trip_expenses join table in sync (SX-029)
        INSERT INTO public.trip_expenses (trip_id, expense_id, added_by_wallet)
        SELECT NEW.id, eid::UUID, v_caller
        FROM pg_catalog.unnest(NEW.expense_ids) AS eid
        WHERE NOT (eid = ANY(OLD.expense_ids))
        ON CONFLICT (trip_id, expense_id) DO NOTHING;
    END IF;

    -- Settled status transition check for ALL callers (SX-027 & SX-029)
    IF NEW.settled IS DISTINCT FROM OLD.settled THEN
        IF OLD.settled = true AND NEW.settled = false THEN
            RAISE EXCEPTION 'Cannot reopen a settled trip';
        END IF;

        IF NEW.settled = true THEN
            IF NEW.expense_ids IS DISTINCT FROM OLD.expense_ids THEN
                RAISE EXCEPTION 'Cannot modify expenses while settling trip';
            END IF;

            IF EXISTS (
                SELECT 1 FROM pg_catalog.unnest(NEW.expense_ids) AS eid
                WHERE eid !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
            ) THEN
                RAISE EXCEPTION 'Invalid expense ID in trip: must be a valid UUID';
            END IF;

            IF pg_catalog.cardinality(NEW.expense_ids) > 0 THEN
                SELECT pg_catalog.count(*)
                INTO v_unsettled_count
                FROM public.expenses e
                WHERE e.id::TEXT = ANY(NEW.expense_ids)
                  AND e.settled = false;

                IF v_unsettled_count > 0 THEN
                    RAISE EXCEPTION 'Cannot settle trip while linked expenses remain unsettled';
                END IF;
            END IF;
        END IF;
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS validate_trips_update ON public.trips;
CREATE TRIGGER validate_trips_update
BEFORE UPDATE ON public.trips
FOR EACH ROW
EXECUTE FUNCTION public.validate_trip_update();

-- ─── 5. USER PROFILE RESOLUTION & AUTH RPCS ──────────────────────────────────

CREATE OR REPLACE FUNCTION public.resolve_user_profile(p_wallet_address TEXT)
RETURNS TABLE (
    wallet_address TEXT,
    display_name TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
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

    IF p_wallet_address IS NULL OR pg_catalog.trim(p_wallet_address) = '' THEN
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
              WHERE (v_caller_wallet = ANY(e.member_wallets) AND v_caller_wallet = ANY(e.accepted_wallets))
                AND (u.wallet_address = ANY(e.member_wallets) AND u.wallet_address = ANY(e.accepted_wallets))
          )
          OR EXISTS (
              SELECT 1
              FROM public.trips t
              WHERE (v_caller_wallet = ANY(t.member_wallets) AND v_caller_wallet = ANY(t.accepted_wallets))
                AND (u.wallet_address = ANY(t.member_wallets) AND u.wallet_address = ANY(t.accepted_wallets))
          )
      )
    LIMIT 1;
END;
$$;

CREATE OR REPLACE FUNCTION public.auth_rate_limit(
    p_key TEXT,
    p_max_requests INTEGER,
    p_window_ms INTEGER
)
RETURNS TABLE (
    allowed BOOLEAN,
    remaining INTEGER,
    retry_after INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_now TIMESTAMPTZ := pg_catalog.now();
    v_window INTERVAL := (p_window_ms || ' milliseconds')::INTERVAL;
    v_bucket_start TIMESTAMPTZ;
    v_count INTEGER;
BEGIN
    SELECT bucket_start, count INTO v_bucket_start, v_count
    FROM public.auth_rate_limits
    WHERE key = p_key
    FOR UPDATE;

    IF NOT FOUND OR v_now >= v_bucket_start + v_window THEN
        INSERT INTO public.auth_rate_limits (key, bucket_start, count)
        VALUES (p_key, v_now, 1)
        ON CONFLICT (key) DO UPDATE
            SET bucket_start = v_now, count = 1;

        allowed := true;
        remaining := p_max_requests - 1;
        retry_after := 0;
        RETURN NEXT;
        RETURN;
    END IF;

    IF v_count < p_max_requests THEN
        UPDATE public.auth_rate_limits
        SET count = count + 1
        WHERE key = p_key;

        allowed := true;
        remaining := p_max_requests - (v_count + 1);
        retry_after := 0;
        RETURN NEXT;
        RETURN;
    END IF;

    allowed := false;
    remaining := 0;
    retry_after := pg_catalog.ceil(pg_catalog.extract(epoch from (v_bucket_start + v_window - v_now)))::INTEGER;
    RETURN NEXT;
    RETURN;
END;
$$;

GRANT EXECUTE ON FUNCTION public.mark_share_paid(UUID, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_user_profile(TEXT) TO authenticated;

-- ─── 6. HARDENED ADD_EXPENSE_TO_TRIP (SX-029) ────────────────────────────────

CREATE OR REPLACE FUNCTION public.add_expense_to_trip(
    p_trip_id UUID,
    p_expense_id UUID
)
RETURNS SETOF public.trips
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_caller TEXT;
    v_trip public.trips%ROWTYPE;
    v_expense public.expenses%ROWTYPE;
BEGIN
    v_caller := public.settlex_wallet();
    IF v_caller IS NULL THEN
        RAISE EXCEPTION 'Not authenticated';
    END IF;

    -- Lock trip row for update
    SELECT * INTO v_trip
    FROM public.trips
    WHERE id = p_trip_id
    FOR UPDATE;

    IF v_trip.id IS NULL THEN
        RAISE EXCEPTION 'Trip not found';
    END IF;

    IF v_trip.settled THEN
        RAISE EXCEPTION 'Cannot add expenses to a settled trip';
    END IF;

    -- Caller must be trip creator or accepted trip member
    IF v_caller <> v_trip.created_by_wallet
       AND NOT (v_caller = ANY(v_trip.member_wallets) AND v_caller = ANY(v_trip.accepted_wallets)) THEN
        RAISE EXCEPTION 'Not authorized to add expenses to this trip';
    END IF;

    -- Fetch and validate the expense
    SELECT * INTO v_expense
    FROM public.expenses
    WHERE id = p_expense_id;

    IF v_expense.id IS NULL THEN
        RAISE EXCEPTION 'Expense not found';
    END IF;

    -- Caller must be expense creator or accepted expense member
    IF v_caller <> v_expense.created_by_wallet
       AND NOT (v_caller = ANY(v_expense.member_wallets) AND v_caller = ANY(v_expense.accepted_wallets)) THEN
        RAISE EXCEPTION 'Cannot link foreign expense or expense caller does not belong to';
    END IF;

    -- All expense members must be members of the trip
    IF NOT (v_expense.member_wallets <@ v_trip.member_wallets) THEN
        RAISE EXCEPTION 'Cannot link foreign expense or expense caller does not belong to';
    END IF;

    -- Record in trip_expenses join table
    INSERT INTO public.trip_expenses (trip_id, expense_id, added_by_wallet)
    VALUES (p_trip_id, p_expense_id, v_caller)
    ON CONFLICT (trip_id, expense_id) DO NOTHING;

    -- Append to trip expense_ids if not already present
    IF NOT (p_expense_id::TEXT = ANY(v_trip.expense_ids)) THEN
        RETURN QUERY
        UPDATE public.trips
        SET expense_ids = pg_catalog.array_append(expense_ids, p_expense_id::TEXT),
            updated_at = pg_catalog.now()
        WHERE id = p_trip_id
        RETURNING *;
    ELSE
        RETURN QUERY
        SELECT * FROM public.trips WHERE id = p_trip_id;
    END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.add_expense_to_trip(UUID, UUID) TO authenticated;
