/**
 * The issue asks specifically about knowing "when RLS rejects a write". An RLS
 * denial means the caller's `wallet_address` claim did not authorize the row —
 * an auth or policy problem, not a dropped connection — so it needs its own
 * classification rather than being counted as a generic write failure.
 */
import {
  classifySupabaseError,
  supabaseErrorFields,
} from "@/lib/observability/supabaseError";

describe("classifySupabaseError", () => {
  it("recognises an RLS denial by Postgres error code", () => {
    expect(classifySupabaseError({ code: "42501", message: "permission denied" })).toBe(
      "rls_denied",
    );
  });

  it("recognises an RLS denial by message text", () => {
    expect(
      classifySupabaseError({
        message: 'new row violates row-level security policy for table "expenses"',
      }),
    ).toBe("rls_denied");
  });

  it("recognises an expired or missing JWT", () => {
    expect(classifySupabaseError({ code: "PGRST301", message: "JWT expired" })).toBe(
      "unauthenticated",
    );
  });

  it("recognises a transport failure", () => {
    expect(classifySupabaseError(new TypeError("Failed to fetch"))).toBe("network");
  });

  it("recognises a write conflict", () => {
    expect(classifySupabaseError({ message: "concurrent update detected" })).toBe("conflict");
  });

  it("falls back to unknown on anything unrecognised", () => {
    expect(classifySupabaseError({ code: "XX000", message: "internal" })).toBe("unknown");
    expect(classifySupabaseError(null)).toBe("unknown");
    expect(classifySupabaseError(undefined)).toBe("unknown");
    expect(classifySupabaseError("a plain string")).toBe("unknown");
  });
});

describe("supabaseErrorFields", () => {
  it("exposes the kind and code a dashboard groups by", () => {
    expect(supabaseErrorFields({ code: "42501", message: "denied" })).toEqual({
      kind: "rls_denied",
      code: "42501",
    });
  });

  it("never forwards `details`, which quotes the offending row", () => {
    // PostgREST puts the rejected row's values in `details` — amounts and
    // wallet addresses. That must not reach a log drain.
    const fields = supabaseErrorFields({
      code: "42501",
      message: "denied",
      details: "Failing row contains (GABC, 1000.00)",
    });

    expect(fields).not.toHaveProperty("details");
    expect(JSON.stringify(fields)).not.toContain("1000.00");
  });
});
