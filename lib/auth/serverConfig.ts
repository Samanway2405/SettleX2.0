/**
 * Server-side secrets for the wallet authentication handshake.
 *
 * Every value here is read lazily inside a request handler so a missing secret
 * fails that request rather than the whole build. None of these may ever be
 * prefixed with `NEXT_PUBLIC_` — that would ship them in the browser bundle and
 * let anyone mint their own tokens.
 */
import { DEFAULT_SESSION_TTL_SECONDS } from "@/lib/auth/constants";

export class AuthConfigError extends Error {}

/**
 * The Supabase project's JWT secret (Dashboard → Settings → API → JWT Secret).
 * Tokens signed with it are accepted by PostgREST and Realtime.
 */
export function getJwtSecret(): string {
  const secret = process.env.SUPABASE_JWT_SECRET;
  if (!secret) {
    throw new AuthConfigError(
      "SUPABASE_JWT_SECRET is not set. Copy it from Supabase → Settings → API → JWT Secret.",
    );
  }
  return secret;
}

/**
 * Key used to bind a challenge nonce to a wallet.
 *
 * Required in production, because sharing a key across two cryptographic
 * purposes gives up cheap insurance: a bug or leak in the challenge path would
 * then also compromise token signing, and rotating the Supabase JWT secret
 * would silently invalidate every outstanding challenge. Outside production the
 * JWT secret is still accepted so a local checkout runs with one value
 * configured.
 */
export function getChallengeSecret(): string {
  const secret = process.env.AUTH_CHALLENGE_SECRET;
  if (secret) return secret;

  if (process.env.NODE_ENV === "production") {
    throw new AuthConfigError(
      "AUTH_CHALLENGE_SECRET is not set. It must be distinct from " +
        "SUPABASE_JWT_SECRET so the challenge and token-signing keys stay " +
        "separate. Generate one with: openssl rand -base64 48",
    );
  }

  return getJwtSecret();
}

/**
 * Maximum session lifetime cap (12 hours = 43200s).
 *
 * NOTE: The database tombstone in `settlex_revoke_wallet` (supabase-setup.sql)
 * defaults to 13 hours (46800s) to strictly outlive this cap so revoked tokens
 * cannot become valid again before expiring. If MAX_SESSION_TTL_CAP_SECONDS is
 * ever changed, the revocation tombstone duration in `settlex_revoke_wallet`
 * must be updated accordingly to exceed this value.
 */
export const MAX_SESSION_TTL_CAP_SECONDS = 12 * 60 * 60;

/** Lifetime of an issued access token, in seconds. */
export function getSessionTtlSeconds(): number {
  const raw = process.env.AUTH_SESSION_TTL_SECONDS;
  if (!raw) return DEFAULT_SESSION_TTL_SECONDS;

  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_SESSION_TTL_SECONDS;

  // Cap at 12h so a typo cannot mint a near-permanent token. Tokens are
  // bearer credentials for a money app; the denylist only helps for sessions
  // the user explicitly signs out of, so the ceiling stays low.
  //
  // NOTE: This cap must stay strictly less than the revocation tombstone TTL
  // (13 hours in settlex_revoke_wallet, supabase-setup.sql).
  return Math.min(Math.floor(parsed), MAX_SESSION_TTL_CAP_SECONDS);
}


/**
 * Validates every auth secret at once, for the boot-time check in
 * `instrumentation.ts`. Throws on the first problem it finds.
 */
export function assertAuthConfig(): void {
  getJwtSecret();
  getChallengeSecret();

  if (
    process.env.AUTH_CHALLENGE_SECRET &&
    process.env.AUTH_CHALLENGE_SECRET === process.env.SUPABASE_JWT_SECRET
  ) {
    throw new AuthConfigError(
      "AUTH_CHALLENGE_SECRET must not be the same value as SUPABASE_JWT_SECRET — " +
        "setting both to one key defeats the point of separating them.",
    );
  }
}
