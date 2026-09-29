/**
 * The regression these tests exist for: a deployment missing
 * SUPABASE_JWT_SECRET used to pass the "Validate Production Build Inputs" job,
 * because that job only checked the two public Supabase values. Sign-in was
 * dead on arrival.
 */
import fs from "node:fs";
import path from "node:path";
import {
  CONFIG_REQUIREMENTS,
  checkConfig,
} from "@/lib/config/requirements";

/** A fully configured production environment, as a starting point to break. */
function completeEnv(): NodeJS.ProcessEnv {
  return {
    NEXT_PUBLIC_SUPABASE_URL: "https://project.supabase.co",
    NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon-key",
    NEXT_PUBLIC_CONTRACT_ID: "CCONTRACT",
    NEXT_PUBLIC_SITE_URL: "https://settlex.app",
    SUPABASE_JWT_SECRET: "jwt-secret",
    AUTH_CHALLENGE_SECRET: "challenge-secret",
    SUPABASE_SERVICE_ROLE_KEY: "service-role-key",
  };
}

describe("checkConfig", () => {
  it("passes a fully configured environment", () => {
    const report = checkConfig(completeEnv());
    expect(report.ok).toBe(true);
    expect(report.problems).toEqual([]);
    expect(report.warnings).toEqual([]);
  });

  it("fails when SUPABASE_JWT_SECRET is missing", () => {
    // The exact case the old workflow waved through.
    const env = completeEnv();
    delete env.SUPABASE_JWT_SECRET;

    const report = checkConfig(env);
    expect(report.ok).toBe(false);
    expect(report.problems.map((p) => p.name)).toContain("SUPABASE_JWT_SECRET");
  });

  it("fails when AUTH_CHALLENGE_SECRET is missing", () => {
    const env = completeEnv();
    delete env.AUTH_CHALLENGE_SECRET;

    const report = checkConfig(env);
    expect(report.ok).toBe(false);
    expect(report.problems.map((p) => p.name)).toContain("AUTH_CHALLENGE_SECRET");
  });

  it("covers every variable the auth handshake needs to answer a request", () => {
    const names = CONFIG_REQUIREMENTS.map((entry) => entry.name);
    expect(names).toEqual(
      expect.arrayContaining([
        "SUPABASE_JWT_SECRET",
        "AUTH_CHALLENGE_SECRET",
        "NEXT_PUBLIC_SUPABASE_URL",
        "NEXT_PUBLIC_SUPABASE_ANON_KEY",
        "NEXT_PUBLIC_SITE_URL",
        "NEXT_PUBLIC_CONTRACT_ID",
      ]),
    );
  });

  it("treats a whitespace-only value as missing", () => {
    // An empty GitHub secret expands to "", and a typo can leave a stray space.
    const env = completeEnv();
    env.SUPABASE_JWT_SECRET = "   ";

    const report = checkConfig(env);
    expect(report.ok).toBe(false);
    expect(report.problems.map((p) => p.name)).toContain("SUPABASE_JWT_SECRET");
  });

  it("reports a missing recommended value as a warning, not a failure", () => {
    const env = completeEnv();
    delete env.SUPABASE_SERVICE_ROLE_KEY;

    const report = checkConfig(env);
    expect(report.ok).toBe(true);
    expect(report.warnings.map((p) => p.name)).toEqual(["SUPABASE_SERVICE_ROLE_KEY"]);
  });

  it("rejects one key reused for both cryptographic purposes", () => {
    // Satisfying the presence check by copy-pasting the JWT secret would
    // otherwise pass, matching assertAuthConfig's own rule.
    const env = completeEnv();
    env.AUTH_CHALLENGE_SECRET = env.SUPABASE_JWT_SECRET;

    const report = checkConfig(env);
    expect(report.ok).toBe(false);
    expect(report.problems.map((p) => p.name)).toContain("AUTH_CHALLENGE_SECRET");
  });

  it("does not flag the distinctness rule when one side is unset", () => {
    // The missing-value problem is the useful message there; a spurious
    // "must differ" on two blanks would only add noise.
    const env = completeEnv();
    delete env.AUTH_CHALLENGE_SECRET;
    delete env.SUPABASE_JWT_SECRET;

    const report = checkConfig(env);
    const messages = report.problems.map((p) => p.message).join("\n");
    expect(messages).not.toContain("must not be the same value");
  });

  it("explains the impact of every requirement so an operator can act on it", () => {
    for (const entry of CONFIG_REQUIREMENTS) {
      expect(entry.impact.length).toBeGreaterThan(0);
    }
  });
});

describe("the CI script and the runtime check agree", () => {
  // The whole point of scripts/check-production-config.js parsing
  // requirements.ts is that the pre-deploy check cannot drift from the app. If
  // the parser stops matching the source, this test fails instead of CI
  // silently checking a shorter list.
  const scriptSource = fs.readFileSync(
    path.join(process.cwd(), "scripts", "check-production-config.js"),
    "utf8",
  );

  it("reads the requirements from the shared module rather than restating them", () => {
    expect(scriptSource).toContain("requirements.ts");

    // No variable name should be hardcoded in the script; duplicating the list
    // is what let the two fall out of sync in the first place.
    for (const entry of CONFIG_REQUIREMENTS) {
      expect(scriptSource).not.toContain(`"${entry.name}"`);
    }
  });
});
