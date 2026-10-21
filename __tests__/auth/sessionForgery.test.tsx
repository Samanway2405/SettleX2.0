/** @jest-environment jsdom */

/**
 * Regression tests for "the entire session is client-side state that can be
 * forged in localStorage".
 *
 * The attack was: write `settlex:user` + `settlex:publicKey` by hand, reload,
 * and every guarded route opens with an arbitrary identity. These tests drive
 * the real providers with a forged localStorage and assert the app refuses.
 */
import React from "react";
import { AuthProvider, useAuth } from "@/context/AuthContext";
import { WalletProvider, useWalletContext } from "@/context/WalletContext";
import {
  LS_EXPENSES,
  LS_PUBLIC_KEY,
  LS_TRIPS,
  LS_USER,
  LS_WALLET_ID,
  getWalletScopedKey,
} from "@/lib/utils/constants";

const { render, screen, waitFor, act } = require("@testing-library/react");

// ─── Mocks ────────────────────────────────────────────────────────────────────

jest.mock("@/lib/supabase/session", () => ({
  getAuthenticatedClient: jest.fn(),
  requireAuthenticatedClient: jest.fn(),
  clearWalletSession: jest.fn(),
  getSessionExpiryInfo: jest.fn(() => null),
  onSessionChange: jest.fn(() => () => {}),
}));

jest.mock("@/lib/freighter", () => ({
  isFreighterInstalled: jest.fn(async () => true),
  getFreighterNetwork: jest.fn(async () => "TESTNET"),
  signXDR: jest.fn(),
}));

jest.mock("@/lib/stellar/getBalance", () => ({
  getXLMBalance: jest.fn(async () => "100"),
}));

const getAddressSilently = jest.fn<Promise<string | null>, []>();
jest.mock("@/lib/stellar/walletsKit", () => ({
  FREIGHTER_ID: "freighter",
  getWalletsKit: () => ({
    setWallet: jest.fn(),
    getAddressSilently,
  }),
}));

jest.mock("@/components/ui/Toast", () => ({
  useToast: () => ({
    error: jest.fn(),
    success: jest.fn(),
    info: jest.fn(),
  }),
}));

const { getAuthenticatedClient } = require("@/lib/supabase/session");
const { isFreighterInstalled } = require("@/lib/freighter");

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const VICTIM = "GA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJUAAY";
const ATTACKER = "GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H";

function forgeLocalStorage(walletAddress: string) {
  localStorage.setItem(LS_PUBLIC_KEY, walletAddress);
  localStorage.setItem(LS_WALLET_ID, "freighter");
  const forgedProfile = JSON.stringify({
    id: "forged-id",
    walletAddress,
    displayName: "Totally Legit",
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    lastLoginAt: "2026-01-01T00:00:00Z",
  });
  // A forger writes whatever key the app reads, so plant both: the legacy
  // unscoped key and the wallet-scoped one the app actually consults now.
  localStorage.setItem(LS_USER, forgedProfile);
  localStorage.setItem(getWalletScopedKey(LS_USER, walletAddress), forgedProfile);
}

/** Stands in for a Supabase client that successfully returns a profile row. */
function profileReturningClient(walletAddress: string) {
  return {
    from: () => ({
      select: () => ({
        eq: () => ({
          single: async () => ({
            data: {
              id: "real-id",
              wallet_address: walletAddress,
              display_name: "Real User",
              created_at: "2026-01-01T00:00:00Z",
              updated_at: "2026-01-01T00:00:00Z",
              last_login_at: "2026-01-01T00:00:00Z",
            },
            error: null,
          }),
        }),
      }),
    }),
  };
}

function Probe() {
  const { isAuthenticated, isLoading, user } = useAuth();
  return (
    <div>
      <span data-testid="authed">{String(isAuthenticated)}</span>
      <span data-testid="loading">{String(isLoading)}</span>
      <span data-testid="name">{user?.displayName ?? "-"}</span>
    </div>
  );
}

function WalletProbe() {
  const { disconnect } = useWalletContext();

  return (
    <button type="button" onClick={disconnect} data-testid="disconnect-wallet">
      Disconnect
    </button>
  );
}

let mounted: { unmount: () => void } | null = null;

function renderApp() {
  mounted = render(
    <WalletProvider>
      <AuthProvider>
        <Probe />
      </AuthProvider>
    </WalletProvider>,
  );
  return mounted;
}

beforeEach(() => {
  localStorage.clear();
  jest.clearAllMocks();
  // Each provider owns a mount-once guard and a polling interval; leaving one
  // mounted lets its poller clear the next test's localStorage mid-run.
  isFreighterInstalled.mockResolvedValue(true);
  getAddressSilently.mockResolvedValue(null);
});

