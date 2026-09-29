/**
 * Fixed-window rate limiter for the unauthenticated auth routes.
 *
 * Both routes do public-key cryptography on caller-supplied input, so they are
 * worth throttling. `enforceRateLimit` counts against a window shared by every
 * instance (Postgres, via `lib/auth/sharedStore`) so the configured limit is
 * the real limit rather than the limit times the instance count. The in-memory
 * `rateLimit` below is the fallback for deployments with no shared store
 * configured; it applies per process and only blunts casual abuse.
 *
 * Neither is a substitute for an edge/WAF rate limit in front of the
 * deployment.
 */
import { isSharedStoreConfigured, rateLimitShared } from "@/lib/auth/sharedStore";
import { reportError } from "@/lib/observability/logger";

interface Window {
  count: number;
  resetAt: number;
}

const windows = new Map<string, Window>();

export interface RateLimitResult {
  allowed: boolean;
  /** Seconds until the caller may retry. */
  retryAfter: number;
}

export function rateLimit(
  key: string,
  limit: number,
  windowMs: number,
  now: number = Date.now(),
): RateLimitResult {
  for (const [existing, window] of windows) {
    if (window.resetAt <= now) windows.delete(existing);
  }

  const window = windows.get(key);
  if (!window || window.resetAt <= now) {
    windows.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, retryAfter: 0 };
  }

  window.count += 1;
  if (window.count > limit) {
    return { allowed: false, retryAfter: Math.ceil((window.resetAt - now) / 1000) };
  }
  return { allowed: true, retryAfter: 0 };
}

/** Test hook — drops every tracked window. */
export function resetRateLimits(): void {
  windows.clear();
}

/**
 * Counts one request against the shared window, falling back to the in-memory
 * window when no shared store is configured or it cannot be reached.
 *
 * Unlike the replay guard this fails *open* onto the local limiter: a database
 * blip should throttle harder than usual, not lock every caller out of signing
 * in.
 */
export async function enforceRateLimit(
  key: string,
  limit: number,
  windowMs: number,
): Promise<RateLimitResult> {
  if (isSharedStoreConfigured()) {
    try {
      return await rateLimitShared(key, limit, windowMs);
    } catch (err) {
      // Reported, not printed: the fallback silently weakens the limit to
      // per-instance, so the real rate limit becomes limit × instance count.
      reportError("auth.shared_rate_limit_unavailable", err, {
        fields: { fallback: "in_memory" },
      });
    }
  }
  return rateLimit(key, limit, windowMs);
}

/**
 * Best-effort client identity for rate limiting. Proxy headers are spoofable,
 * so this only ever widens the key space — it never grants access.
 */
export function clientKey(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
  return request.headers.get("x-real-ip") ?? "unknown";
}
