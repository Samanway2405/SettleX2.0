import * as fs from "fs";
import * as path from "path";
import { DEFAULT_SESSION_TTL_SECONDS } from "@/lib/auth/constants";
import {
  assertAuthConfig,
  AuthConfigError,
  getChallengeSecret,
  getJwtSecret,
  getSessionTtlSeconds,
  MAX_SESSION_TTL_CAP_SECONDS,
} from "@/lib/auth/serverConfig";

const ORIGINAL = { ...process.env };

afterEach(() => {
  process.env = { ...ORIGINAL };
});

describe("getJwtSecret", () => {
  it("returns the configured secret", () => {
    process.env.SUPABASE_JWT_SECRET = "shhh";
    expect(getJwtSecret()).toBe("shhh");
  });

  it("fails loudly when unset rather than signing with a blank key", () => {
    delete process.env.SUPABASE_JWT_SECRET;
    expect(() => getJwtSecret()).toThrow(AuthConfigError);
  });
});

/**
 * NODE_ENV is read-only in the Next/Jest type defs, so set it through the
 * indexed signature.
 */
function setNodeEnv(value: string): void {
  (process.env as Record<string, string>).NODE_ENV = value;
}

describe("getChallengeSecret", () => {
  it("prefers its own secret", () => {
    process.env.SUPABASE_JWT_SECRET = "jwt";
    process.env.AUTH_CHALLENGE_SECRET = "challenge";
    expect(getChallengeSecret()).toBe("challenge");
  });

  it("falls back to the JWT secret outside production", () => {
    setNodeEnv("development");
    process.env.SUPABASE_JWT_SECRET = "jwt";
    delete process.env.AUTH_CHALLENGE_SECRET;
    expect(getChallengeSecret()).toBe("jwt");
  });

  it("refuses to reuse the JWT secret in production", () => {
    // One key serving two cryptographic purposes means a leak in the challenge
    // path also compromises token signing, and rotating the JWT secret
    // silently invalidates every outstanding challenge.
    setNodeEnv("production");
    process.env.SUPABASE_JWT_SECRET = "jwt";
    delete process.env.AUTH_CHALLENGE_SECRET;
    expect(() => getChallengeSecret()).toThrow(AuthConfigError);
  });

  it("uses its own secret in production when configured", () => {
    setNodeEnv("production");
    process.env.SUPABASE_JWT_SECRET = "jwt";
    process.env.AUTH_CHALLENGE_SECRET = "challenge";
    expect(getChallengeSecret()).toBe("challenge");
  });
});

describe("assertAuthConfig", () => {
  it("passes when both secrets are set and distinct", () => {
    setNodeEnv("production");
    process.env.SUPABASE_JWT_SECRET = "jwt";
    process.env.AUTH_CHALLENGE_SECRET = "challenge";
    expect(() => assertAuthConfig()).not.toThrow();
  });

  it("fails a production boot with no challenge secret", () => {
    setNodeEnv("production");
    process.env.SUPABASE_JWT_SECRET = "jwt";
    delete process.env.AUTH_CHALLENGE_SECRET;
    expect(() => assertAuthConfig()).toThrow(AuthConfigError);
  });

  it("fails when both secrets are set to the same value", () => {
    // Satisfying the check by copy-pasting the JWT secret would defeat it.
    setNodeEnv("production");
    process.env.SUPABASE_JWT_SECRET = "same";
    process.env.AUTH_CHALLENGE_SECRET = "same";
    expect(() => assertAuthConfig()).toThrow(AuthConfigError);
  });

  it("fails when the JWT secret is missing", () => {
    setNodeEnv("production");
    delete process.env.SUPABASE_JWT_SECRET;
    process.env.AUTH_CHALLENGE_SECRET = "challenge";
    expect(() => assertAuthConfig()).toThrow(AuthConfigError);
  });
});

describe("getSessionTtlSeconds", () => {
  it("defaults when unset or unparseable", () => {
    delete process.env.AUTH_SESSION_TTL_SECONDS;
    expect(getSessionTtlSeconds()).toBe(DEFAULT_SESSION_TTL_SECONDS);

    process.env.AUTH_SESSION_TTL_SECONDS = "abc";
    expect(getSessionTtlSeconds()).toBe(DEFAULT_SESSION_TTL_SECONDS);

    process.env.AUTH_SESSION_TTL_SECONDS = "-5";
    expect(getSessionTtlSeconds()).toBe(DEFAULT_SESSION_TTL_SECONDS);
  });

  it("honours a configured lifetime", () => {
    process.env.AUTH_SESSION_TTL_SECONDS = "3600";
    expect(getSessionTtlSeconds()).toBe(3600);
  });

  it("caps a typo at 12 hours", () => {
    process.env.AUTH_SESSION_TTL_SECONDS = "99999999";
    expect(getSessionTtlSeconds()).toBe(12 * 60 * 60);
  });

  it("keeps the default well under the cap so a leaked token ages out fast", () => {
    expect(DEFAULT_SESSION_TTL_SECONDS).toBeLessThanOrEqual(60 * 60);
  });
});

describe("revocation tombstone vs session TTL cap (Issue #196)", () => {
  it("asserts database revocation tombstone TTL strictly exceeds maximum session TTL cap", () => {
    const setupSqlPath = path.resolve(__dirname, "../../supabase-setup.sql");
    const sqlContent = fs.readFileSync(setupSqlPath, "utf8");

    // Extract default tombstone TTL interval from settlex_revoke_wallet
    const match = sqlContent.match(/v_max_ttl\s+INTERVAL\s*:=\s*INTERVAL\s*'(\d+)\s+hours'/i);
    expect(match).not.toBeNull();

    const tombstoneHours = parseInt(match![1], 10);
    const tombstoneSeconds = tombstoneHours * 60 * 60;

    // Cap from MAX_SESSION_TTL_CAP_SECONDS (12h)
    expect(tombstoneSeconds).toBeGreaterThan(MAX_SESSION_TTL_CAP_SECONDS);
  });
});

