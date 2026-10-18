import * as fs from "fs";
import * as path from "path";

describe("Database Migrations and Security Hardening (Issue #194, SX-026 to SX-031)", () => {
  const rootDir = path.resolve(__dirname, "../../");
  const configPath = path.join(rootDir, "supabase/config.toml");
  const migrationsDir = path.join(rootDir, "supabase/migrations");
  const pgtapTestPath = path.join(rootDir, "supabase/tests/database_security_sx026_sx031.test.sql");

  it("adopts Supabase CLI configuration in supabase/config.toml", () => {
    expect(fs.existsSync(configPath)).toBe(true);
    const configContent = fs.readFileSync(configPath, "utf8");
    expect(configContent).toMatch(/project_id\s*=\s*"settlex"/);
    expect(configContent).toMatch(/\[api\]/);
    expect(configContent).toMatch(/\[db\]/);
    expect(configContent).toMatch(/\[auth\]/);
  });

  it("organizes schema into clean versioned migrations", () => {
    expect(fs.existsSync(migrationsDir)).toBe(true);
    const files = fs.readdirSync(migrationsDir).filter((f) => f.endsWith(".sql"));
    expect(files.length).toBeGreaterThanOrEqual(4);

    // Verify migrations follow timestamp naming convention
    for (const file of files) {
      expect(file).toMatch(/^\d{14}_[a-z0-9_]+\.sql$/);
    }

    // Verify chronological ordering
    const sorted = [...files].sort();
    expect(files).toEqual(sorted);
  });

  it("implements SX-026 (Expense creator bypass prevention) in migrations", () => {
    const hardeningSql = fs.readFileSync(
      path.join(migrationsDir, "20261017000000_security_hardening.sql"),
      "utf8"
    );

    // Creator cannot directly update shares via UPDATE (must use mark_share_paid)
    expect(hardeningSql).toMatch(/Expense creator cannot directly modify shares; use mark_share_paid/);

    // Amounts, currency, split_mode, members frozen once any share is paid
    expect(hardeningSql).toMatch(/Cannot modify financial terms or members once shares have been paid/);

    // Settled consistency and reopen prevention
    expect(hardeningSql).toMatch(/Cannot mark expense as settled while unpaid shares remain/);
    expect(hardeningSql).toMatch(/Cannot reopen a settled expense/);
  });

  it("implements SX-034 (Expense creator bypass protection and payload re-validation) in migrations", () => {
    const hardeningSql = fs.readFileSync(
      path.join(migrationsDir, "20261017000000_security_hardening.sql"),
      "utf8"
    );

    // Creator cannot unmark a paid share
    expect(hardeningSql).toMatch(/Cannot unmark a paid share/);

    // Creator edits re-validate payload against NEW
    expect(hardeningSql).toMatch(/assert_valid_expense_payload\(/);

    // Valid transaction hash required when marking share as paid
    expect(hardeningSql).toMatch(/Valid transaction hash is required/);

    // Totals desynchronization prevention
    expect(hardeningSql).toMatch(/Share amounts do not reconcile to total_amount/);

    // Settled status consistency and reopen prevention
    expect(hardeningSql).toMatch(/Cannot reopen a settled expense/);
  });

  it("implements SX-027 (Trip creator bypass prevention) in migrations", () => {
    const hardeningSql = fs.readFileSync(
      path.join(migrationsDir, "20261017000000_security_hardening.sql"),
      "utf8"
    );

    // Cannot remove existing expenses from trip
    expect(hardeningSql).toMatch(/Cannot remove existing expenses from trip/);

    // Cannot settle trip while linked expenses are unsettled
    expect(hardeningSql).toMatch(/Cannot settle trip while linked expenses remain unsettled/);

    // Cannot reopen settled trip
    expect(hardeningSql).toMatch(/Cannot reopen a settled trip/);

    // Re-validate members and member_wallets consistency
    expect(hardeningSql).toMatch(/member_wallets must exactly match trip members/);
    expect(hardeningSql).toMatch(/Trip creator must be a trip member/);
  });

  it("implements SX-028 (mark_share_paid global uniqueness & already-paid check) in migrations", () => {
    const hardeningSql = fs.readFileSync(
      path.join(migrationsDir, "20261017000000_security_hardening.sql"),
      "utf8"
    );

    // payments table created
    expect(hardeningSql).toMatch(/CREATE TABLE IF NOT EXISTS public\.payments/);
    expect(hardeningSql).toMatch(/tx_hash TEXT PRIMARY KEY/);

    // Re-marking already paid share is rejected
    expect(hardeningSql).toMatch(/Share is already marked as paid/);

    // Global duplicate hash reuse is rejected
    expect(hardeningSql).toMatch(/Transaction hash already used on another payment/);

    // Creator override sets manual: true
    expect(hardeningSql).toMatch(/manual BOOLEAN DEFAULT false NOT NULL/);
    expect(hardeningSql).toMatch(/'\{manual\}'/);
  });

  it("implements SX-029 (Trip expense_ids injection prevention) in migrations", () => {
    const hardeningSql = fs.readFileSync(
      path.join(migrationsDir, "20261017000000_security_hardening.sql"),
      "utf8"
    );

    // Rejects non-UUID elements in expense_ids
    expect(hardeningSql).toMatch(/Invalid expense ID in trip: must be a valid UUID/);

    // Rejects foreign expenses or expenses caller does not belong to
    expect(hardeningSql).toMatch(/Cannot link foreign expense or expense caller does not belong to/);

    // Creates trip_expenses join table and add_expense_to_trip RPC
    expect(hardeningSql).toMatch(/CREATE TABLE IF NOT EXISTS public\.trip_expenses/);
    expect(hardeningSql).toMatch(/CREATE OR REPLACE FUNCTION public\.add_expense_to_trip/);
  });

  it("implements SX-030 (Member share tampering & version check) in migrations", () => {
    const hardeningSql = fs.readFileSync(
      path.join(migrationsDir, "20261017000000_security_hardening.sql"),
      "utf8"
    );

    // Frozen share attributes
    expect(hardeningSql).toMatch(/Cannot modify share attributes or allocation/);

    // Cannot forge paidBy address
    expect(hardeningSql).toMatch(/Cannot forge paidBy address/);

    // Version must increment by exactly 1
    expect(hardeningSql).toMatch(/Version must increment by exactly 1/);
  });

  it("implements SX-031 (Length and size limits) in migrations", () => {
    const limitsSql = fs.readFileSync(
      path.join(migrationsDir, "20261016120000_length_limits.sql"),
      "utf8"
    );

    expect(limitsSql).toMatch(/users_display_name_check/);
    expect(limitsSql).toMatch(/char_length\(display_name\) BETWEEN 1 AND 50/);
    expect(limitsSql).toMatch(/expenses_title_check/);
    expect(limitsSql).toMatch(/char_length\(title\) BETWEEN 1 AND 120/);
    expect(limitsSql).toMatch(/expenses_description_check/);
    expect(limitsSql).toMatch(/char_length\(description\) <= 100/);
    expect(limitsSql).toMatch(/expenses_members_check/);
    expect(limitsSql).toMatch(/jsonb_array_length\(members\) <= 50/);
    expect(limitsSql).toMatch(/trips_name_check/);
    expect(limitsSql).toMatch(/char_length\(name\) BETWEEN 1 AND 120/);
  });

  it("provides comprehensive pgTAP test suite covering SX-026 through SX-031", () => {
    expect(fs.existsSync(pgtapTestPath)).toBe(true);
    const pgtapContent = fs.readFileSync(pgtapTestPath, "utf8");

    expect(pgtapContent).toMatch(/SELECT plan\(\d+\);/);
    expect(pgtapContent).toMatch(/SX-031: users_display_name_check/);
    expect(pgtapContent).toMatch(/SX-026: Creator cannot directly modify shares/);
    expect(pgtapContent).toMatch(/SX-028: Valid mark_share_paid/);
    expect(pgtapContent).toMatch(/SX-028: Cannot re-mark an already paid share/);
    expect(pgtapContent).toMatch(/SX-028: Global duplicate transaction hash reuse/);
    expect(pgtapContent).toMatch(/SX-028: Creator override is flagged with manual: true/);
    expect(pgtapContent).toMatch(/SX-027: Trip creator cannot remove existing expenses/);
    expect(pgtapContent).toMatch(/SX-027: Cannot settle trip while linked expenses are unsettled/);
    expect(pgtapContent).toMatch(/SX-027: Trip creator cannot reopen a settled trip/);
    expect(pgtapContent).toMatch(/SX-027: Trip creator cannot desync members and member_wallets/);
    expect(pgtapContent).toMatch(/SX-027: Trip creator cannot remove themselves from trip/);
    expect(pgtapContent).toMatch(/SX-029: Non-UUID expense_ids rejected/);
    expect(pgtapContent).toMatch(/SX-029: Foreign expense injection rejected/);
    expect(pgtapContent).toMatch(/SX-029: Foreign expense via add_expense_to_trip rejected/);
    expect(pgtapContent).toMatch(/SX-029: Settling trip with all settled expenses succeeds/);
    expect(pgtapContent).toMatch(/SX-029: Cannot add expenses to settled trip/);
    expect(pgtapContent).toMatch(/SX-030: Non-creator cannot tamper with share name or attributes/);
    expect(pgtapContent).toMatch(/SX-030: Non-creator cannot arbitrarily alter version/);
    expect(pgtapContent).toMatch(/SX-034: Creator cannot mark paid without a valid hash/);
    expect(pgtapContent).toMatch(/SX-034: Creator cannot unmark a paid share/);
    expect(pgtapContent).toMatch(/SX-034: Creator cannot desync totals/);
    expect(pgtapContent).toMatch(/SX-034: Creator cannot reopen a settled expense/);
    expect(pgtapContent).toMatch(/SELECT \* FROM finish\(\);/);
  });

  it("generates valid JWT claims structure for multi-wallet testing", () => {
    const aliceWallet = "GALICE11111111111111111111111111111111111111111111111111111";
    const bobWallet = "GBOB22222222222222222222222222222222222222222222222222222222";

    const makeClaims = (wallet: string) => ({
      sub: wallet,
      wallet_address: wallet,
      aud: "authenticated",
      role: "authenticated",
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 3600,
    });

    const aliceClaims = makeClaims(aliceWallet);
    const bobClaims = makeClaims(bobWallet);

    expect(aliceClaims.wallet_address).toBe(aliceWallet);
    expect(bobClaims.wallet_address).toBe(bobWallet);
    expect(aliceClaims.wallet_address).not.toBe(bobClaims.wallet_address);
  });
});
