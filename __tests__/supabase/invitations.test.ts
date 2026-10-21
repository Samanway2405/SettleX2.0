import * as fs from "fs";
import * as path from "path";

describe("invitation model: decline, context, and trip expenses acceptance (Issue #192)", () => {
  const setupSql = fs.readFileSync(
    path.resolve(__dirname, "../../supabase-setup.sql"),
    "utf8",
  );

  it("adds declined_wallets column to expenses and trips tables", () => {
    expect(setupSql).toMatch(/declined_wallets\s+TEXT\[\]\s+NOT\s+NULL\s+DEFAULT\s+ARRAY\[\]::TEXT\[\]/i);
    expect(setupSql).toMatch(/idx_expenses_declined_wallets/i);
    expect(setupSql).toMatch(/idx_trips_declined_wallets/i);
  });

  it("defines decline_invitation and leave_trip RPCs with pinned search_path", () => {
    expect(setupSql).toMatch(
      /CREATE OR REPLACE FUNCTION public\.decline_invitation\([\s\S]*?p_entity_type\s+TEXT[\s\S]*?p_entity_id\s+UUID[\s\S]*?SET search_path = ''/i,
    );
    expect(setupSql).toMatch(
      /CREATE OR REPLACE FUNCTION public\.leave_trip\([\s\S]*?p_trip_id\s+UUID[\s\S]*?SET search_path = ''/i,
    );
    expect(setupSql).toMatch(/GRANT EXECUTE ON FUNCTION public\.decline_invitation\(TEXT, UUID\) TO authenticated, anon;/i);
    expect(setupSql).toMatch(/GRANT EXECUTE ON FUNCTION public\.leave_trip\(UUID\) TO authenticated, anon;/i);
  });

  it("exposes total_amount and caller_share in get_pending_invitations", () => {
    const getPendingMatch = setupSql.match(
      /CREATE OR REPLACE FUNCTION public\.get_pending_invitations\(\)[\s\S]*?RETURNS TABLE\s*\(([\s\S]*?)\)[\s\S]*?\$\$/i,
    );
    expect(getPendingMatch).not.toBeNull();
    const returnCols = getPendingMatch![1];
    expect(returnCols).toMatch(/total_amount\s+TEXT/i);
    expect(returnCols).toMatch(/caller_share\s+TEXT/i);
  });

  it("filters out declined invitations and expenses linked to accepted trips in get_pending_invitations", () => {
    expect(setupSql).toMatch(/NOT\s*\(\s*v_caller\s*=\s*ANY\(e\.declined_wallets\)\s*\)/i);
    expect(setupSql).toMatch(/NOT\s*\(\s*v_caller\s*=\s*ANY\(t\.declined_wallets\)\s*\)/i);
    expect(setupSql).toMatch(/NOT EXISTS\s*\(\s*SELECT 1 FROM public\.trips t[\s\S]*?e\.id::TEXT = ANY\(t\.expense_ids\)/i);
  });

  it("derives expense visibility from accepted trip membership in SELECT and UPDATE policies", () => {
    const selectPolicy = setupSql.match(
      /CREATE POLICY "Members can view their expenses" ON expenses[\s\S]*?FOR SELECT[\s\S]*?USING\s*\(([\s\S]*?)\);/i,
    );
    expect(selectPolicy).not.toBeNull();
    expect(selectPolicy![1]).toMatch(/EXISTS\s*\(\s*SELECT 1 FROM public\.trips t[\s\S]*?expenses\.id::TEXT = ANY\(t\.expense_ids\)/i);

    const updatePolicy = setupSql.match(
      /CREATE POLICY "Members can update their expenses" ON expenses[\s\S]*?FOR UPDATE[\s\S]*?USING\s*\(([\s\S]*?)\)[\s\S]*?WITH CHECK\s*\(([\s\S]*?)\);/i,
    );
    expect(updatePolicy).not.toBeNull();
    expect(updatePolicy![1]).toMatch(/EXISTS\s*\(\s*SELECT 1 FROM public\.trips t[\s\S]*?expenses\.id::TEXT = ANY\(t\.expense_ids\)/i);
    expect(updatePolicy![2]).toMatch(/EXISTS\s*\(\s*SELECT 1 FROM public\.trips t[\s\S]*?expenses\.id::TEXT = ANY\(t\.expense_ids\)/i);
  });

  it("auto-accepts trip expenses when accepting a trip or linking expenses to a trip", () => {
    expect(setupSql).toMatch(/CREATE OR REPLACE FUNCTION public\.sync_trip_expenses_accepted_wallets/i);
    expect(setupSql).toMatch(/CREATE TRIGGER sync_trip_expenses_accepted_wallets/i);
    // In accept_invitation for trip:
    const acceptFunc = setupSql.match(
      /CREATE OR REPLACE FUNCTION public\.accept_invitation[\s\S]*?\$\$/i,
    );
    expect(acceptFunc).not.toBeNull();
    expect(acceptFunc![0]).toMatch(/ELSIF p_entity_type = 'trip' THEN[\s\S]*?UPDATE public\.expenses[\s\S]*?accepted_wallets/i);
  });

  it("authorizes mark_share_paid for accepted trip members without extra expense acceptances", () => {
    const markSharePaid = setupSql.match(
      /CREATE OR REPLACE FUNCTION public\.mark_share_paid[\s\S]*?\$\$/i,
    );
    expect(markSharePaid).not.toBeNull();
    expect(markSharePaid![0]).toMatch(/SELECT 1 FROM public\.trips t[\s\S]*?p_expense_id::TEXT = ANY\(t\.expense_ids\)/i);
  });
});
