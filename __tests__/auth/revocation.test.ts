import { SIGNOUT_ENDPOINT } from "@/lib/auth/constants";
import { issueAccessToken, verifyJwt } from "@/lib/auth/jwt";
import {
  RevocationUnavailable,
  isRevocationConfigured,
  revokeToken,
  revokeWallet,
} from "@/lib/auth/revocation";

const SECRET = "test-jwt-secret";
const SERVICE_KEY = "test-service-role-key";
const WALLET = "GDQNY3PBOJOKYZSRMK2S7LHHGWZIUISD4QORETLMXEWXBI7KFZZMKTL3";

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
}

const originalFetch = global.fetch;

describe("issueAccessToken", () => {
  it("carries a unique jti so a single token can be denied", () => {
    const a = issueAccessToken({ walletAddress: WALLET, secret: SECRET, ttlSeconds: 3600 });
    const b = issueAccessToken({ walletAddress: WALLET, secret: SECRET, ttlSeconds: 3600 });

    expect(a.jti).toEqual(expect.any(String));
    expect(a.jti).not.toBe(b.jti);

    const claims = verifyJwt(a.token, SECRET);
    expect(claims?.jti).toBe(a.jti);
    // The wallet claim is a computed key, so assert it survived the change.
    expect(claims?.wallet_address).toBe(WALLET);
  });
});

describe("revocation", () => {
  beforeEach(() => {
    process.env.SUPABASE_SERVICE_ROLE_KEY = SERVICE_KEY;
  });

  afterEach(() => {
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    global.fetch = originalFetch;
  });

  it("is configured only when the service role key is present", () => {
    expect(isRevocationConfigured()).toBe(true);

    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    expect(isRevocationConfigured()).toBe(false);
  });

  it("writes the denylist with the service role key, never the anon key", async () => {
    const fetchMock = jest.fn(async () => jsonResponse(null));
    global.fetch = fetchMock as unknown as typeof fetch;

    await revokeToken({ jti: "token-id", walletAddress: WALLET, expiresAt: 1_800_000_000 });

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain("/rest/v1/rpc/settlex_revoke_token");
    expect((init.headers as Record<string, string>).apikey).toBe(SERVICE_KEY);
    expect(JSON.parse(String(init.body))).toEqual({
      p_jti: "token-id",
      p_wallet_address: WALLET,
      p_expires_at: new Date(1_800_000_000 * 1000).toISOString(),
    });
  });

  it("revokes every token for a wallet on sign out everywhere", async () => {
    const fetchMock = jest.fn(async () => jsonResponse(1));
    global.fetch = fetchMock as unknown as typeof fetch;

    await revokeWallet(WALLET);

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain("/rest/v1/rpc/settlex_revoke_wallet");
    expect(JSON.parse(String(init.body))).toEqual({ p_wallet_address: WALLET });
  });

  it("passes optional p_ttl_seconds when ttlSeconds is provided to revokeWallet", async () => {
    const fetchMock = jest.fn(async () => jsonResponse(1));
    global.fetch = fetchMock as unknown as typeof fetch;

    await revokeWallet(WALLET, 50000);

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain("/rest/v1/rpc/settlex_revoke_wallet");
    expect(JSON.parse(String(init.body))).toEqual({
      p_wallet_address: WALLET,
      p_ttl_seconds: 50000,
    });
  });


  it("raises RevocationUnavailable when the denylist write fails", async () => {
    global.fetch = (async () => jsonResponse({}, 500)) as unknown as typeof fetch;

    await expect(
      revokeToken({ jti: "j", walletAddress: WALLET, expiresAt: 1_800_000_000 }),
    ).rejects.toBeInstanceOf(RevocationUnavailable);
  });

  it("raises rather than silently succeeding when no service key is set", async () => {
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;

    await expect(
      revokeToken({ jti: "j", walletAddress: WALLET, expiresAt: 1_800_000_000 }),
    ).rejects.toBeInstanceOf(RevocationUnavailable);
  });
});

describe("SIGNOUT_ENDPOINT", () => {
  it("is a same-origin route so the token never leaves the app", () => {
    expect(SIGNOUT_ENDPOINT.startsWith("/")).toBe(true);
  });
});
