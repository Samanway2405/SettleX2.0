-- ============================================================================
-- SettleX Migration: 20261016000000_invitation_model.sql
-- Invitation Model: decline_invitation, leave_trip, context in pending invites,
-- and trip-linked expenses visibility and auto-sync (Issue #192)
-- ============================================================================

-- ─── 1. COLUMNS & INDEXES ────────────────────────────────────────────────────

ALTER TABLE public.expenses
    ADD COLUMN IF NOT EXISTS declined_wallets TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

ALTER TABLE public.trips
    ADD COLUMN IF NOT EXISTS declined_wallets TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

CREATE INDEX IF NOT EXISTS idx_expenses_declined_wallets ON public.expenses USING GIN(declined_wallets);
CREATE INDEX IF NOT EXISTS idx_trips_declined_wallets ON public.trips USING GIN(declined_wallets);

-- ─── 2. FUNCTIONS & RPCS ─────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.decline_invitation(
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
BEGIN
    v_caller := public.settlex_wallet();
    IF v_caller IS NULL THEN
        RAISE EXCEPTION 'Not authenticated';
    END IF;

    IF p_entity_type = 'expense' THEN
        UPDATE public.expenses
        SET declined_wallets = pg_catalog.array_append(declined_wallets, v_caller)
        WHERE id = p_entity_id
          AND v_caller = ANY(member_wallets)
          AND NOT (v_caller = ANY(accepted_wallets))
          AND NOT (v_caller = ANY(declined_wallets))
          AND v_caller <> created_by_wallet;

        IF NOT FOUND THEN
            RAISE EXCEPTION 'Pending expense invitation not found or already processed';
        END IF;

    ELSIF p_entity_type = 'trip' THEN
        UPDATE public.trips
        SET declined_wallets = pg_catalog.array_append(declined_wallets, v_caller)
        WHERE id = p_entity_id
          AND v_caller = ANY(member_wallets)
          AND NOT (v_caller = ANY(accepted_wallets))
          AND NOT (v_caller = ANY(declined_wallets))
          AND v_caller <> created_by_wallet;

        IF NOT FOUND THEN
            RAISE EXCEPTION 'Pending trip invitation not found or already processed';
        END IF;
    ELSE
        RAISE EXCEPTION 'Invalid entity type: must be expense or trip';
    END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.leave_trip(
    p_trip_id UUID
)
RETURNS VOID
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

    UPDATE public.trips
    SET declined_wallets = pg_catalog.array_append(declined_wallets, v_caller)
    WHERE id = p_trip_id
      AND v_caller = ANY(member_wallets)
      AND NOT (v_caller = ANY(declined_wallets))
      AND v_caller <> created_by_wallet;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Trip not found or creator cannot leave';
    END IF;
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
          AND NOT (v_caller = ANY(accepted_wallets));

        IF NOT FOUND THEN
            RAISE EXCEPTION 'Pending expense invitation not found';
        END IF;

    ELSIF p_entity_type = 'trip' THEN
        UPDATE public.trips
        SET accepted_wallets = pg_catalog.array_append(accepted_wallets, v_caller)
        WHERE id = p_entity_id
          AND v_caller = ANY(member_wallets)
          AND NOT (v_caller = ANY(accepted_wallets));

        IF NOT FOUND THEN
            RAISE EXCEPTION 'Pending trip invitation not found';
        END IF;
    ELSE
        RAISE EXCEPTION 'Invalid entity type: must be expense or trip';
    END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_pending_invitations()
RETURNS TABLE (
    entity_type TEXT,
    entity_id UUID,
    title TEXT,
    created_by_wallet TEXT,
    created_at TIMESTAMPTZ,
    total_amount TEXT,
    caller_share TEXT
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
        e.created_at,
        e.total_amount,
        COALESCE(
            (
                SELECT s->>'amount'
                FROM pg_catalog.jsonb_array_elements(e.shares) AS s
                WHERE s->>'walletAddress' = v_caller
                   OR s->>'memberId' IN (
                       SELECT m->>'id'
                       FROM pg_catalog.jsonb_array_elements(e.members) AS m
                       WHERE m->>'walletAddress' = v_caller
                   )
                LIMIT 1
            ),
            '0'
        ) AS caller_share
    FROM public.expenses AS e
    WHERE v_caller = ANY(e.member_wallets)
      AND NOT (v_caller = ANY(e.accepted_wallets))
      AND NOT (v_caller = ANY(e.declined_wallets))
      AND v_caller <> e.created_by_wallet
      AND NOT EXISTS (
          SELECT 1 FROM public.trips t
          WHERE e.id::TEXT = ANY(t.expense_ids)
            AND (
                v_caller = t.created_by_wallet
                OR v_caller = ANY(t.member_wallets)
            )
      )
    UNION ALL
    SELECT
        'trip'::TEXT,
        t.id,
        t.name,
        t.created_by_wallet,
        t.created_at,
        COALESCE(
            (
                SELECT COALESCE(pg_catalog.sum((exp.total_amount)::numeric), 0)::TEXT
                FROM public.expenses exp
                WHERE exp.id::TEXT = ANY(t.expense_ids)
            ),
            '0'
        ) AS total_amount,
        COALESCE(
            (
                SELECT COALESCE(
                    pg_catalog.sum(
                        (
                            COALESCE(
                                (
                                    SELECT s->>'amount'
                                    FROM pg_catalog.jsonb_array_elements(exp.shares) AS s
                                    WHERE s->>'walletAddress' = v_caller
                                       OR s->>'memberId' IN (
                                           SELECT m->>'id'
                                           FROM pg_catalog.jsonb_array_elements(exp.members) AS m
                                           WHERE m->>'walletAddress' = v_caller
                                       )
                                    LIMIT 1
                                ),
                                '0'
                            )
                        )::numeric
                    ),
                    0
                )::TEXT
                FROM public.expenses exp
                WHERE exp.id::TEXT = ANY(t.expense_ids)
            ),
            '0'
        ) AS caller_share
    FROM public.trips AS t
    WHERE v_caller = ANY(t.member_wallets)
      AND NOT (v_caller = ANY(t.accepted_wallets))
      AND NOT (v_caller = ANY(t.declined_wallets))
      AND v_caller <> t.created_by_wallet;
END;
$$;

CREATE OR REPLACE FUNCTION public.sync_trip_expenses_accepted_wallets()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    IF pg_catalog.cardinality(NEW.expense_ids) > 0 AND pg_catalog.cardinality(NEW.accepted_wallets) > 0 THEN
        UPDATE public.expenses
        SET accepted_wallets = (
            SELECT pg_catalog.array_agg(DISTINCT w)
            FROM pg_catalog.unnest(pg_catalog.array_cat(expenses.accepted_wallets, NEW.accepted_wallets)) AS w
            WHERE w = ANY(expenses.member_wallets)
        )
        WHERE id::TEXT = ANY(NEW.expense_ids);
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS sync_trip_expenses_accepted_wallets ON public.trips;
CREATE TRIGGER sync_trip_expenses_accepted_wallets
AFTER INSERT OR UPDATE OF expense_ids, accepted_wallets ON public.trips
FOR EACH ROW
EXECUTE FUNCTION public.sync_trip_expenses_accepted_wallets();

-- ─── 3. POLICY UPDATES (TRIP LINKED VISIBILITY) ──────────────────────────────

DROP POLICY IF EXISTS "Members can view their expenses" ON public.expenses;
CREATE POLICY "Members can view their expenses" ON public.expenses
    FOR SELECT
    USING (
        public.settlex_wallet() = created_by_wallet
        OR (public.settlex_wallet() = ANY(member_wallets) AND public.settlex_wallet() = ANY(accepted_wallets))
        OR EXISTS (
            SELECT 1 FROM public.trips t
            WHERE expenses.id::TEXT = ANY(t.expense_ids)
              AND (
                  public.settlex_wallet() = t.created_by_wallet
                  OR (
                      public.settlex_wallet() = ANY(t.member_wallets)
                      AND public.settlex_wallet() = ANY(t.accepted_wallets)
                  )
              )
        )
    );

GRANT EXECUTE ON FUNCTION public.decline_invitation(TEXT, UUID) TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.leave_trip(UUID) TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.accept_invitation(TEXT, UUID) TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.get_pending_invitations() TO authenticated, anon;