afterEach(() => {
  mounted?.unmount();
  mounted = null;
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("forged localStorage session", () => {
  it("does not authenticate when the wallet never signs a challenge", async () => {
    forgeLocalStorage(ATTACKER);
    // The wallet holds this address, so hydration reconciles fine — but the
    // signing handshake fails, which is the only thing that grants access.
    getAddressSilently.mockResolvedValue(ATTACKER);
    getAuthenticatedClient.mockRejectedValue(new Error("Sign-in was cancelled in your wallet."));

    renderApp();

    await waitFor(() => expect(screen.getByTestId("loading").textContent).toBe("false"));
    expect(screen.getByTestId("authed").textContent).toBe("false");
  });

  it("drops the forged wallet when the extension holds a different account", async () => {
    forgeLocalStorage(VICTIM);
    // The attacker wrote the victim's address; the real wallet says otherwise.
    getAddressSilently.mockResolvedValue(ATTACKER);

    renderApp();

    await waitFor(() => expect(screen.getByTestId("loading").textContent).toBe("false"));
    expect(screen.getByTestId("authed").textContent).toBe("false");
    // The stale key must not survive to be replayed on the next load.
    expect(localStorage.getItem(LS_PUBLIC_KEY)).toBeNull();
    expect(localStorage.getItem(LS_WALLET_ID)).toBeNull();
    // The handshake must never even be attempted for an address we dropped.
    expect(getAuthenticatedClient).not.toHaveBeenCalled();
  });

  it("clears the saved key when the wallet extension is gone", async () => {
    forgeLocalStorage(VICTIM);
    isFreighterInstalled.mockResolvedValue(false);
    getAddressSilently.mockResolvedValue(null);

    renderApp();

    await waitFor(() => expect(screen.getByTestId("loading").textContent).toBe("false"));
    expect(screen.getByTestId("authed").textContent).toBe("false");
    expect(localStorage.getItem(LS_PUBLIC_KEY)).toBeNull();
  });

  it("still shows the cached name as a render hint without authorizing", async () => {
    forgeLocalStorage(ATTACKER);
    getAddressSilently.mockResolvedValue(ATTACKER);
    getAuthenticatedClient.mockRejectedValue(new Error("Sign-in was cancelled in your wallet."));

    renderApp();

    await waitFor(() => expect(screen.getByTestId("loading").textContent).toBe("false"));
    // Cached user is still rendered (avoids a flash of empty UI) …
    expect(screen.getByTestId("name").textContent).toBe("Totally Legit");
    // … but it grants nothing.
    expect(screen.getByTestId("authed").textContent).toBe("false");
  });
});

describe("wallet-scoped cache cleanup", () => {
  it("uses a wallet-scoped cache and clears stale app data when disconnected", () => {
    const staleWallet = VICTIM;
    localStorage.setItem(LS_PUBLIC_KEY, staleWallet);
    localStorage.setItem(LS_WALLET_ID, "freighter");
    localStorage.setItem(LS_USER, JSON.stringify({ walletAddress: staleWallet, displayName: "Stale user" }));
    localStorage.setItem(getWalletScopedKey(LS_EXPENSES, staleWallet), JSON.stringify([{ id: "e1" }]));
    localStorage.setItem(getWalletScopedKey(LS_TRIPS, staleWallet), JSON.stringify([{ id: "t1" }]));

    render(
      <WalletProvider>
        <WalletProbe />
      </WalletProvider>,
    );

    act(() => {
      screen.getByTestId("disconnect-wallet").click();
    });

    expect(localStorage.getItem(LS_PUBLIC_KEY)).toBeNull();
    expect(localStorage.getItem(LS_WALLET_ID)).toBeNull();
    expect(localStorage.getItem(LS_USER)).toBeNull();
    expect(localStorage.getItem(getWalletScopedKey(LS_EXPENSES, staleWallet))).toBeNull();
    expect(localStorage.getItem(getWalletScopedKey(LS_TRIPS, staleWallet))).toBeNull();
  });
});

describe("verified session", () => {
  it("authenticates only after the handshake mints a token for this address", async () => {
    forgeLocalStorage(VICTIM);
    getAddressSilently.mockResolvedValue(VICTIM);
    getAuthenticatedClient.mockResolvedValue(profileReturningClient(VICTIM));

    renderApp();

    await waitFor(() => expect(screen.getByTestId("authed").textContent).toBe("true"));
    expect(screen.getByTestId("name").textContent).toBe("Real User");
    expect(getAuthenticatedClient).toHaveBeenCalledWith(VICTIM);
  });

  it("restores optimistically when the extension cannot answer silently", async () => {
    forgeLocalStorage(VICTIM);
    // Locked / never-authorised extension: null means "unknown", not "mismatch".
    getAddressSilently.mockResolvedValue(null);
    getAuthenticatedClient.mockResolvedValue(profileReturningClient(VICTIM));

    renderApp();

    // The signed handshake is still what authorizes — an unknown silent read
    // must not lock a legitimate user out of their own session.
    await waitFor(() => expect(screen.getByTestId("authed").textContent).toBe("true"));
    expect(localStorage.getItem(LS_PUBLIC_KEY)).toBe(VICTIM);
  });
});

describe("account switch mid-session", () => {
  it("revokes the session when the wallet switches accounts", async () => {
    jest.useFakeTimers();
    try {
      forgeLocalStorage(VICTIM);
      getAddressSilently.mockResolvedValue(VICTIM);
      getAuthenticatedClient.mockResolvedValue(profileReturningClient(VICTIM));

      renderApp();

      await waitFor(() => expect(screen.getByTestId("authed").textContent).toBe("true"));

      // The user picks a different account inside the extension.
      getAddressSilently.mockResolvedValue(ATTACKER);
      await act(async () => {
        jest.advanceTimersByTime(6_000);
      });

      await waitFor(() => expect(screen.getByTestId("authed").textContent).toBe("false"));
      expect(localStorage.getItem(LS_PUBLIC_KEY)).toBeNull();
    } finally {
      jest.useRealTimers();
    }
  });
});
