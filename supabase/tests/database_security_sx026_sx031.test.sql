-- ============================================================================
-- SettleX Database Security pgTAP Test Suite
-- Tests all RLS and Trigger rules for SX-026 to SX-031 (Issue #194)
-- Run via Supabase CLI: supabase test db
-- ============================================================================

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap;

SELECT plan(19);

-- ─── SX-031: Length and Size Constraints ─────────────────────────────────────

SELECT throws_ok(
    $$ INSERT INTO public.users (wallet_address, display_name) VALUES ('GALICE11111111111111111111111111111111111111111111111111111', repeat('a', 51)) $$,
    '23514',
    NULL,
    'SX-031: users_display_name_check rejects display_name > 50 chars'
);

SELECT throws_ok(
    $$ INSERT INTO public.expenses (title, total_amount, currency, split_mode, paid_by_member_id, members, shares, created_by_wallet)
       VALUES (repeat('t', 121), '100', 'XLM', 'equal', 'm1', '[]'::jsonb, '[]'::jsonb, 'GALICE11111111111111111111111111111111111111111111111111111') $$,
    '23514',
    NULL,
    'SX-031: expenses_title_check rejects title > 120 chars'
);

SELECT throws_ok(
    $$ INSERT INTO public.trips (name, members, created_by_wallet)
       VALUES (repeat('t', 121), '[]'::jsonb, 'GALICE11111111111111111111111111111111111111111111111111111') $$,
    '23514',
    NULL,
    'SX-031: trips_name_check rejects trip name > 120 chars'
);

-- ─── SETUP TEST DATA ──────────────────────────────────────────────────────────

INSERT INTO public.users (wallet_address, display_name)
VALUES
    ('GALICE11111111111111111111111111111111111111111111111111111', 'Alice'),
    ('GBOB22222222222222222222222222222222222222222222222222222222', 'Bob'),
    ('GCHARLIE3333333333333333333333333333333333333333333333333333', 'Charlie');

SELECT set_config('request.jwt.claims', '{"wallet_address": "GALICE11111111111111111111111111111111111111111111111111111", "iat": 1700000000}', true);

INSERT INTO public.expenses (
    id, title, total_amount, currency, split_mode, paid_by_member_id,
    members, shares, created_by_wallet, member_wallets, accepted_wallets
) VALUES (
    'e0000000-0000-0000-0000-000000000001',
    'Dinner',
    '100',
    'XLM',
    'equal',
    'm-alice',
    '[{"id":"m-alice","name":"Alice","walletAddress":"GALICE11111111111111111111111111111111111111111111111111111"},
      {"id":"m-bob","name":"Bob","walletAddress":"GBOB22222222222222222222222222222222222222222222222222222222"}]'::jsonb,
    '[{"memberId":"m-bob","name":"Bob","walletAddress":"GBOB22222222222222222222222222222222222222222222222222222222","amount":"50","currency":"XLM","shareType":"equal","weight":1,"percentage":"50","paid":false,"txHash":null}]'::jsonb,
    'GALICE11111111111111111111111111111111111111111111111111111',
    ARRAY['GALICE11111111111111111111111111111111111111111111111111111', 'GBOB22222222222222222222222222222222222222222222222222222222'],
    ARRAY['GALICE11111111111111111111111111111111111111111111111111111']
);

SELECT set_config('request.jwt.claims', '{"wallet_address": "GBOB22222222222222222222222222222222222222222222222222222222", "iat": 1700000000}', true);
SELECT public.accept_invitation('expense', 'e0000000-0000-0000-0000-000000000001');

-- ─── SX-026: Expense Creator Bypass Tests ────────────────────────────────────

SELECT set_config('request.jwt.claims', '{"wallet_address": "GALICE11111111111111111111111111111111111111111111111111111", "iat": 1700000000}', true);

SELECT throws_ok(
    $$ UPDATE public.expenses
       SET shares = '[{"memberId":"m-bob","name":"Bob","walletAddress":"GBOB22222222222222222222222222222222222222222222222222222222","amount":"50","currency":"XLM","shareType":"equal","weight":1,"percentage":"50","paid":true,"txHash":"fake"}]'::jsonb
       WHERE id = 'e0000000-0000-0000-0000-000000000001' $$,
    'Expense creator cannot directly modify shares; use mark_share_paid',
    'SX-026: Creator cannot directly modify shares via UPDATE'
);

SELECT throws_ok(
    $$ UPDATE public.expenses
       SET settled = true
       WHERE id = 'e0000000-0000-0000-0000-000000000001' $$,
    'Cannot mark expense as settled while unpaid shares remain',
    'SX-026: Cannot mark expense as settled while unpaid shares remain'
);

