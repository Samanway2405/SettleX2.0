import * as fs from "fs";
import * as path from "path";

describe("expense and trip insert consent boundary (Issue #127)", () => {
  const setupSql = fs.readFileSync(
    path.resolve(__dirname, "../../supabase-setup.sql"),
    "utf8",
  );

  it("runs BEFORE INSERT validators for both user-created record types", () => {
    expect(setupSql).toMatch(
      /CREATE TRIGGER validate_expenses_insert\s+BEFORE INSERT ON expenses[\s\S]*?validate_expense_insert\(\)/i,
    );
    expect(setupSql).toMatch(
      /CREATE TRIGGER validate_trips_insert\s+BEFORE INSERT ON trips[\s\S]*?validate_trip_insert\(\)/i,
    );
  });

  it("rejects pre-settled rows, pre-paid shares, and invalid allocations", () => {
    expect(setupSql).toMatch(/New expenses must be unsettled at version 1/i);
    expect(setupSql).toMatch(/Shares must be unique, unpaid, transaction-free/i);
    expect(setupSql).toMatch(/Share amounts do not reconcile to total_amount/i);
    expect(setupSql).toMatch(/New trips must be unsettled and contain no expenses/i);
  });

  it("keeps invitees out of table policies until they accept", () => {
    const expenseSelectPolicy = setupSql.match(
      /CREATE POLICY "Members can view their expenses"[\s\S]*?;\n/i,
    )?.[0];
    const tripSelectPolicy = setupSql.match(
      /CREATE POLICY "Members can view their trips"[\s\S]*?;\n/i,
    )?.[0];

    expect(expenseSelectPolicy).toContain("accepted_wallets");
    expect(tripSelectPolicy).toContain("accepted_wallets");
    expect(setupSql).toMatch(/CREATE OR REPLACE FUNCTION public\.get_pending_invitations\(\)/i);
    expect(setupSql).toMatch(/CREATE OR REPLACE FUNCTION public\.accept_invitation/i);
  });

  it("makes acceptance append-only and self-service", () => {
    expect(setupSql).toMatch(/OLD\.accepted_wallets <@ NEW\.accepted_wallets/i);
    expect(setupSql).toMatch(
      /cardinality\(NEW\.accepted_wallets\)[\s\S]*?cardinality\(OLD\.accepted_wallets\) \+ 1/i,
    );
    expect(setupSql).toMatch(/Accept the expense invitation before recording a payment/i);
  });
});
