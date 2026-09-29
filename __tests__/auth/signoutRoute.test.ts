import { POST } from "@/app/api/auth/signout/route";
import * as rateLimitModule from "@/lib/auth/rateLimit";
import { issueAccessToken } from "@/lib/auth/jwt";

describe("POST /api/auth/signout", () => {
  const SECRET = "test-jwt-secret";
  const SERVICE_KEY = "test-service-role-key";
  const WALLET = "GDQNY3PBOJOKYZSRMK2S7LHHGWZIUISD4QORETLMXEWXBI7KFZZMKTL3";

  beforeEach(() => {
    process.env.SUPABASE_JWT_SECRET = SECRET;
    process.env.SUPABASE_SERVICE_ROLE_KEY = SERVICE_KEY;
    rateLimitModule.resetRateLimits();
  });

  afterEach(() => {
    delete process.env.SUPABASE_JWT_SECRET;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    jest.restoreAllMocks();
  });

  it("enforces rate limits using enforceRateLimit", async () => {
    const enforceSpy = jest.spyOn(rateLimitModule, "enforceRateLimit").mockResolvedValue({
      allowed: false,
      retryAfter: 45,
    });

    const request = new Request("http://localhost/api/auth/signout", {
      method: "POST",
      headers: {
        "x-forwarded-for": "10.0.0.1",
      },
    });

    const response = await POST(request);
    expect(enforceSpy).toHaveBeenCalledWith("signout:10.0.0.1", 30, 60_000);
    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("45");
    const json = await response.json();
    expect(json).toEqual({ error: "Too many requests. Please wait a moment." });
  });

  it("proceeds to authentication check when rate limit allows", async () => {
    const enforceSpy = jest.spyOn(rateLimitModule, "enforceRateLimit").mockResolvedValue({
      allowed: true,
      retryAfter: 0,
    });

    const request = new Request("http://localhost/api/auth/signout", {
      method: "POST",
      headers: {
        "x-forwarded-for": "10.0.0.2",
      },
    });

    const response = await POST(request);
    expect(enforceSpy).toHaveBeenCalledWith("signout:10.0.0.2", 30, 60_000);
    // No Authorization header provided, returns 401
    expect(response.status).toBe(401);
    const json = await response.json();
    expect(json).toEqual({ error: "An access token is required." });
  });

  it("successfully revokes token when authenticated", async () => {
    jest.spyOn(rateLimitModule, "enforceRateLimit").mockResolvedValue({
      allowed: true,
      retryAfter: 0,
    });

    const fetchMock = jest.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => null,
    }));
    global.fetch = fetchMock as unknown as typeof fetch;

    const { token } = issueAccessToken({
      walletAddress: WALLET,
      secret: SECRET,
      ttlSeconds: 3600,
    });

    const request = new Request("http://localhost/api/auth/signout", {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ everywhere: false }),
    });

    const response = await POST(request);
    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json).toEqual({ revoked: true, everywhere: false });
  });
});

