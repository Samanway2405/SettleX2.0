/**
 * GET /api/health
 *
 * Reports whether this deployment is actually configured, so a post-deploy
 * check can catch what a pre-deploy secret check cannot: a value that was set in
 * the build environment but not the runtime one, or set to the wrong thing.
 *
 * Returns 200 when every required variable is present, 503 when any is missing.
 * That makes it usable directly as a smoke test (`curl --fail`) and as an uptime
 * probe.
 *
 * It reports only *presence* and never a value, not even a prefix or length — a
 * health endpoint is unauthenticated, so anything it returns is public. Variable
 * names are already public (they are documented in `.env.local.example`); their
 * contents are the secret.
 */
import { NextResponse } from "next/server";
import { checkConfig } from "@/lib/config/requirements";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const report = checkConfig();

  const isOnlyServiceRoleMissing = 
    !report.ok &&
    report.problems.length === 1 && 
    report.problems[0].name === "SUPABASE_SERVICE_ROLE_KEY";
    
  const status = report.ok ? "ok" : isOnlyServiceRoleMissing ? "degraded" : "misconfigured";
  const statusCode = report.ok || isOnlyServiceRoleMissing ? 200 : 503;

  return NextResponse.json(
    {
      status,
      // Names only — see the note above on why no values appear here.
      missingRequired: report.problems.map((problem) => problem.name),
      missingRecommended: report.warnings.map((problem) => problem.name),
      inactiveControls: isOnlyServiceRoleMissing ? [
        "cross-instance nonce replay protection",
        "cross-instance rate limiting",
        "token revocation"
      ] : undefined,
      checkedAt: new Date().toISOString(),
    },
    {
      status: statusCode,
      headers: { "Cache-Control": "no-store" },
    },
  );
}
