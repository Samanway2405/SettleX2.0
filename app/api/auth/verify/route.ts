/**
 * POST /api/auth/verify
 *
 * Verifies a signed challenge and, only on success, mints a Supabase access
 * token whose `wallet_address` claim carries the proven Stellar address. Every
 * RLS policy authorizes on that claim, so this route is the single place where
 * a claimed wallet becomes an authenticated one.
 *
 * Because it is the gate on every authenticated action, every outcome is logged
 * with a correlation id: a rejected signature (`auth.verify_rejected`) is the
 * line that tells you signing is broken, and it is not an exception, so nothing
 * else would have recorded it.
 */
import { isValidWalletAddress, verifyChallengeShared } from "@/lib/auth/challenge";
import { issueAccessToken } from "@/lib/auth/jwt";
import { clientKey, enforceRateLimit } from "@/lib/auth/rateLimit";
import {
  AuthConfigError,
  getChallengeSecret,
  getJwtSecret,
  getSessionTtlSeconds,
} from "@/lib/auth/serverConfig";
import { SharedStoreUnavailable } from "@/lib/auth/sharedStore";
import { countMetric } from "@/lib/observability/logger";
import { jsonWithCorrelation, requestLogger } from "@/lib/observability/requestLog";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" } as const;

export async function POST(request: Request) {
  const logger = requestLogger("POST /api/auth/verify", request);

  const limit = await enforceRateLimit(`verify:${clientKey(request)}`, 30, 60_000);
  if (!limit.allowed) {
    logger.warn("auth.verify_rate_limited", { retryAfter: limit.retryAfter });
    logger.finish("auth.verify_completed", 429);
    return jsonWithCorrelation(
      logger,
      { error: "Too many authentication attempts. Please wait a moment." },
      { status: 429, headers: { ...NO_STORE, "Retry-After": String(limit.retryAfter) } },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    logger.finish("auth.verify_completed", 400, { reason: "malformed_json" });
    return jsonWithCorrelation(
      logger,
      { error: "A JSON body is required." },
      { status: 400, headers: NO_STORE },
    );
  }

  const { walletAddress, signedTransactionXdr, challengeToken } = (body ?? {}) as {
    walletAddress?: unknown;
    signedTransactionXdr?: unknown;
    challengeToken?: unknown;
  };

  if (
    !isValidWalletAddress(walletAddress) ||
    typeof signedTransactionXdr !== "string" ||
    typeof challengeToken !== "string"
  ) {
    logger.finish("auth.verify_completed", 400, { reason: "invalid_payload" });
    return jsonWithCorrelation(
      logger,
      { error: "walletAddress, signedTransactionXdr and challengeToken are required." },
      { status: 400, headers: NO_STORE },
    );
  }

  try {
    const result = await verifyChallengeShared({
      walletAddress,
      signedTransactionXdr,
      challengeToken,
      secret: getChallengeSecret(),
    });

    if (!result.ok) {
      // Not an exception, so nothing used to record it — yet "signing is
      // failing for everyone" looks exactly like a spike of these. The reason
      // is our own enum, safe to log verbatim.
      logger.warn("auth.verify_rejected", { walletAddress, reason: result.reason });
      countMetric("auth.verify_rejected", { reason: result.reason });
      logger.finish("auth.verify_completed", 401, { reason: result.reason });
      return jsonWithCorrelation(logger, { error: result.reason }, { status: 401, headers: NO_STORE });
    }

    const { token, expiresAt } = issueAccessToken({
      walletAddress: result.walletAddress,
      secret: getJwtSecret(),
      ttlSeconds: getSessionTtlSeconds(),
    });

    countMetric("auth.session_issued");
    logger.finish("auth.verify_completed", 200, { walletAddress: result.walletAddress });
    return jsonWithCorrelation(
      logger,
      { accessToken: token, expiresAt, walletAddress: result.walletAddress },
      { headers: NO_STORE },
    );
  } catch (err) {
    if (err instanceof SharedStoreUnavailable) {
      // Fail closed: without the shared nonce store the single-use guard is
      // unenforceable, and minting a token anyway would reopen the replay hole.
      // Nobody can sign in while this persists, so it is an error, not a warning.
      logger.error("auth.shared_store_unavailable", err, { walletAddress });
      logger.finish("auth.verify_completed", 503, { reason: "shared_store_unavailable" });
      return jsonWithCorrelation(
        logger,
        { error: "Wallet authentication is temporarily unavailable. Please try again." },
        { status: 503, headers: { ...NO_STORE, "Retry-After": "5" } },
      );
    }
    if (err instanceof AuthConfigError) {
      logger.error("auth.config_missing", err, { walletAddress });
      logger.finish("auth.verify_completed", 503, { reason: "config_missing" });
      return jsonWithCorrelation(
        logger,
        { error: "Wallet authentication is not configured on this server." },
        { status: 503, headers: NO_STORE },
      );
    }
    logger.error("auth.verify_failed", err, { walletAddress });
    logger.finish("auth.verify_completed", 500);
    return jsonWithCorrelation(
      logger,
      { error: "Could not verify the signed challenge." },
      { status: 500, headers: NO_STORE },
    );
  }
}