-- ─── SX-028: mark_share_paid Tests ──────────────────────────────────────────

SELECT set_config('request.jwt.claims', '{"wallet_address": "GBOB22222222222222222222222222222222222222222222222222222222", "iat": 1700000000}', true);

SELECT lives_ok(
    $$ SELECT public.mark_share_paid(
           'e0000000-0000-0000-0000-000000000001'::uuid,
           'm-bob',
           'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
       ) $$,
    'SX-028: Valid mark_share_paid succeeds'
);

SELECT throws_ok(
    $$ SELECT public.mark_share_paid(
           'e0000000-0000-0000-0000-000000000001'::uuid,
           'm-bob',
           'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
       ) $$,
    'Share is already marked as paid',
    'SX-028: Cannot re-mark an already paid share'
);

-- Create second expense to test global duplicate transaction hash reuse
SELECT set_config('request.jwt.claims', '{"wallet_address": "GALICE11111111111111111111111111111111111111111111111111111", "iat": 1700000000}', true);

INSERT INTO public.expenses (
    id, title, total_amount, currency, split_mode, paid_by_member_id,
    members, shares, created_by_wallet, member_wallets, accepted_wallets
) VALUES (
    'e0000000-0000-0000-0000-000000000002',
    'Lunch',
    '60',
    'XLM',
    'equal',
    'm-alice2',
    '[{"id":"m-alice2","name":"Alice","walletAddress":"GALICE11111111111111111111111111111111111111111111111111111"},
      {"id":"m-charlie","name":"Charlie","walletAddress":"GCHARLIE3333333333333333333333333333333333333333333333333333"}]'::jsonb,
    '[{"memberId":"m-charlie","name":"Charlie","walletAddress":"GCHARLIE3333333333333333333333333333333333333333333333333333","amount":"30","currency":"XLM","shareType":"equal","weight":1,"percentage":"50","paid":false,"txHash":null}]'::jsonb,
    'GALICE11111111111111111111111111111111111111111111111111111',
    ARRAY['GALICE11111111111111111111111111111111111111111111111111111', 'GCHARLIE3333333333333333333333333333333333333333333333333333'],
    ARRAY['GALICE11111111111111111111111111111111111111111111111111111']
);

SELECT set_config('request.jwt.claims', '{"wallet_address": "GCHARLIE3333333333333333333333333333333333333333333333333333", "iat": 1700000000}', true);
SELECT public.accept_invitation('expense', 'e0000000-0000-0000-0000-000000000002');

SELECT throws_ok(
    $$ SELECT public.mark_share_paid(
           'e0000000-0000-0000-0000-000000000002'::uuid,
           'm-charlie',
           'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
       ) $$,
    'Transaction hash already used on another payment',
    'SX-028: Global duplicate transaction hash reuse is rejected'
);

-- Creator manual override marks share paid and flags it with manual: true (SX-028)
SELECT set_config('request.jwt.claims', '{"wallet_address": "GALICE11111111111111111111111111111111111111111111111111111", "iat": 1700000000}', true);

SELECT lives_ok(
    $$ SELECT public.mark_share_paid(
           'e0000000-0000-0000-0000-000000000002'::uuid,
           'm-charlie',
           'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc'
       ) $$,
    'SX-028: Creator manual override mark_share_paid succeeds'
);

SELECT results_eq(
    $$ SELECT (shares->0->>'manual')::boolean FROM public.expenses WHERE id = 'e0000000-0000-0000-0000-000000000002' $$,
    $$ VALUES (true) $$,
    'SX-028: Creator override is flagged with manual: true'
);

-- ─── SX-026: Financial Terms Freeze ──────────────────────────────────────────

SELECT set_config('request.jwt.claims', '{"wallet_address": "GALICE11111111111111111111111111111111111111111111111111111", "iat": 1700000000}', true);

SELECT throws_ok(
    $$ UPDATE public.expenses
       SET total_amount = '200'
       WHERE id = 'e0000000-0000-0000-0000-000000000001' $$,
    'Cannot modify financial terms or members once shares have been paid',
    'SX-026: Financial terms frozen once shares are paid'
);

SELECT throws_ok(
    $$ UPDATE public.expenses
       SET settled = false
       WHERE id = 'e0000000-0000-0000-0000-000000000001' $$,
    'Cannot reopen a settled expense',
    'SX-026: Cannot reopen settled expense'
);

-- ─── SX-027: Trip Creator Bypass Tests ───────────────────────────────────────

