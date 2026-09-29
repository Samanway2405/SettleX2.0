/**
 * Redaction is the safety property that makes logging these code paths
 * acceptable at all: the auth routes handle bearer tokens and signed XDR, and a
 * log drain is a third party that retains and indexes whatever it is sent.
 */
import { maskWalletAddress, redact, redactText, REDACTED } from "@/lib/observability/redact";

/** A syntactically valid 56-character Stellar public key. */
const WALLET = `GA${"B".repeat(54)}`;

describe("maskWalletAddress", () => {
  it("keeps a recognisable stub without the full address", () => {
    const masked = maskWalletAddress(WALLET);
    expect(masked).not.toBe(WALLET);
    expect(masked).toContain("…");
    // Enough of a prefix to correlate one user's requests.
    expect(masked.startsWith("GABBBB")).toBe(true);
  });

  it("leaves a short value alone rather than mangling it", () => {
    expect(maskWalletAddress("GABC")).toBe("GABC");
  });
});

describe("redact", () => {
  it("replaces secret-looking keys wholesale", () => {
    const out = redact({
      SUPABASE_JWT_SECRET: "s",
      accessToken: "a.b.c",
      password: "p",
      signedTransactionXdr: "AAAA",
      authorization: "Bearer x",
      apiKey: "k",
    }) as Record<string, unknown>;

    for (const key of Object.keys(out)) {
      expect(out[key]).toBe(REDACTED);
    }
  });

  it("keeps non-sensitive fields readable", () => {
    const out = redact({ status: 503, route: "/api/auth/verify" }) as Record<string, unknown>;
    expect(out.status).toBe(503);
    expect(out.route).toBe("/api/auth/verify");
  });

  it("truncates a wallet address instead of dropping it", () => {
    // Dropping it would make per-user correlation impossible; keeping it whole
    // would deanonymise the user against a public ledger.
    const out = redact({ walletAddress: WALLET }) as Record<string, string>;
    expect(out.walletAddress).toContain("…");
    expect(out.walletAddress).not.toBe(REDACTED);
    expect(out.walletAddress).not.toBe(WALLET);
  });

  it("reduces an Error to name, message, code and stack", () => {
    const out = redact(new Error("boom")) as Record<string, unknown>;
    expect(out.name).toBe("Error");
    expect(out.message).toBe("boom");
    expect(typeof out.stack).toBe("string");
  });

  it("keeps an error's `code` so failures stay classifiable", () => {
    const error = Object.assign(new Error("denied"), { code: "42501" });
    expect((redact(error) as Record<string, unknown>).code).toBe("42501");
  });

  it("drops row-quoting fields from a plain Supabase error object", () => {
    // PostgREST puts the rejected row's values in `details`/`hint` — amounts and
    // wallet addresses. A catch block passes the raw error straight to
    // reportError, so this must be stripped here, not at each call site.
    const out = redact({
      code: "42501",
      message: "permission denied",
      details: "Failing row contains (GABC, 1000.00)",
      hint: "check the policy on expenses",
    }) as Record<string, unknown>;

    expect(out.details).toBe(REDACTED);
    expect(out.hint).toBe(REDACTED);
    expect(out.code).toBe("42501");
    expect(JSON.stringify(out)).not.toContain("1000.00");
  });

  it("drops extra properties hung on a thrown Error, not just plain objects", () => {
    // Supabase throws real Error instances with `details` attached.
    const error = Object.assign(new Error("permission denied"), {
      code: "42501",
      details: "Failing row contains (GABC, 1000.00)",
    });

    expect(JSON.stringify(redact(error))).not.toContain("1000.00");
  });

  it("scrubs a wallet address out of an error message", () => {
    const out = redact(new Error(`account ${WALLET} missing`)) as Record<string, string>;
    expect(out.message).not.toContain(WALLET);
  });

  it("stops at a depth limit rather than walking forever", () => {
    let deep: unknown = "bottom";
    for (let i = 0; i < 20; i += 1) deep = { next: deep };
    expect(JSON.stringify(redact(deep))).toContain("[depth limit]");
  });

  it("survives a circular reference", () => {
    const node: Record<string, unknown> = { name: "a" };
    node.self = node;
    expect(() => redact(node)).not.toThrow();
  });

  it("reports the type of a function rather than its source", () => {
    const out = redact({ callback: () => "secret" }) as Record<string, string>;
    expect(out.callback).toBe("[function]");
  });

  it("passes primitives through untouched", () => {
    expect(redact(42)).toBe(42);
    expect(redact(true)).toBe(true);
    expect(redact(null)).toBeNull();
    expect(redact(undefined)).toBeUndefined();
  });
});

describe("redactText", () => {
  it("removes a JWT", () => {
    const jwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.abcdefghijk";
    const out = redactText(`token ${jwt} rejected`);
    expect(out).not.toContain(jwt);
    expect(out).toContain(REDACTED);
  });

  it("removes a bearer token", () => {
    expect(redactText("sent Bearer abc123def456")).not.toContain("abc123def456");
  });

  it("masks a loose Stellar address", () => {
    expect(redactText(`from ${WALLET}`)).not.toContain(WALLET);
  });

  it("truncates a huge blob so one XDR cannot flood the log", () => {
    const out = redactText("x".repeat(5000));
    expect(out.length).toBeLessThan(700);
    expect(out).toContain("[truncated]");
  });
});
