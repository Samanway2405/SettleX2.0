import { NextResponse } from "next/server";
import { verifyJwt } from "@/lib/auth/jwt";
import { getSessionCookie, clearSessionCookie } from "@/lib/auth/sessionCookie";
import { AuthConfigError, getJwtSecret } from "@/lib/auth/serverConfig";
import { WALLET_CLAIM } from "@/lib/auth/constants";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" } as const;

export async function GET(request: Request) {
  const token = getSessionCookie(request);
  if (!token) {
    return NextResponse.json({ session: null }, { headers: NO_STORE });
  }

  try {
    const claims = verifyJwt(token, getJwtSecret());
    const walletAddress = claims?.[WALLET_CLAIM];
    const expiresAt = claims?.exp;
    if (
      !claims ||
      typeof walletAddress !== "string" ||
      claims.role !== "authenticated" ||
      typeof expiresAt !== "number"
    ) {
      const response = NextResponse.json({ session: null }, { headers: NO_STORE });
      clearSessionCookie(response);
      return response;
    }

    return NextResponse.json(
      { session: { walletAddress, expiresAt: expiresAt * 1000 } },
      { headers: NO_STORE },
    );
  } catch (error) {
    if (error instanceof AuthConfigError) {
      return NextResponse.json(
        { error: "Wallet authentication is not configured on this server." },
        { status: 503, headers: NO_STORE },
      );
    }
    throw error;
  }
}
