import { POST } from "@/app/api/auth/verify/route";
import * as challenge from "@/lib/auth/challenge";
import * as rateLimit from "@/lib/auth/rateLimit";
import { SESSION_COOKIE_NAME } from "@/lib/auth/sessionCookie";

jest.mock("@/lib/auth/challenge", () => ({
  isValidWalletAddress: jest.fn(() => true),
  verifyChallengeShared: jest.fn(),
}));

describe("POST /api/auth/verify", () => {
  const walletAddress = "GDQNY3PBOJOKYZSRMK2S7LHHGWZIUISD4QORETLMXEWXBI7KFZZMKTL3";
  const secret = "test-jwt-secret";

  beforeEach(() => {
    process.env.SUPABASE_JWT_SECRET = secret;
    process.env.AUTH_CHALLENGE_SECRET = "test-challenge-secret";
    jest.spyOn(rateLimit, "enforceRateLimit").mockResolvedValue({
      allowed: true,
      retryAfter: 0,
    });
    jest.mocked(challenge.verifyChallengeShared).mockResolvedValue({
      ok: true,
      walletAddress,
    } as Awaited<ReturnType<typeof challenge.verifyChallengeShared>>);
  });

  afterEach(() => {
    delete process.env.SUPABASE_JWT_SECRET;
    delete process.env.AUTH_CHALLENGE_SECRET;
    jest.restoreAllMocks();
  });

  it("sets an HttpOnly cookie and does not return the bearer token", async () => {
    const response = await POST(new Request("http://localhost/api/auth/verify", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        walletAddress,
        signedTransactionXdr: "signed-xdr",
        challengeToken: "challenge",
      }),
    }));
    const json = await response.json();
    const cookie = response.headers.get("set-cookie") ?? "";

    expect(response.status).toBe(200);
    expect(json).toMatchObject({ walletAddress });
    expect(json).not.toHaveProperty("accessToken");
    expect(cookie).toContain(`${SESSION_COOKIE_NAME}=`);
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toMatch(/SameSite=Lax/i);
    expect(cookie).toContain("Path=/");
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });
});
