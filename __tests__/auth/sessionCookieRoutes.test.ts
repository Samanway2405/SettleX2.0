import { GET } from "@/app/api/auth/session/route";
import { issueAccessToken } from "@/lib/auth/jwt";
import { SESSION_COOKIE_NAME } from "@/lib/auth/sessionCookie";

describe("GET /api/auth/session", () => {
  const secret = "test-jwt-secret";
  const walletAddress = "GDQNY3PBOJOKYZSRMK2S7LHHGWZIUISD4QORETLMXEWXBI7KFZZMKTL3";

  beforeEach(() => {
    process.env.SUPABASE_JWT_SECRET = secret;
  });

  afterEach(() => {
    delete process.env.SUPABASE_JWT_SECRET;
  });

  it("returns only verified identity and expiry metadata", async () => {
    const { token, expiresAt } = issueAccessToken({
      walletAddress,
      secret,
      ttlSeconds: 3600,
    });
    const response = await GET(new Request("http://localhost/api/auth/session", {
      headers: { cookie: `${SESSION_COOKIE_NAME}=${token}` },
    }));
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json).toEqual({
      session: {
        walletAddress,
        expiresAt: Date.parse(expiresAt),
      },
    });
    expect(JSON.stringify(json)).not.toContain(token);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });

  it("clears an invalid session cookie and reports no session", async () => {
    const response = await GET(new Request("http://localhost/api/auth/session", {
      headers: { cookie: `${SESSION_COOKIE_NAME}=invalid.token.value` },
    }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ session: null });
    expect(response.headers.get("set-cookie")).toContain(`${SESSION_COOKIE_NAME}=`);
  });
});
