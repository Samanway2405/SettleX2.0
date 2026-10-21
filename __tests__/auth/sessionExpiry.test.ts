/** @jest-environment jsdom */

import {
  type WalletSession,
} from "@/lib/supabase/session";

jest.mock("@/lib/freighter", () => ({
  signXDR: jest.fn(),
}));

const mockRemoveAllChannels = jest.fn();
jest.mock("@supabase/supabase-js", () => ({
  createClient: jest.fn(() => ({ removeAllChannels: mockRemoveAllChannels })),
}));

const WALLET = "GDQNY3PBOJOKYZSRMK2S7LHHGWZIUISD4QORETLMXEWXBI7KFZZMKTL3";
let sessionModule: typeof import("@/lib/supabase/session");

function sessionResponse(walletAddress: string, expiresAt: number) {
  return {
    ok: true,
    status: 200,
    json: async () => ({ session: { walletAddress, expiresAt } }),
  };
}

describe("HttpOnly wallet session metadata and expiry", () => {
  beforeEach(async () => {
    jest.resetModules();
    window.localStorage.clear();
    mockRemoveAllChannels.mockClear();
    global.fetch = jest.fn(async () =>
      sessionResponse(WALLET, Date.now() + 60 * 60_000),
    ) as unknown as typeof fetch;
    sessionModule = await import("@/lib/supabase/session");
    await sessionModule.clearWalletSession();
    jest.clearAllMocks();
  });

  it("considers a session fresh until actual expiry", () => {
    const now = 1_000_000_000;
    const session: WalletSession = { walletAddress: WALLET, expiresAt: now + 120_000 };
    expect(sessionModule.isFresh(session, now)).toBe(true);
    expect(sessionModule.isSessionExpiringSoon(session, now)).toBe(true);
    expect(sessionModule.isSessionExpired(session, now)).toBe(false);
  });

  it("marks a session as expired when it passes its expiry", () => {
    const session: WalletSession = { walletAddress: WALLET, expiresAt: 1000 };
    expect(sessionModule.isFresh(session, 2000)).toBe(false);
    expect(sessionModule.isSessionExpiringSoon(session, 2000)).toBe(false);
    expect(sessionModule.isSessionExpired(session, 2000)).toBe(true);
  });

  it("loads only non-secret identity and expiry metadata from the server", async () => {
    const expiresAt = Date.now() + 180_000;
    const fetchMock = jest.fn(async () => sessionResponse(WALLET, expiresAt));
    global.fetch = fetchMock as unknown as typeof fetch;

    const activeSession = await sessionModule.getWalletSession(WALLET, { interactive: false });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/auth/session",
      expect.objectContaining({ method: "GET", cache: "no-store" }),
    );
    expect(activeSession).toEqual({ walletAddress: WALLET, expiresAt });
    expect(activeSession).not.toHaveProperty("accessToken");
    expect(sessionModule.getSessionExpiryInfo(WALLET)?.secondsRemaining).toBeGreaterThan(0);
  });

  it("does not use a token-bearing Supabase client configuration", async () => {
    await sessionModule.getAuthenticatedClient(WALLET, { interactive: false });

    const { createClient } = require("@supabase/supabase-js");
    expect(createClient).toHaveBeenCalledTimes(1);
    const options = createClient.mock.calls[0][2];
    expect(options.global.headers).toBeUndefined();
    expect(options.global.fetch).toEqual(expect.any(Function));
    expect(options.auth.persistSession).toBe(false);
  });
});
