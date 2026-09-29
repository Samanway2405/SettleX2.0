/**
 * The single source of truth for what a production deployment must have set.
 *
 * This list exists because the pre-deploy workflow and the post-deploy health
 * endpoint used to disagree with reality: the workflow checked the two public
 * Supabase values and nothing else, so a deployment missing
 * `SUPABASE_JWT_SECRET` — without which every sign-in returns 503 — passed a job
 * named "Validate Production Build Inputs" and shipped unusable.
 *
 * Adding a variable here makes it checked in both places at once. `scripts/`
 * reads the same list from CI, so the workflow cannot drift from the runtime.
 *
 * Nothing here reads a value. Callers decide whether to report presence
 * (`/api/health`) or to fail (`checkProductionConfig`); neither ever echoes a
 * secret's contents.
 */

/** Whether a missing variable breaks the deployment or only degrades it. */
export type Requirement = "required" | "recommended";

export interface ConfigRequirement {
  /** Environment variable name. */
  name: string;
  requirement: Requirement;
  /**
   * `true` when the value is inlined into the browser bundle at build time, so
   * it must be present in the *build* environment and not only at runtime.
   */
  buildTime: boolean;
  /** What breaks when it is missing, in operator terms. */
  impact: string;
}

export const CONFIG_REQUIREMENTS: readonly ConfigRequirement[] = [
  {
    name: "NEXT_PUBLIC_SUPABASE_URL",
    requirement: "required",
    buildTime: true,
    impact: "No Supabase project to talk to; every query fails.",
  },
  {
    name: "NEXT_PUBLIC_SUPABASE_ANON_KEY",
    requirement: "required",
    buildTime: true,
    impact: "Supabase rejects every request as unauthenticated.",
  },
  {
    name: "SUPABASE_JWT_SECRET",
    requirement: "required",
    buildTime: false,
    impact:
      "/api/auth/challenge and /api/auth/verify both return 503 — nobody can sign in at all.",
  },
  {
    name: "AUTH_CHALLENGE_SECRET",
    requirement: "required",
    buildTime: false,
    impact:
      "Sign-in returns 503 in production, where reusing SUPABASE_JWT_SECRET is refused.",
  },
  {
    name: "NEXT_PUBLIC_CONTRACT_ID",
    requirement: "required",
    buildTime: true,
    impact: "No settlement contract to call; on-chain settlement is unavailable.",
  },
  {
    name: "NEXT_PUBLIC_SITE_URL",
    requirement: "required",
    buildTime: true,
    impact:
      "OpenGraph, Twitter and PWA URLs fall back to a hardcoded domain that may not be this deployment.",
  },
  {
    name: "SUPABASE_SERVICE_ROLE_KEY",
    requirement: "required",
    buildTime: false,
    impact:
      "Replay guard and rate limiter fall back to per-process memory, which does not hold across instances; sign-out cannot revoke.",
  },
];

/** A distinctness rule between two variables, checked only when both are set. */
interface DistinctPair {
  a: string;
  b: string;
  reason: string;
}

const MUST_DIFFER: readonly DistinctPair[] = [
  {
    a: "AUTH_CHALLENGE_SECRET",
    b: "SUPABASE_JWT_SECRET",
    reason:
      "one key serving two cryptographic purposes means a leak in either path compromises both",
  },
];

export interface ConfigProblem {
  name: string;
  requirement: Requirement;
  message: string;
}

export interface ConfigReport {
  /** `false` when any `required` variable is missing or a rule is violated. */
  ok: boolean;
  problems: ConfigProblem[];
  /** Names of `recommended` variables that are missing. */
  warnings: ConfigProblem[];
}

function isBlank(value: string | undefined): boolean {
  return value === undefined || value.trim() === "";
}

/**
 * Checks `env` against the requirements above.
 *
 * Takes the environment as a parameter rather than reading `process.env` so the
 * CI script can check a build environment and the health endpoint can check the
 * running one, with the same code.
 */
export function checkConfig(env: NodeJS.ProcessEnv = process.env): ConfigReport {
  const problems: ConfigProblem[] = [];
  const warnings: ConfigProblem[] = [];

  for (const entry of CONFIG_REQUIREMENTS) {
    if (!isBlank(env[entry.name])) continue;

    const problem: ConfigProblem = {
      name: entry.name,
      requirement: entry.requirement,
      message: `${entry.name} is not set. ${entry.impact}`,
    };

    if (entry.requirement === "required") problems.push(problem);
    else warnings.push(problem);
  }

  for (const pair of MUST_DIFFER) {
    const left = env[pair.a];
    const right = env[pair.b];
    if (isBlank(left) || isBlank(right)) continue;
    if (left !== right) continue;

    problems.push({
      name: pair.a,
      requirement: "required",
      message: `${pair.a} must not be the same value as ${pair.b} — ${pair.reason}.`,
    });
  }

  return { ok: problems.length === 0, problems, warnings };
}
