import * as fs from "fs";
import * as path from "path";

describe("resolve_user_profile privacy boundary (Issue #128)", () => {
  const setupSql = fs.readFileSync(
    path.resolve(__dirname, "../../supabase-setup.sql"),
    "utf8",
  );
  const functionSql = setupSql.match(
    /CREATE OR REPLACE FUNCTION public\.resolve_user_profile\(p_wallet_address TEXT\)[\s\S]*?\n\$\$;/i,
  )?.[0];

  it("requires an authenticated caller and returns only self or accepted shared counterparties", () => {
    expect(functionSql).toBeDefined();
    expect(functionSql).toMatch(/v_caller_wallet := public\.settlex_wallet\(\)/i);
    expect(functionSql).toMatch(/u\.wallet_address = v_caller_wallet/i);

    for (const table of ["expenses", "trips"]) {
      const sharedContext = new RegExp(
        `FROM public\\.${table} [a-z]+[\\s\\S]*?v_caller_wallet = ANY\\([a-z]+\\.accepted_wallets\\)[\\s\\S]*?u\\.wallet_address = ANY\\([a-z]+\\.accepted_wallets\\)[\\s\\S]*?v_caller_wallet = ANY\\([a-z]+\\.member_wallets\\)[\\s\\S]*?u\\.wallet_address = ANY\\([a-z]+\\.member_wallets\\)`,
        "i",
      );
      expect(functionSql).toMatch(sharedContext);
    }
  });

  it("enforces a per-caller shared quota and does not expose the definer function to anon", () => {
    expect(functionSql).toMatch(/auth_rate_limit\([\s\S]*?'profile_lookup:' \|\| v_caller_wallet/i);
    expect(functionSql).toMatch(/\b60\s*,\s*60000\s*\)/i);
    expect(functionSql).toMatch(/IF NOT v_allowed THEN[\s\S]*?RAISE EXCEPTION/i);
    expect(setupSql).toMatch(
      /REVOKE ALL ON FUNCTION public\.resolve_user_profile\(TEXT\) FROM PUBLIC, anon, authenticated;\s*GRANT EXECUTE ON FUNCTION public\.resolve_user_profile\(TEXT\) TO authenticated;/i,
    );
    expect(setupSql).not.toMatch(
      /GRANT EXECUTE ON FUNCTION public\.resolve_user_profile\(TEXT\) TO authenticated, anon/i,
    );
  });
});

describe("SECURITY DEFINER function permissions (Issue #129)", () => {
  const setupSql = fs.readFileSync(
    path.resolve(__dirname, "../../supabase-setup.sql"),
    "utf8",
  );

  it("does not grant execute on mark_share_paid to anon role", () => {
    expect(setupSql).toMatch(
      /REVOKE ALL ON FUNCTION public\.mark_share_paid\(UUID,\s*TEXT,\s*TEXT\) FROM PUBLIC, anon, authenticated;\s*GRANT EXECUTE ON FUNCTION public\.mark_share_paid\(UUID,\s*TEXT,\s*TEXT\) TO authenticated;/i,
    );
    expect(setupSql).not.toMatch(
      /GRANT EXECUTE ON FUNCTION public\.mark_share_paid\(UUID,\s*TEXT,\s*TEXT\) TO authenticated, anon/i,
    );
  });

  it("does not grant execute on resolve_user_profile to anon role", () => {
    expect(setupSql).toMatch(
      /REVOKE ALL ON FUNCTION public\.resolve_user_profile\(TEXT\) FROM PUBLIC, anon, authenticated;\s*GRANT EXECUTE ON FUNCTION public\.resolve_user_profile\(TEXT\) TO authenticated;/i,
    );
    expect(setupSql).not.toMatch(
      /GRANT EXECUTE ON FUNCTION public\.resolve_user_profile\(TEXT\) TO authenticated, anon/i,
    );
  });
});

