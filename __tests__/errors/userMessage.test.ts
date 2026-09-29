/**
 * The regression these tests exist for: `app/error.tsx` rendered
 * `error.message` verbatim. Because the Supabase paths re-throw raw PostgREST
 * errors, that boundary could print
 *
 *   new row violates row-level security policy for table "expenses"
 *
 * at a user — leaking the schema and the fact that RLS is the gate.
 *
 * The fix is an allowlist rather than a blanket hide, so the two halves both
 * need guarding: internal text must never be shown, and the messages the app
 * deliberately authored for users must not be swallowed.
 */
import {
  GENERIC_USER_MESSAGE,
  isUserFacingMessage,
  userFacingMessage,
} from "@/lib/errors/userMessage";

describe("internal detail is never shown to a user", () => {
  // Every entry is text that can actually reach a boundary in this app.
  const internal = [
    ['row-level security', 'new row violates row-level security policy for table "expenses"'],
    ["permission denied", "permission denied for table expenses"],
    ["unique constraint", 'duplicate key value violates unique constraint "expenses_pkey"'],
    ["missing relation", 'relation "public.expenses" does not exist'],
    ["missing column", 'column "wallet_address" of relation "trips" does not exist'],
    ["PostgREST code", "PGRST301"],
    ["bare pg code", "42501"],
    ["token jargon", "JWT expired"],
    ["runtime TypeError", "TypeError: Cannot read properties of undefined (reading 'id')"],
    ["transport failure", "Failed to fetch"],
    ["network error", "NetworkError when attempting to fetch resource."],
    ["developer invariant", "useExpenseContext must be used within <ExpenseProvider />"],
    ["stack frame", "at ExpenseProvider (context/ExpenseContext.tsx:143:11)"],
    ["JSON dump", '{"code":"42501","message":"permission denied"}'],
    ["a JWT", "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.sig"],
    ["a bearer token", "Bearer tok_abc123"],
    ["a wallet address", `GA${"B".repeat(54)}`],
    ["minified React error", "Minified React error #418; visit https://react.dev"],
    ["hydration mismatch", "Hydration failed because the initial UI does not match"],
    ["library internals", "supabase.from(...) is not a function"],
    ["connection refused", "ECONNREFUSED 127.0.0.1:54321"],
  ] as const;

  it.each(internal)("hides %s", (_label, message) => {
    const result = userFacingMessage(new Error(message));
    expect(result.wasSuppressed).toBe(true);
    expect(result.message).toBe(GENERIC_USER_MESSAGE);
    // The generic line must not smuggle the detail through.
    expect(result.message).not.toContain(message);
  });
});

describe("messages the app wrote for users are still shown", () => {
  // Hiding these would make the product worse: each one tells the user what to
  // do next.
  const userFacing = [
    "Access denied. Please make sure your database is properly configured.",
    "Cannot connect to server. Please check your internet connection.",
    "Connection rejected in Freighter.",
    "Contract transaction timed out waiting for confirmation.",
    "Contract simulation returned an unexpected result.",
    "Expense not found in state — please refresh and try again.",
    "Freighter did not return an address.",
    "Lobstr extension is not installed.",
    "Payment amount must be greater than zero.",
    "Pool balance is insufficient for this transfer.",
    // The contract decoder's fallback for an unmapped code.
    "Pool error #137.",
    "Transaction cancelled in wallet.",
  ];

  it.each(userFacing)("shows %s", (message) => {
    const result = userFacingMessage(new Error(message));
    expect(result.wasSuppressed).toBe(false);
    expect(result.message).toBe(message);
  });
});

describe("userFacingMessage input handling", () => {
  it("accepts a bare string", () => {
    expect(userFacingMessage("Lobstr extension is not installed.")).toEqual({
      message: "Lobstr extension is not installed.",
      wasSuppressed: false,
    });
  });

  it("falls back for a non-error value", () => {
    for (const value of [null, undefined, 42, {}, [], true]) {
      expect(userFacingMessage(value)).toEqual({
        message: GENERIC_USER_MESSAGE,
        wasSuppressed: true,
      });
    }
  });

  it("falls back for an empty or whitespace message", () => {
    // Previously `error.message || "..."` handled empty string but not "   ".
    expect(userFacingMessage(new Error("")).wasSuppressed).toBe(true);
    expect(userFacingMessage(new Error("   ")).wasSuppressed).toBe(true);
  });

  it("trims surrounding whitespace on a shown message", () => {
    expect(userFacingMessage(new Error("  Connection rejected in Freighter.  ")).message).toBe(
      "Connection rejected in Freighter.",
    );
  });
});

describe("isUserFacingMessage boundaries", () => {
  it("rejects a message too short to be a sentence", () => {
    expect(isUserFacingMessage("Nope")).toBe(false);
  });

  it("rejects an over-long message rather than filling the page", () => {
    expect(isUserFacingMessage(`A${"a".repeat(400)}.`)).toBe(false);
  });

  it("rejects multi-line text, which is a dump not a sentence", () => {
    expect(isUserFacingMessage("Something failed.\n  at foo (bar.ts:1:1)")).toBe(false);
  });

  it("rejects text that does not start like a sentence", () => {
    expect(isUserFacingMessage("cannot connect to the server right now")).toBe(false);
  });

  it("defaults to hiding an unfamiliar internal message", () => {
    // The safe default matters most for errors nobody has thought about yet.
    expect(isUserFacingMessage("ERR_UNKNOWN_SUBSYSTEM_FAULT_0x8f")).toBe(false);
  });
});
