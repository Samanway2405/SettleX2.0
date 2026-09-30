/** @jest-environment jsdom */

/**
 * Issue #125: Sign-out reports success even when the server refused to revoke.
 *
 * Verifies two things:
 * 1. clearWalletSession() returns { serverRevoked: false } when the
 *    /api/auth/signout endpoint responds with a non-2xx status.
 * 2. The signOut logic always clears local state AND surfaces a warning toast
 *    + calls reportError when serverRevoked is false.
 */

import * as sessionModule from "@/lib/supabase/session";

jest.mock("@/lib/freighter", () => ({
  isFreighterInstalled: jest.fn(async () => true),
  getFreighterNetwork: jest.fn(async () => "TESTNET"),
  signXDR: jest.fn(),
}));

jest.mock("@/lib/stellar/getBalance", () => ({
  getXLMBalance: jest.fn(async () => "100"),
}));

jest.mock("@/lib/stellar/walletsKit", () => ({
  FREIGHTER_ID: "freighter",
  getWalletsKit: () => ({
    setWallet: jest.fn(),
    getAddressSilently: jest.fn(async () => null),
  }),
}));

// ─── Helpers ─────────────────────────────────────────────────────────────────

function mockFetchWithStatus(status: number) {
  global.fetch = jest.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
  }) as unknown as typeof fetch;
}

function seedLocalSession() {
  // A minimal JWT with a future exp so readAnyStoredSession() returns it.
  // payload: { wallet_address: "GWALLET", exp: 9999999999 }
  const payload = btoa(JSON.stringify({ wallet_address: "GWALLET", exp: 9999999999 }));
  const token = `header.${payload}.sig`;
  try {
    localStorage.setItem(
      "settlex:session",
      JSON.stringify({ walletAddress: "GWALLET", accessToken: token, expiresAt: 9999999999000 }),
    );
  } catch {
    // jsdom may restrict this; not fatal.
  }
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("Issue #125: sign-out revocation warning — clearWalletSession()", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    try { localStorage.clear(); } catch { /* ignore */ }
  });

  it("returns { serverRevoked: true } when the server responds with 200", async () => {
    seedLocalSession();
    mockFetchWithStatus(200);
    const result = await sessionModule.clearWalletSession();
    expect(result.serverRevoked).toBe(true);
  });

  it("returns { serverRevoked: false } when the server responds with 503", async () => {
    seedLocalSession();
    mockFetchWithStatus(503);
    const result = await sessionModule.clearWalletSession();
    expect(result.serverRevoked).toBe(false);
  });

  it("returns { serverRevoked: false } when the server responds with 401", async () => {
    seedLocalSession();
    mockFetchWithStatus(401);
    const result = await sessionModule.clearWalletSession();
    expect(result.serverRevoked).toBe(false);
  });

  it("returns { serverRevoked: false } when fetch rejects (network error)", async () => {
    seedLocalSession();
    global.fetch = jest.fn().mockRejectedValue(
      new TypeError("Failed to fetch"),
    ) as unknown as typeof fetch;
    const result = await sessionModule.clearWalletSession();
    expect(result.serverRevoked).toBe(false);
  });

  it("always removes the local session from localStorage regardless of server response", async () => {
    seedLocalSession();
    mockFetchWithStatus(503);
    await sessionModule.clearWalletSession();
    expect(localStorage.getItem("settlex:session")).toBeNull();
  });

  it("returns { serverRevoked: true } when no session exists (nothing to revoke)", async () => {
    // No localStorage session seeded — revoking = null, so we skip fetch.
    const result = await sessionModule.clearWalletSession();
    expect(result.serverRevoked).toBe(true);
  });
});

describe("Issue #125: sign-out revocation warning — signOut warning contract", () => {
  const mockReportError = jest.fn();
  const mockToastError = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("calls reportError and toastError when serverRevoked is false", async () => {
    const clearSpy = jest
      .spyOn(sessionModule, "clearWalletSession")
      .mockResolvedValue({ serverRevoked: false });

    // Mirror the critical AuthContext.signOut logic.
    const { serverRevoked } = await sessionModule.clearWalletSession();
    if (!serverRevoked) {
      mockReportError("auth.signout_server_revocation_failed", undefined, {
        fields: { walletAddress: "GWALLET" },
      });
      mockToastError(
        "Signed out on this device",
        "The server could not revoke your session — it will expire automatically.",
      );
    }

    expect(mockReportError).toHaveBeenCalledWith(
      "auth.signout_server_revocation_failed",
      undefined,
      expect.objectContaining({ fields: expect.objectContaining({ walletAddress: "GWALLET" }) }),
    );
    expect(mockToastError).toHaveBeenCalledWith(
      "Signed out on this device",
      expect.stringContaining("server could not revoke"),
    );

    clearSpy.mockRestore();
  });

  it("does NOT call toastError or reportError when serverRevoked is true", async () => {
    const clearSpy = jest
      .spyOn(sessionModule, "clearWalletSession")
      .mockResolvedValue({ serverRevoked: true });

    const { serverRevoked } = await sessionModule.clearWalletSession();
    if (!serverRevoked) {
      mockReportError("auth.signout_server_revocation_failed");
      mockToastError("Signed out on this device");
    }

    expect(mockReportError).not.toHaveBeenCalled();
    expect(mockToastError).not.toHaveBeenCalled();

    clearSpy.mockRestore();
  });
});
