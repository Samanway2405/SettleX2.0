/** @jest-environment jsdom */

const WALLET_A = "GDQNY3PBOJOKYZSRMK2S7LHHGWZIUISD4QORETLMXEWXBI7KFZZMKTL3";
const WALLET_B = "GA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJVSGZ";
const mockRemoveAllChannels = jest.fn();

jest.mock("@/lib/freighter", () => ({
  signXDR: jest.fn(async (xdr: string) => `signed:${xdr}`),
}));

jest.mock("@supabase/supabase-js", () => ({
  createClient: jest.fn(() => ({ removeAllChannels: mockRemoveAllChannels })),
}));

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

async function flushPromises() {
  for (let index = 0; index < 12; index += 1) await Promise.resolve();
}

type Gate = ReturnType<typeof deferred>;
let session: typeof import("@/lib/supabase/session");
let verifyGates: Map<string, Gate>;
let challengeCalls: string[];
let verifyCalls: string[];

beforeEach(async () => {
  jest.resetModules();
  window.localStorage.clear();
  verifyGates = new Map();
  challengeCalls = [];
  verifyCalls = [];

  global.fetch = jest.fn(async (url: string, init: RequestInit) => {
    if (String(url).includes("/api/auth/session")) {
      return { ok: true, status: 200, json: async () => ({ session: null }) };
    }
    if (String(url).includes("/api/auth/signout")) {
      return { ok: true, status: 200, json: async () => ({ revoked: true }) };
    }

    const body = JSON.parse(String(init.body));
    const wallet: string = body.walletAddress;
    if (String(url).includes("challenge")) {
      challengeCalls.push(wallet);
      return {
        ok: true,
        status: 200,
        json: async () => ({
          transactionXdr: `xdr-for-${wallet}`,
          networkPassphrase: "Test SDF Network ; September 2015",
          challengeToken: `challenge-${wallet}`,
        }),
      };
    }

    verifyCalls.push(wallet);
    const gate = verifyGates.get(wallet);
    if (gate) await gate.promise;
    return {
      ok: true,
      status: 200,
      json: async () => ({
        walletAddress: wallet,
        expiresAt: new Date(Date.now() + 3600_000).toISOString(),
      }),
    };
  }) as unknown as typeof fetch;

  session = await import("@/lib/supabase/session");
});

function gateVerifyFor(wallet: string): Gate {
  const gate = deferred();
  verifyGates.set(wallet, gate);
  return gate;
}

describe("concurrent wallet handshakes", () => {
  it("does not hand wallet B the session metadata minted for wallet A", async () => {
    const gateA = gateVerifyFor(WALLET_A);
    const promiseA = session.getWalletSession(WALLET_A);
    await flushPromises();
    const promiseB = session.getWalletSession(WALLET_B);
    gateA.resolve();

    const [resultA, resultB] = await Promise.all([promiseA, promiseB]);
    expect(resultA?.walletAddress).toBe(WALLET_A);
    expect(resultB?.walletAddress).toBe(WALLET_B);
    expect(resultB).not.toHaveProperty("accessToken");
    expect(challengeCalls).toContain(WALLET_B);
    expect(verifyCalls).toContain(WALLET_B);
  });

  it("deduplicates simultaneous handshakes for the same wallet", async () => {
    const gate = gateVerifyFor(WALLET_A);
    const first = session.getWalletSession(WALLET_A);
    await flushPromises();
    const second = session.getWalletSession(WALLET_A);
    gate.resolve();

    const [a, b] = await Promise.all([first, second]);
    expect(a).toEqual(b);
    expect(challengeCalls.filter((wallet) => wallet === WALLET_A)).toHaveLength(1);
  });

  it("creates a browser client without a bearer token", async () => {
    const gate = gateVerifyFor(WALLET_A);
    const clientA = session.getAuthenticatedClient(WALLET_A);
    await flushPromises();
    const clientB = session.getAuthenticatedClient(WALLET_B);
    gate.resolve();

    await Promise.all([clientA, clientB]);
    const { createClient } = require("@supabase/supabase-js");
    const createClientMock = createClient as jest.Mock;
    const options = createClientMock.mock.calls[0][2];
    expect(options.global.headers).toBeUndefined();
    expect(options.global.fetch).toEqual(expect.any(Function));
  });

  it("rejects when the server returns session metadata for a different wallet", async () => {
    global.fetch = jest.fn(async (url: string, init: RequestInit) => {
      if (String(url).includes("/api/auth/session")) {
        return { ok: true, status: 200, json: async () => ({ session: null }) };
      }
      const body = JSON.parse(String(init.body));
      if (String(url).includes("challenge")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            transactionXdr: "xdr",
            networkPassphrase: "Test SDF Network ; September 2015",
            challengeToken: "challenge",
          }),
        };
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({
          walletAddress: WALLET_A,
          expiresAt: new Date(Date.now() + 3600_000).toISOString(),
        }),
      };
    }) as unknown as typeof fetch;

    await expect(session.getWalletSession(WALLET_B)).rejects.toThrow(/different wallet/i);
  });

  it("does not let a handshake finish after sign-out", async () => {
    const gate = gateVerifyFor(WALLET_A);
    const pending = session.getWalletSession(WALLET_A);
    await flushPromises();

    await session.clearWalletSession();
    gate.resolve();
    await expect(pending).rejects.toThrow(/cancelled/i);

    const before = challengeCalls.filter((wallet) => wallet === WALLET_A).length;
    await session.getWalletSession(WALLET_A);
    expect(challengeCalls.filter((wallet) => wallet === WALLET_A).length).toBeGreaterThan(before);
  });
});