INSERT INTO public.trips (
    id, name, members, expense_ids, created_by_wallet, member_wallets, accepted_wallets
) VALUES (
    't0000000-0000-0000-0000-000000000001',
    'Weekend Trip',
    '[{"id":"m-alice","name":"Alice","walletAddress":"GALICE11111111111111111111111111111111111111111111111111111"},
      {"id":"m-bob","name":"Bob","walletAddress":"GBOB22222222222222222222222222222222222222222222222222222222"}]'::jsonb,
    ARRAY['e0000000-0000-0000-0000-000000000001'],
    'GALICE11111111111111111111111111111111111111111111111111111',
    ARRAY['GALICE11111111111111111111111111111111111111111111111111111', 'GBOB22222222222222222222222222222222222222222222222222222222'],
    ARRAY['GALICE11111111111111111111111111111111111111111111111111111']
);

SELECT throws_ok(
    $$ UPDATE public.trips
       SET expense_ids = ARRAY[]::TEXT[]
       WHERE id = 't0000000-0000-0000-0000-000000000001' $$,
    'Cannot remove existing expenses from trip',
    'SX-027: Trip creator cannot remove existing expenses'
);

SELECT throws_ok(
    $$ UPDATE public.trips
       SET expense_ids = ARRAY['e0000000-0000-0000-0000-000000000001', 'e0000000-0000-0000-0000-000000000002'],
           settled = true
       WHERE id = 't0000000-0000-0000-0000-000000000001' $$,
    'Cannot settle trip while linked expenses remain unsettled',
    'SX-027: Cannot settle trip while linked expenses are unsettled'
);

SELECT lives_ok(
    $$ UPDATE public.trips
       SET settled = true
       WHERE id = 't0000000-0000-0000-0000-000000000001' $$,
    'SX-027: Valid trip settlement succeeds when all linked expenses are settled'
);

SELECT throws_ok(
    $$ UPDATE public.trips
       SET settled = false
       WHERE id = 't0000000-0000-0000-0000-000000000001' $$,
    'Cannot reopen a settled trip',
    'SX-027: Trip creator cannot reopen a settled trip'
);

SELECT throws_ok(
    $$ UPDATE public.trips
       SET members = '[{"id":"m-alice","name":"Alice","walletAddress":"GALICE11111111111111111111111111111111111111111111111111111"},
                       {"id":"m-charlie","name":"Charlie","walletAddress":"GCHARLIE3333333333333333333333333333333333333333333333333333"}]'::jsonb
       WHERE id = 't0000000-0000-0000-0000-000000000001' $$,
    'member_wallets must exactly match trip members',
    'SX-027: Trip creator cannot desync members and member_wallets'
);

SELECT throws_ok(
    $$ UPDATE public.trips
       SET members = '[{"id":"m-bob","name":"Bob","walletAddress":"GBOB22222222222222222222222222222222222222222222222222222222"},
                       {"id":"m-charlie","name":"Charlie","walletAddress":"GCHARLIE3333333333333333333333333333333333333333333333333333"}]'::jsonb,
           member_wallets = ARRAY['GBOB22222222222222222222222222222222222222222222222222222222', 'GCHARLIE3333333333333333333333333333333333333333333333333333']
       WHERE id = 't0000000-0000-0000-0000-000000000001' $$,
    'Creator cannot be removed from member_wallets',
    'SX-027: Trip creator cannot remove themselves from trip'
);

-- ─── SX-029: Trip expense_ids Injection Tests ────────────────────────────────

SELECT set_config('request.jwt.claims', '{"wallet_address": "GBOB22222222222222222222222222222222222222222222222222222222", "iat": 1700000000}', true);
SELECT public.accept_invitation('trip', 't0000000-0000-0000-0000-000000000001');

SELECT throws_ok(
    $$ UPDATE public.trips
       SET expense_ids = ARRAY['e0000000-0000-0000-0000-000000000001', 'not-a-uuid']
       WHERE id = 't0000000-0000-0000-0000-000000000001' $$,
    'Invalid expense ID in trip: must be a valid UUID',
    'SX-029: Non-UUID expense_ids rejected'
);

SELECT throws_ok(
    $$ UPDATE public.trips
       SET expense_ids = ARRAY['e0000000-0000-0000-0000-000000000001', 'e0000000-0000-0000-0000-000000000002']
       WHERE id = 't0000000-0000-0000-0000-000000000001' $$,
    'Cannot link foreign expense or expense caller does not belong to',
    'SX-029: Foreign expense injection rejected'
);

