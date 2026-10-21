/** @jest-environment jsdom */

import { LS_SESSION } from "@/lib/auth/constants";
import { getWalletSession, hasProvenSession } from "@/lib/supabase/session";

jest.mock("@/lib/freighter", () => ({
  signXDR: jest.fn(),
}));

const WALLET = "GDQNY3PBOJOKYZSRMK2S7LHHGWZIUISD4QORETLMXEWXBI7KFZZMKTL3";

describe("legacy browser-stored session tokens", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("removes the old localStorage token and requires a server-confirmed cookie", async () => {
    window.localStorage.setItem(
      LS_SESSION,
      JSON.stringify({
        walletAddress: WALLET,
        accessToken: "attacker-controlled.jwt.value",
        expiresAt: Date.now() + 60 * 60_000,
      }),
    );
    global.fetch = jest.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ session: null }),
    })) as unknown as typeof fetch;

    await expect(getWalletSession(WALLET, { interactive: false })).resolves.toBeNull();
    expect(window.localStorage.getItem(LS_SESSION)).toBeNull();
    expect(hasProvenSession(WALLET)).toBe(false);
  });
});
