-- ============================================================================
-- SettleX Migration: 20261016120000_length_limits.sql
-- Text length limits and member array size bounds (Issue #191 / SX-031)
-- ============================================================================

DO $$
BEGIN
    -- users table constraints
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = 'public.users'::regclass AND contype = 'c' AND conname = 'users_display_name_check'
    ) THEN
        ALTER TABLE public.users ADD CONSTRAINT users_display_name_check
            CHECK (char_length(display_name) BETWEEN 1 AND 50);
    END IF;

    -- expenses table constraints
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = 'public.expenses'::regclass AND contype = 'c' AND conname = 'expenses_title_check'
    ) THEN
        ALTER TABLE public.expenses ADD CONSTRAINT expenses_title_check
            CHECK (char_length(title) BETWEEN 1 AND 120);
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = 'public.expenses'::regclass AND contype = 'c' AND conname = 'expenses_description_check'
    ) THEN
        ALTER TABLE public.expenses ADD CONSTRAINT expenses_description_check
            CHECK (description IS NULL OR char_length(description) <= 100);
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = 'public.expenses'::regclass AND contype = 'c' AND conname = 'expenses_members_check'
    ) THEN
        ALTER TABLE public.expenses ADD CONSTRAINT expenses_members_check
            CHECK (jsonb_typeof(members) = 'array' AND jsonb_array_length(members) <= 50);
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = 'public.expenses'::regclass AND contype = 'c' AND conname = 'expenses_shares_check'
    ) THEN
        ALTER TABLE public.expenses ADD CONSTRAINT expenses_shares_check
            CHECK (jsonb_typeof(shares) = 'array' AND jsonb_array_length(shares) <= 50);
    END IF;

    -- trips table constraints
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = 'public.trips'::regclass AND contype = 'c' AND conname = 'trips_name_check'
    ) THEN
        ALTER TABLE public.trips ADD CONSTRAINT trips_name_check
            CHECK (char_length(name) BETWEEN 1 AND 120);
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = 'public.trips'::regclass AND contype = 'c' AND conname = 'trips_description_check'
    ) THEN
        ALTER TABLE public.trips ADD CONSTRAINT trips_description_check
            CHECK (description IS NULL OR char_length(description) <= 100);
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = 'public.trips'::regclass AND contype = 'c' AND conname = 'trips_members_check'
    ) THEN
        ALTER TABLE public.trips ADD CONSTRAINT trips_members_check
            CHECK (jsonb_typeof(members) = 'array' AND jsonb_array_length(members) <= 50);
    END IF;
END $$;
