import { POST } from "@/app/api/supabase/[...path]/route";
import { issueAccessToken } from "@/lib/auth/jwt";
import { SESSION_COOKIE_NAME } from "@/lib/auth/sessionCookie";

describe("authenticated Supabase REST proxy", () => {
  const secret = "test-jwt-secret";
  const walletAddress = "GDQNY3PBOJOKYZSRMK2S7LHHGWZIUISD4QORETLMXEWXBI7KFZZMKTL3";
  const anonKey = "test-anon-key";

  beforeEach(() => {
    process.env.SUPABASE_JWT_SECRET = secret;
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = anonKey;
  });

  afterEach(() => {
    delete process.env.SUPABASE_JWT_SECRET;
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    jest.restoreAllMocks();
  });

  function requestWithCookie(token: string, origin = "http://localhost") {
    return new Request("http://localhost/api/supabase/rest/v1/expenses", {
      method: "POST",
      headers: {
        cookie: `${SESSION_COOKIE_NAME}=${token}`,
        origin,
        "content-type": "application/json",
        prefer: "return=representation",
      },
      body: JSON.stringify({ title: "Dinner" }),
    });
  }

  it("forwards the HttpOnly cookie JWT to PostgREST, not the browser", async () => {
    const { token } = issueAccessToken({ walletAddress, secret, ttlSeconds: 3600 });
    const upstream = jest.fn(async (_url: URL, init: RequestInit) => {
      const headers = new Headers(init.headers);
      expect(headers.get("authorization")).toBe(`Bearer ${token}`);
      expect(headers.get("apikey")).toBe(anonKey);
      expect(headers.get("prefer")).toBe("return=representation");
      expect(headers.get("cookie")).toBeNull();
      return new Response(JSON.stringify([{ id: "expense-1" }]), {
        status: 201,
        headers: { "content-type": "application/json", "content-range": "0-0/1" },
      });
    });
    global.fetch = upstream as unknown as typeof fetch;

    const request = requestWithCookie(token);
    const response = await POST(request, { params: { path: ["rest", "v1", "expenses"] } });

    expect(response.status).toBe(201);
    expect(await response.json()).toEqual([{ id: "expense-1" }]);
    expect(upstream).toHaveBeenCalledWith(
      new URL("https://example.supabase.co/rest/v1/expenses"),
      expect.objectContaining({ method: "POST", cache: "no-store" }),
    );
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });

  it("rejects cross-origin writes", async () => {
    const upstream = jest.fn();
    global.fetch = upstream as unknown as typeof fetch;

    const { token } = issueAccessToken({ walletAddress, secret, ttlSeconds: 3600 });
    const response = await POST(requestWithCookie(token, "https://attacker.example"), {
      params: { path: ["rest", "v1", "expenses"] },
    });

    expect(response.status).toBe(403);
    expect(upstream).not.toHaveBeenCalled();
  });

  it("rejects unauthenticated requests without contacting Supabase", async () => {
    const upstream = jest.fn();
    global.fetch = upstream as unknown as typeof fetch;
    const request = new Request("http://localhost/api/supabase/rest/v1/expenses", {
      method: "POST",
      headers: { origin: "http://localhost" },
      body: "{}",
    });

    const response = await POST(request, { params: { path: ["rest", "v1", "expenses"] } });
    expect(response.status).toBe(401);
    expect(upstream).not.toHaveBeenCalled();
  });
});
