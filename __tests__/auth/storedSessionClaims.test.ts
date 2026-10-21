/** @jest-environment jsdom */

/**
 * Regression tests for "readStoredSession trusts a sibling field instead of the
 * token's own claim".
 *
 * The attack: write a localStorage blob pairing a victim's address with the
 * attacker's own valid token. The ownership check read the JSON field next to
 * the token, so the UI marked the victim's wallet as verified while every
 * request actually acted as the attacker.
 */
import { LS_SESSION, SESSION_REFRESH_SKEW_SECONDS, WALLET_CLAIM } from "@/lib/auth/constants";
import { readStoredSession } from "@/lib/supabase/session";

// session.ts imports the signer, which loads the ESM-only wallet kit. Nothing
// here signs, so stub it as the other session tests do.
jest.mock("@/lib/freighter", () => ({
  signXDR: jest.fn(),
}));

const VICTIM = "GDQNY3PBOJOKYZSRMK2S7LHHGWZIUISD4QORETLMXEWXBI7KFZZMKTL3";
const ATTACKER = "GA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJVSGZ";

/** Builds an unsigned JWT — only the payload matters to the client. */
function tokenFor(walletAddress: string, expSeconds: number): string {
  const b64 = (value: unknown) =>
    btoa(JSON.stringify(value)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return [
    b64({ alg: "HS256", typ: "JWT" }),
    b64({ [WALLET_CLAIM]: walletAddress, exp: expSeconds }),
    "signature-not-checked-client-side",
  ].join(".");
}

const inAnHour = () => Math.floor(Date.now() / 1000) + 3600;

function store(blob: unknown): void {
  window.localStorage.setItem(LS_SESSION, JSON.stringify(blob));
}

describe("readStoredSession", () => {
  beforeEach(() => window.localStorage.clear());

  it("returns the session when the token's own claim matches", () => {
    store({
      walletAddress: VICTIM,
      accessToken: tokenFor(VICTIM, inAnHour()),
      expiresAt: Date.now() + 3600_000,
    });

    expect(readStoredSession(VICTIM)?.walletAddress).toBe(VICTIM);
  });

  it("refuses a token issued to a different wallet than the blob claims", () => {
    // The forgery from the issue: victim's address, attacker's real token.
    store({
      walletAddress: VICTIM,
      accessToken: tokenFor(ATTACKER, inAnHour()),
      expiresAt: Date.now() + 3600_000,
    });

    expect(readStoredSession(VICTIM)).toBeNull();
  });

  it("ignores an edited expiresAt when the token itself has expired", () => {
    store({
      walletAddress: VICTIM,
      accessToken: tokenFor(VICTIM, Math.floor(Date.now() / 1000) - 60),
      expiresAt: Date.now() + 86_400_000, // attacker-extended
    });

    expect(readStoredSession(VICTIM)).toBeNull();
  });

  it("reports expiry from the claims, not the stored field", () => {
    const exp = inAnHour();
    store({
      walletAddress: VICTIM,
      accessToken: tokenFor(VICTIM, exp),
      expiresAt: 1, // stale hint
    });

    expect(readStoredSession(VICTIM)?.expiresAt).toBe(exp * 1000);
  });

  it("keeps a token inside the refresh skew valid so requests do not fail early", () => {
    const insideSkew = Math.floor(Date.now() / 1000) + SESSION_REFRESH_SKEW_SECONDS - 5;
    store({
      walletAddress: VICTIM,
      accessToken: tokenFor(VICTIM, insideSkew),
      expiresAt: Date.now() + 86_400_000,
    });

    expect(readStoredSession(VICTIM)?.walletAddress).toBe(VICTIM);
  });

  it("rejects blobs with a malformed or missing token", () => {
    store({ walletAddress: VICTIM, accessToken: "not-a-jwt", expiresAt: Date.now() + 3600_000 });
    expect(readStoredSession(VICTIM)).toBeNull();

    store({ walletAddress: VICTIM, expiresAt: Date.now() + 3600_000 });
    expect(readStoredSession(VICTIM)).toBeNull();

    window.localStorage.setItem(LS_SESSION, "{ not json");
    expect(readStoredSession(VICTIM)).toBeNull();
  });

  it("rejects a token carrying no wallet claim at all", () => {
    const b64 = (v: unknown) =>
      btoa(JSON.stringify(v)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    const noClaim = [b64({ alg: "HS256" }), b64({ exp: inAnHour() }), "sig"].join(".");
    store({ walletAddress: VICTIM, accessToken: noClaim, expiresAt: Date.now() + 3600_000 });

    expect(readStoredSession(VICTIM)).toBeNull();
  });
});
