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
 */
import { NextResponse } from "next/server";
import { verifyJwt } from "@/lib/auth/jwt";
import { WALLET_CLAIM } from "@/lib/auth/constants";
import { clientKey, enforceRateLimit } from "@/lib/auth/rateLimit";
import {
  RevocationUnavailable,
  isRevocationConfigured,
  revokeToken,
  revokeWallet,
} from "@/lib/auth/revocation";
import { AuthConfigError, getJwtSecret } from "@/lib/auth/serverConfig";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" } as const;

export async function POST(request: Request) {
  const limit = await enforceRateLimit(`signout:${clientKey(request)}`, 30, 60_000);
  if (!limit.allowed) {
    return NextResponse.json(
      { error: "Too many requests. Please wait a moment." },
      { status: 429, headers: { ...NO_STORE, "Retry-After": String(limit.retryAfter) } },
    );
  }

  const header = request.headers.get("authorization") ?? "";
  const token = header.toLowerCase().startsWith("bearer ") ? header.slice(7).trim() : "";
  if (!token) {
    return NextResponse.json(
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
      return NextResponse.json(
        { error: "That access token is not valid." },
        { status: 401, headers: NO_STORE },
      );
    }

    const walletAddress = claims[WALLET_CLAIM];
    const jti = claims.jti;
    const exp = claims.exp;
    if (typeof walletAddress !== "string" || typeof exp !== "number") {
      return NextResponse.json(
        { error: "That access token is not valid." },
        { status: 401, headers: NO_STORE },
      );
    }

    if (!isRevocationConfigured()) {
      // Say so plainly rather than reporting a sign-out that did not happen.
      console.error("Sign-out cannot revoke: SUPABASE_SERVICE_ROLE_KEY is not set.");
      return NextResponse.json(
        { error: "Server-side sign-out is not configured on this server." },
        { status: 503, headers: NO_STORE },
      );
    }

    if (everywhere) {
      await revokeWallet(walletAddress);
    } else {
      if (typeof jti !== "string") {
        // Tokens minted before `jti` existed cannot be denied individually.
        return NextResponse.json(
          { error: "This session predates revocation support — sign out everywhere instead." },
          { status: 409, headers: NO_STORE },
        );
      }
      await revokeToken({ jti, walletAddress, expiresAt: exp });
    }

    return NextResponse.json({ revoked: true, everywhere }, { headers: NO_STORE });
  } catch (err) {
    if (err instanceof AuthConfigError) {
      console.error("Wallet auth is not configured:", err.message);
      return NextResponse.json(
        { error: "Wallet authentication is not configured on this server." },
        { status: 503, headers: NO_STORE },
      );
    }
    if (err instanceof RevocationUnavailable) {
      // Fail loudly: the browser must not report a sign-out that did not happen.
      console.error("Token revocation failed:", err.message);
      return NextResponse.json(
        { error: "Could not sign out. Please try again." },
        { status: 503, headers: { ...NO_STORE, "Retry-After": "5" } },
      );
    }
    console.error("Failed to sign out:", err);
    return NextResponse.json(
      { error: "Could not sign out." },
      { status: 500, headers: NO_STORE },
    );
  }
}
