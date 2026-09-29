/**
 * Classifies a Supabase/PostgREST error so failures can be counted by cause.
 *
 * The issue asks specifically about knowing "when RLS rejects a write". An RLS
 * denial is not a bug in the query — it means the caller's `wallet_address`
 * claim did not authorize the row, which is either an auth problem (the token
 * expired, the wrong wallet is signed in) or a policy problem. Either way it
 * needs a different response than a dropped connection, so it gets its own
 * event name instead of being lumped into a generic write failure.
 *
 * Postgres error codes, via PostgREST's `code` field:
 *   42501 — insufficient_privilege, which is what an RLS policy violation
 *           surfaces as.
 *   PGRST301 — PostgREST's own "JWT expired / not authenticated".
 */

export type SupabaseFailureKind =
  | "rls_denied"
  | "unauthenticated"
  | "conflict"
  | "network"
  | "unknown";

interface PostgrestLike {
  code?: unknown;
  message?: unknown;
  details?: unknown;
  hint?: unknown;
}

function asPostgrest(error: unknown): PostgrestLike | null {
  if (typeof error !== "object" || error === null) return null;
  return error as PostgrestLike;
}

export function classifySupabaseError(error: unknown): SupabaseFailureKind {
  const candidate = asPostgrest(error);
  const code = typeof candidate?.code === "string" ? candidate.code : "";
  const message = (
    typeof candidate?.message === "string" ? candidate.message : String(error ?? "")
  ).toLowerCase();

  if (code === "42501" || /row-level security|violates row-level/.test(message)) {
    return "rls_denied";
  }
  if (code === "PGRST301" || code === "401" || /jwt|not authenticated|unauthorized/.test(message)) {
    return "unauthenticated";
  }
  if (code === "23505" || code === "23514" || /conflict|concurrent/.test(message)) {
    return "conflict";
  }
  if (/fetch|network|timeout|econn|failed to fetch/.test(message)) {
    return "network";
  }
  return "unknown";
}

/**
 * Fields worth attaching to a Supabase failure log line.
 *
 * Deliberately excludes `details`, which can quote the offending row's values —
 * amounts and wallet addresses — into the log. `code` and `kind` are what a
 * dashboard groups by.
 */
export function supabaseErrorFields(error: unknown): Record<string, unknown> {
  const candidate = asPostgrest(error);
  return {
    kind: classifySupabaseError(error),
    code: typeof candidate?.code === "string" ? candidate.code : undefined,
  };
}
