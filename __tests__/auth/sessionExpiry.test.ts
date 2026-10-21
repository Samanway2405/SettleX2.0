/** @jest-environment jsdom */

import {
  SESSION_REFRESH_SKEW_SECONDS,
  WALLET_CLAIM,
  LS_SESSION,
} from "@/lib/auth/constants";
import {
  isFresh,
  isSessionExpiringSoon,
  isSessionExpired,
  getSessionExpiryInfo,
  rebindRealtimeAuth,
  getWalletSession,
  getAuthenticatedClient,
  WalletSession,
} from "@/lib/supabase/session";

jest.mock("@/lib/freighter", () => ({
  signXDR: jest.fn(async (xdr: string) => `signed:${xdr}`),
}));

const mockSetAuth = jest.fn();
const mockRemoveAllChannels = jest.fn();

jest.mock("@supabase/supabase-js", () => ({
  createClient: jest.fn(() => ({
    realtime: { setAuth: mockSetAuth },
    removeAllChannels: mockRemoveAllChannels,
  })),
}));

const WALLET = "GDQNY3PBOJOKYZSRMK2S7LHHGWZIUISD4QORETLMXEWXBI7KFZZMKTL3";

function tokenFor(walletAddress: string, expSeconds: number): string {
  const b64 = (value: unknown) =>
    btoa(JSON.stringify(value))
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
  return [
    b64({ alg: "HS256", typ: "JWT" }),
    b64({ [WALLET_CLAIM]: walletAddress, exp: expSeconds }),
    "signature-not-checked-client-side",
  ].join(".");
}

describe("session expiry and realtime re-auth", () => {
  beforeEach(() => {
    window.localStorage.clear();
    mockSetAuth.mockClear();
    mockRemoveAllChannels.mockClear();
  });

  describe("freshness and expiration detection", () => {
    it("considers token fresh until actual expiry (does not drop 5 min early)", () => {
      const now = 1_000_000_000;
      // 2 minutes left before expiry (inside the 5-minute skew window)
      const session: WalletSession = {
        walletAddress: WALLET,
        accessToken: tokenFor(WALLET, Math.floor(now / 1000) + 120),
        expiresAt: now + 120_000,
      };

      expect(isFresh(session, now)).toBe(true);
      expect(isSessionExpiringSoon(session, now)).toBe(true);
      expect(isSessionExpired(session, now)).toBe(false);
    });

    it("marks token as not expiring soon when plenty of time remains", () => {
      const now = 1_000_000_000;
      // 30 minutes left
      const session: WalletSession = {
        walletAddress: WALLET,
        accessToken: tokenFor(WALLET, Math.floor(now / 1000) + 1800),
        expiresAt: now + 1800_000,
      };

      expect(isFresh(session, now)).toBe(true);
      expect(isSessionExpiringSoon(session, now)).toBe(false);
      expect(isSessionExpired(session, now)).toBe(false);
    });

    it("marks token as expired when past expiration time", () => {
      const now = 1_000_000_000;
      // Expired 10 seconds ago
      const session: WalletSession = {
        walletAddress: WALLET,
        accessToken: tokenFor(WALLET, Math.floor(now / 1000) - 10),
        expiresAt: now - 10_000,
      };

      expect(isFresh(session, now)).toBe(false);
      expect(isSessionExpiringSoon(session, now)).toBe(false);
      expect(isSessionExpired(session, now)).toBe(true);
    });
  });

  describe("getSessionExpiryInfo", () => {
    it("returns null when no session is stored", () => {
      expect(getSessionExpiryInfo(WALLET)).toBeNull();
    });

    it("returns correct countdown and flags for stored session", () => {
      const now = 1_000_000_000;
      const expSeconds = Math.floor(now / 1000) + 180; // 3 minutes left
      window.localStorage.setItem(
        LS_SESSION,
        JSON.stringify({
          walletAddress: WALLET,
          accessToken: tokenFor(WALLET, expSeconds),
          expiresAt: expSeconds * 1000,
        }),
      );

      const info = getSessionExpiryInfo(WALLET, now);
      expect(info).not.toBeNull();
      expect(info?.secondsRemaining).toBe(180);
      expect(info?.isExpiringSoon).toBe(true);
      expect(info?.isExpired).toBe(false);
    });

    it("reports isExpired = true when token has expired", () => {
      const now = 1_000_000_000;
      const expSeconds = Math.floor(now / 1000) - 30; // 30s ago
      window.localStorage.setItem(
        LS_SESSION,
        JSON.stringify({
          walletAddress: WALLET,
          accessToken: tokenFor(WALLET, expSeconds),
          expiresAt: expSeconds * 1000,
        }),
      );

      const info = getSessionExpiryInfo(WALLET, now);
      expect(info).not.toBeNull();
      expect(info?.secondsRemaining).toBe(0);
      expect(info?.isExpiringSoon).toBe(false);
      expect(info?.isExpired).toBe(true);
    });
  });

  describe("realtime auth re-binding", () => {
    it("rebindRealtimeAuth updates the realtime token", async () => {
      const initialToken = tokenFor(WALLET, Math.floor(Date.now() / 1000) + 3600);
      const client = await getAuthenticatedClient(WALLET, { interactive: false });
      // Initially null because no session was loaded
      expect(client).toBeNull();

      // Store a session and build the client
      window.localStorage.setItem(
        LS_SESSION,
        JSON.stringify({
          walletAddress: WALLET,
          accessToken: initialToken,
          expiresAt: Date.now() + 3600_000,
        }),
      );

      const activeClient = await getAuthenticatedClient(WALLET, { interactive: false });
      expect(activeClient).not.toBeNull();
      expect(mockSetAuth).toHaveBeenCalledWith(initialToken);

      // Now rebind with a new token
      const newToken = tokenFor(WALLET, Math.floor(Date.now() / 1000) + 7200);
      rebindRealtimeAuth(newToken);
      expect(mockSetAuth).toHaveBeenCalledWith(newToken);
    });
  });
});
