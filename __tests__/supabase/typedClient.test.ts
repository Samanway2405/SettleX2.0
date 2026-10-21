import * as fs from "fs";
import * as path from "path";

describe("Typed Supabase client and resolve_user_profile (Issue #193)", () => {
  const typesPath = path.resolve(__dirname, "../../types/supabase.ts");
  const sessionPath = path.resolve(__dirname, "../../lib/supabase/session.ts");
  const authContextPath = path.resolve(__dirname, "../../context/AuthContext.tsx");
  const expenseContextPath = path.resolve(__dirname, "../../context/ExpenseContext.tsx");
  const tripContextPath = path.resolve(__dirname, "../../context/TripContext.tsx");
  const packageJsonPath = path.resolve(__dirname, "../../package.json");
  const generatorPath = path.resolve(__dirname, "../../scripts/generate-supabase-types.js");

  it("includes script to regenerate supabase types in package.json", () => {
    const pkg = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));
    expect(pkg.scripts["types:supabase"]).toBe("node scripts/generate-supabase-types.js");
    expect(fs.existsSync(generatorPath)).toBe(true);
  });

  it("exports Database type with users, expenses (version, declined_wallets), trips and RPCs", () => {
    const typesContent = fs.readFileSync(typesPath, "utf8");
    expect(typesContent).toMatch(/export type Database\s*=/);
    expect(typesContent).toMatch(/users:\s*\{\s*Row:\s*\{[\s\S]*?wallet_address:\s*string;[\s\S]*?display_name:\s*string;/);
    expect(typesContent).toMatch(/expenses:\s*\{\s*Row:\s*\{[\s\S]*?version:\s*number;[\s\S]*?declined_wallets:\s*string\[\];/);
    expect(typesContent).toMatch(/trips:\s*\{\s*Row:\s*\{[\s\S]*?declined_wallets:\s*string\[\];/);
    expect(typesContent).toMatch(/resolve_user_profile:\s*\{/);
    expect(typesContent).toMatch(/mark_share_paid:\s*\{/);
    expect(typesContent).toMatch(/get_pending_invitations:\s*\{/);
    expect(typesContent).toMatch(/accept_invitation:\s*\{/);
    expect(typesContent).toMatch(/decline_invitation:\s*\{/);
    expect(typesContent).toMatch(/leave_trip:\s*\{/);
  });

  it("removes unauthenticated getTypedClient and types authenticated client as SupabaseClient<Database>", () => {
    const sessionContent = fs.readFileSync(sessionPath, "utf8");
    expect(sessionContent).not.toMatch(/function\s+getTypedClient/);
    expect(sessionContent).not.toMatch(/export\s+const\s+getTypedClient/);
    expect(sessionContent).toMatch(/createClient<Database>/);
    expect(sessionContent).toMatch(/SupabaseClient<Database>/);
  });

  it("implements and exposes resolveUserProfile calling resolve_user_profile RPC in AuthContext", () => {
    const authContent = fs.readFileSync(authContextPath, "utf8");
    expect(authContent).toMatch(/resolveUserProfile:\s*\(walletAddress:\s*string\)\s*=>\s*Promise<string\s*\|\s*null>/);
    expect(authContent).toMatch(/client\.rpc\(\s*["']resolve_user_profile["']/);
  });

  it("has no any in Supabase calls or client state in context files", () => {
    const expenseContent = fs.readFileSync(expenseContextPath, "utf8");
    const tripContent = fs.readFileSync(tripContextPath, "utf8");

    expect(expenseContent).not.toMatch(/useState<SupabaseClient\s*\|/);
    expect(expenseContent).toMatch(/useState<SupabaseClient<Database>\s*\|\s*null>/);
    expect(expenseContent).not.toMatch(/isRowForWallet\(row:\s*any/);
    expect(expenseContent).not.toMatch(/RealtimePostgresChangesPayload<any>/);
    expect(expenseContent).not.toMatch(/dbUpdates:\s*Record<string,\s*any>/);

    expect(tripContent).not.toMatch(/useState<SupabaseClient\s*\|/);
    expect(tripContent).toMatch(/useState<SupabaseClient<Database>\s*\|\s*null>/);
    expect(tripContent).not.toMatch(/isRowForWallet\(row:\s*any/);
    expect(tripContent).not.toMatch(/RealtimePostgresChangesPayload<any>/);
    expect(tripContent).not.toMatch(/dbUpdates:\s*Record<string,\s*any>/);
  });
});
