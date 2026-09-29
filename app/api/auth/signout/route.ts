/**
 * POST /api/auth/signout
 *
 * Revokes the caller's access token server-side, so "log out" actually
 * invalidates rather than only clearing the browser's copy. The token is read
 * from the Authorization header and must verify before anything is written —
 * otherwise this endpoint would let anyone revoke anyone else's session.
 *
 * `everywhere: true` revokes every token issued to the wallet up to now, which
 * is the control to reach for after losing a device.
 *
 * A sign-out that silently fails to revoke leaves a live token behind, so every
 * failure path here is reported rather than printed.
 */
import { verifyJwt } from "@/lib/auth/jwt";
import { WALLET_CLAIM } from "@/lib/auth/constants";
import { clientKey, rateLimit } from "@/lib/auth/rateLimit";
import {
  RevocationUnavailable,
  isRevocationConfigured,
  revokeToken,
  revokeWallet,
} from "@/lib/auth/revocation";
import { AuthConfigError, getJwtSecret } from "@/lib/auth/serverConfig";
import { countMetric } from "@/lib/observability/logger";
import { jsonWithCorrelation, requestLogger } from "@/lib/observability/requestLog";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" } as const;

export async function POST(request: Request) {
  const logger = requestLogger("POST /api/auth/signout", request);

  const limit = rateLimit(`signout:${clientKey(request)}`, 30, 60_000);
  if (!limit.allowed) {
    logger.warn("auth.signout_rate_limited", { retryAfter: limit.retryAfter });
    logger.finish("auth.signout_completed", 429);
    return jsonWithCorrelation(
      logger,
      { error: "Too many requests. Please wait a moment." },
      { status: 429, headers: { ...NO_STORE, "Retry-After": String(limit.retryAfter) } },
    );
  }

  const header = request.headers.get("authorization") ?? "";
  const token = header.toLowerCase().startsWith("bearer ") ? header.slice(7).trim() : "";
  if (!token) {
    logger.finish("auth.signout_completed", 401, { reason: "missing_token" });
    return jsonWithCorrelation(
      logger,
      { error: "An access token is required." },
      { status: 401, headers: NO_STORE },
    );
  }

  let body: unknown = null;
  try {
    body = await request.json();
  } catch {
    // No body is fine — it just means "revoke this one token".
  }
  const everywhere = (body as { everywhere?: unknown } | null)?.everywhere === true;

  try {
    // Only the holder of a valid token may revoke it. An expired or forged one
    // needs no revoking anyway, so this is not a lockout risk.
    const claims = verifyJwt(token, getJwtSecret());
    if (!claims) {
      logger.warn("auth.signout_rejected", { reason: "invalid_token" });
      logger.finish("auth.signout_completed", 401, { reason: "invalid_token" });
      return jsonWithCorrelation(
        logger,
        { error: "That access token is not valid." },
        { status: 401, headers: NO_STORE },
      );
    }

    const walletAddress = claims[WALLET_CLAIM];
    const jti = claims.jti;
    const exp = claims.exp;
    if (typeof walletAddress !== "string" || typeof exp !== "number") {
      logger.warn("auth.signout_rejected", { reason: "malformed_claims" });
      logger.finish("auth.signout_completed", 401, { reason: "malformed_claims" });
      return jsonWithCorrelation(
        logger,
        { error: "That access token is not valid." },
        { status: 401, headers: NO_STORE },
      );
    }

    if (!isRevocationConfigured()) {
      // Say so plainly rather than reporting a sign-out that did not happen.
      // Reported as an error: the operator must know tokens cannot be revoked.
      logger.error("auth.revocation_not_configured", undefined, {
        walletAddress,
        detail: "SUPABASE_SERVICE_ROLE_KEY is not set.",
      });
      logger.finish("auth.signout_completed", 503, { reason: "revocation_not_configured" });
      return jsonWithCorrelation(
        logger,
        { error: "Server-side sign-out is not configured on this server." },
        { status: 503, headers: NO_STORE },
      );
    }

    if (everywhere) {
      await revokeWallet(walletAddress);
    } else {
      if (typeof jti !== "string") {
        // Tokens minted before `jti` existed cannot be denied individually.
        logger.warn("auth.signout_rejected", { walletAddress, reason: "no_jti" });
        logger.finish("auth.signout_completed", 409, { reason: "no_jti" });
        return jsonWithCorrelation(
          logger,
          { error: "This session predates revocation support — sign out everywhere instead." },
          { status: 409, headers: NO_STORE },
        );
      }
      await revokeToken({ jti, walletAddress, expiresAt: exp });
    }

    countMetric("auth.session_revoked", { everywhere });
    logger.finish("auth.signout_completed", 200, { walletAddress, everywhere });
    return jsonWithCorrelation(logger, { revoked: true, everywhere }, { headers: NO_STORE });
  } catch (err) {
    if (err instanceof AuthConfigError) {
      logger.error("auth.config_missing", err);
      logger.finish("auth.signout_completed", 503, { reason: "config_missing" });
      return jsonWithCorrelation(
        logger,
        { error: "Wallet authentication is not configured on this server." },
        { status: 503, headers: NO_STORE },
      );
    }
    if (err instanceof RevocationUnavailable) {
      // Fail loudly: the browser must not report a sign-out that did not happen.
      logger.error("auth.revocation_failed", err);
      logger.finish("auth.signout_completed", 503, { reason: "revocation_unavailable" });
      return jsonWithCorrelation(
        logger,
        { error: "Could not sign out. Please try again." },
        { status: 503, headers: { ...NO_STORE, "Retry-After": "5" } },
      );
    }
    logger.error("auth.signout_failed", err);
    logger.finish("auth.signout_completed", 500);
    return jsonWithCorrelation(
      logger,
      { error: "Could not sign out." },
      { status: 500, headers: NO_STORE },
    );
  }
}
