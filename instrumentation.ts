/**
 * Runs once when the server boots, before any request is served.
 *
 * Secrets are otherwise read lazily inside request handlers so a missing value
 * fails one request rather than the whole build. That is right for a local
 * checkout, but in production a misconfigured deployment should not come up
 * healthy and then fail the first time someone tries to sign in — by then it is
 * serving traffic and the operator has moved on.
 */
export async function register() {
  // Only the Node.js runtime has the env and the auth code; the edge runtime
  // (middleware) imports neither.
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  // Error reporting is installed in every environment, before the config check
  // below — otherwise a failed production boot, the single most important error
  // to capture, would happen with no reporter attached.
  const { initObservability } = await import("@/lib/observability/init");
  initObservability();

  if (process.env.NODE_ENV !== "production") return;

  const { assertAuthConfig } = await import("@/lib/auth/serverConfig");
  const { reportError } = await import("@/lib/observability/logger");

  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.warn("WARNING: SUPABASE_SERVICE_ROLE_KEY is not set. Security controls are degraded: replay protection, rate limiting, and token revocation are inactive.");
  }

  try {
    assertAuthConfig();
  } catch (err) {
    // Report before rethrowing: the throw is what stops the boot, but without
    // this the reason never reaches the error tracker.
    reportError("boot.config_invalid", err);
    throw err;
  }
}
