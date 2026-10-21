/** @jest-environment jsdom */

/**
 * Regression tests for "the offline cache is global, not per wallet, and is
 * never cleared on disconnect".
 *
 * The leak was: wallet A's expenses and trips were cached under single global
 * keys, survived disconnect, and were then rendered to wallet B during the
 * window before B signed — or forever, if B never signed.
 */
import React from "react";
import { ExpenseProvider, useExpenseContext } from "@/context/ExpenseContext";
import { TripProvider, useTripContext } from "@/context/TripContext";
import {
  LS_EXPENSES,
  LS_TRIPS,
  LS_USER,
  clearAppCaches,
  getWalletScopedKey,
} from "@/lib/utils/constants";

const { render, screen, waitFor } = require("@testing-library/react");

// ─── Mocks ────────────────────────────────────────────────────────────────────

jest.mock("@/lib/supabase/session", () => ({
  getAuthenticatedClient: jest.fn(),
  requireAuthenticatedClient: jest.fn(),
  clearWalletSession: jest.fn(),
  readStoredSession: jest.fn(() => null),
  onSessionChange: jest.fn(() => () => {}),
}));

let mockPublicKey: string | null = null;
// Stable across renders: getClient lists `reconcile` as a dependency.
const mockReconcile = jest.fn(async () => {});
jest.mock("@/context/WalletContext", () => ({
  useWalletContext: () => ({ publicKey: mockPublicKey, reconcile: mockReconcile }),
}));

const { getAuthenticatedClient, readStoredSession } = require("@/lib/supabase/session");

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const WALLET_A = "GA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJUAAY";
const WALLET_B = "GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H";

const SECRET_EXPENSE = {
  id: "exp-1",
  title: "Wallet A private dinner",
  amount: 420,
  paidBy: WALLET_A,
  // Cached rows must name the wallet as creator or accepted member to render.
  createdByWallet: WALLET_A,
  shares: [],
  createdAt: "2026-01-01T00:00:00Z",
};

const SECRET_TRIP = {
  id: "trip-1",
  name: "Wallet A private trip",
  createdByWallet: WALLET_A,
  members: [],
  expenseIds: [],
  createdAt: "2026-01-01T00:00:00Z",
};

function ExpenseProbe() {
  const { expenses } = useExpenseContext();
  return <div data-testid="expenses">{expenses.map((e) => e.title).join("|")}</div>;
}

function TripProbe() {
  const { trips } = useTripContext();
  return <div data-testid="trips">{trips.map((t) => t.name).join("|")}</div>;
}

beforeEach(() => {
  localStorage.clear();
  jest.clearAllMocks();
  mockPublicKey = null;
  // No wallet has signed a challenge unless a test says so.
  readStoredSession.mockReturnValue(null);
  // Never resolve a client — this is the pre-signature window under test.
  getAuthenticatedClient.mockImplementation(() => new Promise(() => {}));
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("offline cache isolation", () => {
  it("does not show wallet A's cached expenses to wallet B", async () => {
    localStorage.setItem(
      getWalletScopedKey(LS_EXPENSES, WALLET_A),
      JSON.stringify([SECRET_EXPENSE])
    );

    mockPublicKey = WALLET_B;
    render(
      <ExpenseProvider>
        <ExpenseProbe />
      </ExpenseProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId("expenses").textContent).toBe("");
    });
    expect(screen.getByTestId("expenses").textContent).not.toContain("Wallet A");
  });

  it("does not show wallet A's cached trips to wallet B", async () => {
    localStorage.setItem(
      getWalletScopedKey(LS_TRIPS, WALLET_A),
      JSON.stringify([SECRET_TRIP])
    );

    mockPublicKey = WALLET_B;
    render(
      <TripProvider>
        <TripProbe />
      </TripProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId("trips").textContent).toBe("");
    });
  });

  it("withholds a wallet's own cache until it has proven ownership", async () => {
    localStorage.setItem(
      getWalletScopedKey(LS_EXPENSES, WALLET_A),
      JSON.stringify([SECRET_EXPENSE])
    );

    mockPublicKey = WALLET_A;
    render(
      <ExpenseProvider>
        <ExpenseProbe />
      </ExpenseProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId("expenses").textContent).toBe("");
    });
  });

  it("serves a wallet its own cache once it holds a verified session", async () => {
    localStorage.setItem(
      getWalletScopedKey(LS_EXPENSES, WALLET_A),
      JSON.stringify([SECRET_EXPENSE])
    );
    readStoredSession.mockImplementation((wallet: string) =>
      wallet === WALLET_A
        ? { walletAddress: WALLET_A, accessToken: "t", expiresAt: Date.now() + 60_000 }
        : null
    );

    mockPublicKey = WALLET_A;
    render(
      <ExpenseProvider>
        <ExpenseProbe />
      </ExpenseProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId("expenses").textContent).toBe(
        "Wallet A private dinner"
      );
    });
  });

  it("ignores a legacy unscoped cache entirely", async () => {
    localStorage.setItem(LS_EXPENSES, JSON.stringify([SECRET_EXPENSE]));
    readStoredSession.mockReturnValue({
      walletAddress: WALLET_B,
      accessToken: "t",
      expiresAt: Date.now() + 60_000,
    });

    mockPublicKey = WALLET_B;
    render(
      <ExpenseProvider>
        <ExpenseProbe />
      </ExpenseProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId("expenses").textContent).toBe("");
    });
  });
});

describe("clearAppCaches", () => {
  it("purges every wallet-scoped and legacy cache key", () => {
    localStorage.setItem(LS_EXPENSES, "[]");
    localStorage.setItem(LS_TRIPS, "[]");
    localStorage.setItem(LS_USER, "{}");
    localStorage.setItem(getWalletScopedKey(LS_EXPENSES, WALLET_A), "[]");
    localStorage.setItem(getWalletScopedKey(LS_TRIPS, WALLET_A), "[]");
    localStorage.setItem(getWalletScopedKey(LS_USER, WALLET_A), "{}");
    localStorage.setItem(getWalletScopedKey(LS_EXPENSES, WALLET_B), "[]");

    clearAppCaches(WALLET_A);

    expect(localStorage.getItem(LS_EXPENSES)).toBeNull();
    expect(localStorage.getItem(LS_TRIPS)).toBeNull();
    expect(localStorage.getItem(LS_USER)).toBeNull();
    expect(localStorage.getItem(getWalletScopedKey(LS_EXPENSES, WALLET_A))).toBeNull();
    expect(localStorage.getItem(getWalletScopedKey(LS_TRIPS, WALLET_A))).toBeNull();
    expect(localStorage.getItem(getWalletScopedKey(LS_USER, WALLET_A))).toBeNull();
    // Another wallet's cache is a leak vector too — disconnect clears it all.
    expect(localStorage.getItem(getWalletScopedKey(LS_EXPENSES, WALLET_B))).toBeNull();
  });
});
