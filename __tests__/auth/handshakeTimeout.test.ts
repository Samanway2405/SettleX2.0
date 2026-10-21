/** @jest-environment jsdom */

/**
 * Regression tests for "the auth handshake has no request timeout".
 *
 * The bug: postJson called fetch with no abort signal, so a hung connection
 * left the handshake promise pending forever. Because that promise is shared
 * by every concurrent caller, the whole app sat on its loading state with no
 * way to recover short of a reload.
 */
import { AUTH_REQUEST_TIMEOUT_MS } from "@/lib/auth/constants";

const WALLET = "GDQNY3PBOJOKYZSRMK2S7LHHGWZIUISD4QORETLMXEWXBI7KFZZMKTL3";

jest.mock("@/lib/freighter", () => ({
  signXDR: jest.fn(async (xdr: string) => `signed:${xdr}`),
}));

jest.mock("@supabase/supabase-js", () => ({
  createClient: jest.fn(() => ({
    realtime: { setAuth: jest.fn() },
    removeAllChannels: jest.fn(),
  })),
}));

let session: typeof import("@/lib/supabase/session");

beforeEach(async () => {
  jest.resetModules();
  jest.useFakeTimers();
  window.localStorage.clear();
  session = await import("@/lib/supabase/session");
});

afterEach(() => {
  jest.useRealTimers();
});

/** A fetch that never settles unless its signal aborts. */
function hangingFetch() {
  return jest.fn(
    (_url: string, init: RequestInit) =>
      new Promise((_resolve, reject) => {
        init.signal?.addEventListener("abort", () => {
          const err = new Error("The operation was aborted.");
          err.name = "AbortError";
          reject(err);
        });
      }),
  );
}

describe("handshake request timeout", () => {
  it("gives up on a hung connection instead of hanging forever", async () => {
    global.fetch = hangingFetch() as unknown as typeof fetch;

    const promise = session.getWalletSession(WALLET);
    const assertion = expect(promise).rejects.toThrow(/took too long/i);

    await jest.advanceTimersByTimeAsync(AUTH_REQUEST_TIMEOUT_MS + 100);
    await assertion;
  });

  it("passes an abort signal on every auth request", async () => {
    const fetchMock = hangingFetch();
    global.fetch = fetchMock as unknown as typeof fetch;

    const promise = session.getWalletSession(WALLET);
    // Attach the handler before advancing, or the rejection is unhandled.
    const settled = promise.catch(() => {});
    await jest.advanceTimersByTimeAsync(AUTH_REQUEST_TIMEOUT_MS + 100);
    await settled;

    expect(fetchMock).toHaveBeenCalled();
    for (const call of fetchMock.mock.calls) {
      expect(call[1].signal).toBeDefined();
    }
  });

  it("frees the app to retry after a timeout rather than reusing a dead promise", async () => {
    global.fetch = hangingFetch() as unknown as typeof fetch;

    const first = session.getWalletSession(WALLET);
    const firstAssertion = expect(first).rejects.toThrow();
    await jest.advanceTimersByTimeAsync(AUTH_REQUEST_TIMEOUT_MS + 100);
    await firstAssertion;

    // The dead handshake must not be memoized: a retry gets a real one.
    global.fetch = jest.fn(async (url: string) => {
      if (String(url).includes("/api/auth/session")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ session: null }),
        };
      }
      if (String(url).includes("challenge")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            transactionXdr: "xdr",
            networkPassphrase: "Test SDF Network ; September 2015",
            challengeToken: "tok",
          }),
        };
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({
          walletAddress: WALLET,
          expiresAt: new Date(Date.now() + 3600_000).toISOString(),
        }),
      };
    }) as unknown as typeof fetch;

    const retried = await session.getWalletSession(WALLET);
    expect(retried?.walletAddress).toBe(WALLET);
  });

  it("times out a server that sends headers then stalls the body", async () => {
    // The abort signal only covers the fetch itself, so a stalled body would
    // hang past it unless the deadline spans the whole exchange.
    global.fetch = jest.fn(async () => ({
      ok: true,
      status: 200,
      json: () => new Promise(() => {}),
    })) as unknown as typeof fetch;

    const promise = session.getWalletSession(WALLET);
    const assertion = expect(promise).rejects.toThrow(/took too long/i);
    await jest.advanceTimersByTimeAsync(AUTH_REQUEST_TIMEOUT_MS + 100);
    await assertion;
  });

  it("still reports an unreachable server as a connection problem", async () => {
    global.fetch = jest.fn(async () => {
      throw new TypeError("Failed to fetch");
    }) as unknown as typeof fetch;

    await expect(session.getWalletSession(WALLET)).rejects.toThrow(/check your connection/i);
  });

  it("does not time out a handshake that completes in time", async () => {
    global.fetch = jest.fn(async (url: string) => {
      if (String(url).includes("/api/auth/session")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ session: null }),
        };
      }
      if (String(url).includes("challenge")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            transactionXdr: "xdr",
            networkPassphrase: "Test SDF Network ; September 2015",
            challengeToken: "tok",
          }),
        };
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({
          walletAddress: WALLET,
          expiresAt: new Date(Date.now() + 3600_000).toISOString(),
        }),
      };
    }) as unknown as typeof fetch;

    const result = await session.getWalletSession(WALLET);
    expect(result?.walletAddress).toBe(WALLET);

    // No stray timer left armed to fire later.
    expect(jest.getTimerCount()).toBe(0);
  });
});
