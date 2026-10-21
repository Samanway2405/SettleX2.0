/** @jest-environment jsdom */

import {
  isFresh,
  isSessionExpiringSoon,
  isSessionExpired,
  getSessionExpiryInfo,
  getWalletSession,
  getAuthenticatedClient,
  clearWalletSession,
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

function sessionResponse(walletAddress: string, expiresAt: number) {
  return {
    ok: true,
    status: 200,
    json: async () => ({ session: { walletAddress, expiresAt } }),
  };
}

describe("HttpOnly wallet session metadata and expiry", () => {
  beforeEach(async () => {
    window.localStorage.clear();
    mockRemoveAllChannels.mockClear();
    const { createClient } = require("@supabase/supabase-js");
    createClient.mockClear();
    global.fetch = jest.fn(async () => sessionResponse(WALLET, Date.now() + 60 * 60_000))
      as unknown as typeof fetch;
    await clearWalletSession();
    jest.clearAllMocks();
  });

  it("considers a session fresh until actual expiry", () => {
    const now = 1_000_000_000;
    const session: WalletSession = { walletAddress: WALLET, expiresAt: now + 120_000 };
    expect(isFresh(session, now)).toBe(true);
    expect(isSessionExpiringSoon(session, now)).toBe(true);
    expect(isSessionExpired(session, now)).toBe(false);
  });

  it("marks a session as expired when it passes its expiry", () => {
    const session: WalletSession = { walletAddress: WALLET, expiresAt: 1000 };
    expect(isFresh(session, 2000)).toBe(false);
    expect(isSessionExpiringSoon(session, 2000)).toBe(false);
    expect(isSessionExpired(session, 2000)).toBe(true);
  });

  it("loads only non-secret identity and expiry metadata from the server", async () => {
    const expiresAt = Date.now() + 180_000;
    global.fetch = jest.fn(async () => sessionResponse(WALLET, expiresAt)) as unknown as typeof fetch;

    const session = await getWalletSession(WALLET, { interactive: false });
    expect(session).toEqual({ walletAddress: WALLET, expiresAt });
    expect(session).not.toHaveProperty("accessToken");
    expect(getSessionExpiryInfo(WALLET)?.secondsRemaining).toBeGreaterThan(0);
  });

  it("does not use a token-bearing Supabase client configuration", async () => {
    await getAuthenticatedClient(WALLET, { interactive: false });

    const { createClient } = require("@supabase/supabase-js");
    expect(createClientMock).toHaveBeenCalledTimes(1);
    const options = createClient.mock.calls[0][2];
    expect(options.global.headers).toBeUndefined();
    expect(options.global.fetch).toEqual(expect.any(Function));
    expect(options.auth.persistSession).toBe(false);
  });
});
