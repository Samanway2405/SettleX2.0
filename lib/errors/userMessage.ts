/**
 * Decides what an error boundary is allowed to show a user.
 *
 * The problem this solves: `app/error.tsx` used to render `error.message`
 * verbatim. Much of the app throws messages written for humans ("Wallet not
 * connected"), but the Supabase paths re-throw raw PostgREST errors, so the same
 * line could just as easily print
 *
 *   new row violates row-level security policy for table "expenses"
 *
 * at a user. That is confusing, it leaks the schema and the fact that RLS is the
 * gate, and it is exactly the kind of internal detail an error boundary should
 * log rather than display.
 *
 * Blanket-hiding every message would have been the easy fix, but it throws away
 * genuinely useful text — "Lobstr extension is not installed" tells the user
 * precisely what to do, and replacing it with "something went wrong" makes the
 * product worse. So this is an allowlist: a message is shown only when it was
 * recognisably authored for a user, and everything else falls back to a generic
 * line while the detail goes to the logger.
 *
 * The safe default is to hide. A new internal error added anywhere in the
 * codebase is hidden until someone deliberately makes it user-facing.
 */

/** Shown when the underlying message is not safe to display. */
export const GENERIC_USER_MESSAGE =
  "An unexpected error occurred. Please try again.";

/**
 * Markers of machine-generated or internal text. Any hit disqualifies the
 * message regardless of what else it looks like.
 *
 * These are matched first, so a database error that happens to read like a
 * sentence still cannot slip through.
 */
const INTERNAL_MARKERS: readonly RegExp[] = [
  // Postgres / PostgREST.
  /row-level security/i,
  /violates .*constraint/i,
  /duplicate key value/i,
  /relation ".*" does not exist/i,
  /column ".*" of relation/i,
  /permission denied for (table|relation|schema)/i,
  /\bpgrst\d+\b/i,
  /\bsqlstate\b/i,
  // A bare Postgres error code, e.g. "42501".
  /^\d{5}$/,
  // Supabase / PostgREST shapes.
  /supabase/i,
  /postgrest/i,
  // Stack traces, module paths and framework internals.
  /\bat [\w$.]+ \(/,
  /\.(ts|tsx|js|jsx|mjs):\d+/,
  /node_modules/,
  /webpack/i,
  /\bhydrat(e|ion)\b/i,
  /minified react error/i,
  // Raw transport failures.
  /^(typeerror|referenceerror|syntaxerror|rangeerror|networkerror)\b/i,
  /failed to fetch/i,
  /\bnetworkerror\b/i,
  /\beconnrefused\b|\betimedout\b|\benotfound\b/i,
  // JSON / object dumps and serialised payloads.
  /^[[{]/,
  /\{"[\w]+":/,
  // Credentials or addresses that should never be rendered.
  /\beyJ[\w-]{6,}\./,
  /\bbearer\b/i,
  /\b[GC][A-Z2-7]{55}\b/,
  // Internal invariants aimed at developers, not users.
  /must be used within/i,
  /is not a function\b/i,
  /cannot read propert/i,
  /undefined is not/i,
  // Protocol and infrastructure jargon. "JWT expired" is grammatical prose but
  // means nothing to a user, and naming the token mechanism is a detail the UI
  // has no reason to disclose; the session-expiry copy belongs to the auth flow.
  /\bjwt\b/i,
  /\b(access|refresh|bearer) token\b/i,
  /\brls\b/i,
  /\brole\b.*\bkey\b/i,
  /\bapi key\b/i,
  /\bclaim\b/i,
  /\b(5\d{2}|4\d{2}) (error|status)\b/i,
];

/**
 * A message must look like a sentence written for a person: starts with a
 * capital letter or a digit, and contains only characters that appear in prose.
 *
 * Braces, angle brackets, backticks and SQL-style double quotes are excluded
 * because they signal identifiers and serialised data rather than prose. `#` is
 * allowed for the contract decoder's numbered fallbacks ("Pool error #137."),
 * which are the user-facing text for an unmapped contract code.
 */
const LOOKS_LIKE_PROSE = /^[A-Z0-9][A-Za-z0-9 ,.'’\-—–:()!?/%+#]*$/;

/** Bounds on a plausible user-facing sentence. */
const MIN_LENGTH = 8;
const MAX_LENGTH = 160;

/**
 * True when `message` is safe to show a user.
 *
 * Exported for tests and for any other surface that needs the same decision.
 */
export function isUserFacingMessage(message: unknown): message is string {
  if (typeof message !== "string") return false;

  const trimmed = message.trim();
  if (trimmed.length < MIN_LENGTH || trimmed.length > MAX_LENGTH) return false;

  // Multi-line text is a dump, not a sentence.
  if (/[\r\n]/.test(trimmed)) return false;

  for (const marker of INTERNAL_MARKERS) {
    if (marker.test(trimmed)) return false;
  }

  return LOOKS_LIKE_PROSE.test(trimmed);
}

/**
 * The message to display for `error`, and whether it came from the error itself.
 *
 * `wasSuppressed` lets the caller record that a detail was hidden, so the
 * substitution is visible in the logs rather than silently swallowed.
 */
export function userFacingMessage(error: unknown): {
  message: string;
  wasSuppressed: boolean;
} {
  const raw =
    typeof error === "string"
      ? error
      : error instanceof Error
        ? error.message
        : undefined;

  if (isUserFacingMessage(raw)) {
    return { message: raw.trim(), wasSuppressed: false };
  }

  return { message: GENERIC_USER_MESSAGE, wasSuppressed: true };
}