SELECT throws_ok(
    $$ SELECT public.add_expense_to_trip(
           't0000000-0000-0000-0000-000000000001'::uuid,
           'e0000000-0000-0000-0000-000000000002'::uuid
       ) $$,
    'Cannot link foreign expense or expense caller does not belong to',
    'SX-029: Foreign expense via add_expense_to_trip rejected'
);

SELECT set_config('request.jwt.claims', '{"wallet_address": "GALICE11111111111111111111111111111111111111111111111111111", "iat": 1700000000}', true);

SELECT lives_ok(
    $$ UPDATE public.trips
       SET settled = true
       WHERE id = 't0000000-0000-0000-0000-000000000001' $$,
    'SX-029: Settling trip with all settled expenses succeeds'
);

SELECT throws_ok(
    $$ UPDATE public.trips
       SET expense_ids = ARRAY['e0000000-0000-0000-0000-000000000001', 'e0000000-0000-0000-0000-000000000002']
       WHERE id = 't0000000-0000-0000-0000-000000000001' $$,
    'Cannot add expenses to a settled trip',
    'SX-029: Cannot add expenses to settled trip'
);

-- ─── SX-030: Share and Version Tampering Tests ───────────────────────────────

SELECT set_config('request.jwt.claims', '{"wallet_address": "GCHARLIE3333333333333333333333333333333333333333333333333333", "iat": 1700000000}', true);

SELECT throws_ok(
    $$ UPDATE public.expenses
       SET shares = '[{"memberId":"m-charlie","name":"Hacked Name","walletAddress":"GCHARLIE3333333333333333333333333333333333333333333333333333","amount":"30","currency":"XLM","shareType":"equal","weight":1,"percentage":"50","paid":false,"txHash":null}]'::jsonb
       WHERE id = 'e0000000-0000-0000-0000-000000000002' $$,
    'Cannot modify share attributes or allocation',
    'SX-030: Non-creator cannot tamper with share name or attributes'
);

SELECT throws_ok(
    $$ UPDATE public.expenses
       SET version = 999
       WHERE id = 'e0000000-0000-0000-0000-000000000002' $$,
    'Version must increment by exactly 1',
    'SX-030: Non-creator cannot arbitrarily alter version'
);


-- ─── SX-034: Expense Creator Bypass Protection Tests (Issue #186) ───────────

SELECT set_config('request.jwt.claims', '{"wallet_address": "GALICE11111111111111111111111111111111111111111111111111111", "iat": 1700000000}', true);

-- 1. Creator cannot mark paid without a valid hash
SELECT throws_ok(
    $$ SELECT public.mark_share_paid(
           'e0000000-0000-0000-0000-000000000002'::uuid,
           'm-charlie',
           'invalid-hash'
       ) $$,
    'Valid transaction hash is required to mark a share as paid',
    'SX-034: Creator cannot mark paid without a valid hash'
);

SELECT throws_ok(
    $$ UPDATE public.expenses
       SET shares = '[{"memberId":"m-charlie","name":"Charlie","walletAddress":"GCHARLIE3333333333333333333333333333333333333333333333333333","amount":"30","currency":"XLM","shareType":"equal","weight":1,"percentage":"50","paid":true,"txHash":null}]'::jsonb
       WHERE id = 'e0000000-0000-0000-0000-000000000002' $$,
    'Expense creator cannot directly modify shares; use mark_share_paid',
    'SX-034: Creator cannot directly mark paid without a valid hash'
);

-- 2. Creator cannot unmark a paid share
SELECT throws_ok(
    $$ UPDATE public.expenses
       SET shares = '[{"memberId":"m-bob","name":"Bob","walletAddress":"GBOB22222222222222222222222222222222222222222222222222222222","amount":"50","currency":"XLM","shareType":"equal","weight":1,"percentage":"50","paid":false,"txHash":null}]'::jsonb
       WHERE id = 'e0000000-0000-0000-0000-000000000001' $$,
    'Cannot unmark a paid share',
    'SX-034: Creator cannot unmark a paid share'
);

-- 3. Creator cannot desync totals
SELECT throws_ok(
    $$ UPDATE public.expenses
       SET total_amount = '500'
       WHERE id = 'e0000000-0000-0000-0000-000000000002' $$,
    'Share amounts do not reconcile to total_amount',
    'SX-034: Creator cannot desync totals'
);

-- 4. Creator cannot reopen a settled expense
SELECT throws_ok(
    $$ UPDATE public.expenses
       SET settled = false
       WHERE id = 'e0000000-0000-0000-0000-000000000001' $$,
    'Cannot reopen a settled expense',
    'SX-034: Creator cannot reopen a settled expense'
);

SELECT * FROM finish();
ROLLBACK;
